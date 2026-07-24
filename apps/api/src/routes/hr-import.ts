import type { FastifyInstance } from 'fastify';
import { parse } from 'csv-parse/sync';
import { withTenant } from '@open-smp/schema';
import type { AppDeps } from '../deps.js';
import { MUTATION_RATE_LIMIT } from '../rate-limits.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ERRORS = 100;
const EMAIL_MAX_LENGTH = 320;
const NAME_MAX_LENGTH = 200;

type ImportRowError = { row: number; message: string };
type ImportWarning = { row: number; message: string };

type ValidRow = {
  employeeId: string;
  primaryEmail: string;
  secondaryEmails: string[];
  displayName: string;
  status: 'active' | 'left';
  leftAt: string | null;
};

function mapStatus(raw: string): 'active' | 'left' | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'active') {
    return 'active';
  }
  if (normalized === 'left' || normalized === 'retired' || raw.trim() === '退職') {
    return 'left';
  }
  return null;
}

function validateRow(
  record: Record<string, string>,
  rowNumber: number,
): { row: ValidRow } | { error: ImportRowError } {
  const employeeId = record.employee_id?.trim();
  if (!employeeId) {
    return { error: { row: rowNumber, message: 'employee_id is required' } };
  }

  const email = record.email?.trim();
  if (!email) {
    return { error: { row: rowNumber, message: 'email is required' } };
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    return { error: { row: rowNumber, message: `email exceeds ${EMAIL_MAX_LENGTH} chars` } };
  }

  const name = record.name?.trim();
  if (!name) {
    return { error: { row: rowNumber, message: 'name is required' } };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return { error: { row: rowNumber, message: `name exceeds ${NAME_MAX_LENGTH} chars` } };
  }

  const rawStatus = record.status?.trim();
  if (!rawStatus) {
    return { error: { row: rowNumber, message: 'status is required' } };
  }
  const status = mapStatus(rawStatus);
  if (!status) {
    return { error: { row: rowNumber, message: `unknown status "${rawStatus}"` } };
  }

  const leftAtRaw = record.left_at?.trim() || null;
  if (status === 'left' && !leftAtRaw) {
    return { error: { row: rowNumber, message: 'left_at is required when status=left' } };
  }
  // status=active always writes left_at=NULL below regardless of any stray
  // CSV value — HR is authoritative and re-import fully overwrites (re-hire case).

  const secondaryEmails = record.secondary_emails?.trim()
    ? record.secondary_emails.split(';').map((value) => value.trim()).filter(Boolean)
    : [];

  return {
    row: {
      employeeId,
      primaryEmail: email,
      secondaryEmails,
      displayName: name,
      status,
      leftAt: status === 'left' ? leftAtRaw : null,
    },
  };
}

function decodeUtf8Strict(buffer: Buffer): string | null {
  try {
    // fatal: true rejects non-UTF-8 byte sequences (e.g. Shift_JIS) instead
    // of silently mangling them.
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    // Strip BOM if present; both are then treated identically.
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  } catch {
    return null;
  }
}

export function registerHrImportRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/hr-import',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!file) {
        return reply.code(400).send({ error: 'file is required' });
      }

      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        return reply.code(400).send({ error: 'file exceeds 10MB limit' });
      }

      const text = decodeUtf8Strict(buffer);
      if (text === null) {
        return reply.code(400).send({ error: 'file must be UTF-8 encoded' });
      }

      let records: Record<string, string>[];
      try {
        records = parse(text, { columns: true, skip_empty_lines: true, trim: false });
      } catch {
        return reply.code(400).send({ error: 'malformed CSV' });
      }

      const validRows: ValidRow[] = [];
      const errors: ImportRowError[] = [];
      const warnings: ImportWarning[] = [];
      const seenEmployeeIds = new Set<string>();

      records.forEach((record, index) => {
        const rowNumber = index + 2; // +1 for 1-indexing, +1 for the header row
        const result = validateRow(record, rowNumber);
        if ('error' in result) {
          if (errors.length < MAX_ERRORS) {
            errors.push(result.error);
          }
          return;
        }
        if (seenEmployeeIds.has(result.row.employeeId)) {
          warnings.push({ row: rowNumber, message: `duplicate employee_id "${result.row.employeeId}" overwrites an earlier row` });
        }
        seenEmployeeIds.add(result.row.employeeId);
        validRows.push(result.row);
      });

      const { tenantId } = req.sessionContext;

      let imported = 0;
      if (validRows.length > 0) {
        await withTenant(deps.pool, tenantId, async (tx) => {
          for (const row of validRows) {
            await tx.query(
              `INSERT INTO identities
                 (tenant_id, employee_id, primary_email, secondary_emails, display_name, status, left_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
                 primary_email = EXCLUDED.primary_email,
                 secondary_emails = EXCLUDED.secondary_emails,
                 display_name = EXCLUDED.display_name,
                 status = EXCLUDED.status,
                 left_at = EXCLUDED.left_at`,
              [
                tenantId,
                row.employeeId,
                row.primaryEmail,
                row.secondaryEmails,
                row.displayName,
                row.status,
                row.leftAt,
              ],
            );
            imported += 1;
          }
        });
      }

      return reply.code(200).send({
        imported,
        skipped: errors.length,
        errors,
        warnings,
      });
    },
  );
}
