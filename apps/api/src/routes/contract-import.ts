import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { parse } from 'csv-parse/sync';
import { withTenant } from '@open-smp/schema';
import {
  BILLING_CYCLES,
  CONTRACT_IMPORT_MAX_ROWS,
  MAX_UPLOAD_BYTES,
  type BillingCycle,
  type ContractImportResponse,
  type ImportRowIssue,
} from '@open-smp/api-types';
import type { AppDeps } from '../deps.js';
import { MUTATION_RATE_LIMIT } from '../rate-limits.js';
import { normalizeAppKey, APP_KEY_MAX_LENGTH } from '../app-key.js';
import { recordContractImportAudit } from '../audit.js';
import { MAX_IMPORT_ERRORS, MAX_SAAS_APPS_PER_TENANT } from '../import-limits.js';
import { countTenantApps, lockTenantAppCatalog } from '../app-catalog.js';
// Re-exported: the acceptance test drives these through the module it is about.
export { countTenantApps, lockTenantAppCatalog };

// Every bound below is derived from a constraint in migration 0006, and the
// derivation is the contract, not a convenience.
//
// WHY: the transaction issues one INSERT per row with no savepoints, so the
// FIRST value Postgres rejects aborts it — every later statement returns
// `current transaction is aborted`, the request answers 500, and the rows
// already applied roll back. A validator that misses one constraint therefore
// does not degrade one row; it loses the whole upload, and it loses it only for
// files that contain a bad row, which is exactly the case an import must
// survive (FR2).
//
// Savepoints would make that failure survivable — and would also make a missing
// validator INVISIBLE, since the valid rows would still land. They are
// deliberately not used: the acceptance test's "the valid row is still applied"
// assertion is what proves the derivation complete, and it can only prove it
// while a missed constraint is fatal.
//
// contract-import.integration.test.ts derives the constraint list from
// pg_constraint and fails when one has no case here.
const PLAN_NAME_MAX_LENGTH = 200;
const NOTE_MAX_LENGTH = 500;
const APP_NAME_MAX_LENGTH = 200;
const SEATS_MAX = 10_000_000;

// numeric(14, 2): 12 integer digits and 2 fractional ones. Overflow is 22003,
// which is a transaction abort like any CHECK violation — and excess scale is
// worse than an error, because Postgres ROUNDS it (10.005 stores as 10.01) in a
// money column whose whole purpose is exactness.
const UNIT_PRICE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const SEATS_PATTERN = /^\d{1,8}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

// Long enough to identify the offending cell, short enough that 100 errors
// cannot be used to inflate a response with attacker-chosen bytes.
const ECHO_MAX_LENGTH = 40;

export type ContractRow = {
  appKey: string;
  appName: string;
  planName: string | null;
  seats: number | null;
  /**
   * Kept as the CSV's own digits, never as a JS number: `numeric` is exact and
   * a double is not, so parsing and re-serialising would reintroduce the error
   * the column type exists to prevent. The pattern above is what makes the
   * string safe to hand to Postgres unparsed.
   */
  unitPrice: string | null;
  currency: string | null;
  billingCycle: BillingCycle | null;
  termStart: string | null;
  termEnd: string | null;
  note: string | null;
};

function quote(value: string): string {
  const chars = [...value];
  const clipped = chars.length > ECHO_MAX_LENGTH ? `${chars.slice(0, ECHO_MAX_LENGTH).join('')}...` : value;
  return `"${clipped}"`;
}

function cell(record: Record<string, string>, column: string): string {
  return record[column]?.trim() ?? '';
}

/**
 * True when the text is a date Postgres will accept for a `date` column.
 *
 * A regex alone is not enough: `2025-02-30` and `2025-13-01` match it and raise
 * 22008 on arrival, which aborts the transaction exactly like a CHECK
 * violation. The round-trip through Date.UTC is what rejects a day the calendar
 * does not have. The four-digit year is bounded below at 1000 because there is
 * no year zero — `0000-01-01` round-trips in JavaScript and is rejected by
 * Postgres.
 */
function isStorableDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1000) {
    return false;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Validates one CSV record against every constraint C1 declares, so nothing
 * Postgres can refuse reaches the transaction. Exported for the unit tier: the
 * per-value domains are decidable without a database, and pinning them there
 * keeps the integration tier free to assert the property that needs one — that
 * a rejected row costs no valid row.
 */
export function validateContractRow(
  record: Record<string, string>,
  rowNumber: number,
): { row: ContractRow } | { error: ImportRowIssue } {
  const reject = (message: string): { error: ImportRowIssue } => ({
    error: { row: rowNumber, message },
  });

  const rawKey = cell(record, 'app_key');
  if (rawKey === '') {
    return reject('app_key is required');
  }
  const normalized = normalizeAppKey(rawKey);
  if ('rejected' in normalized) {
    if (normalized.rejected === 'reserved') {
      // Named as reserved rather than as malformed: the operator's file is
      // well-formed and the refusal is a policy the message has to explain, or
      // the next upload is the same file with the same cell.
      return reject(`app_key ${quote(rawKey)} is reserved for the product's own event sources`);
    }
    return reject(
      `app_key ${quote(rawKey)} must be lowercase letters, digits, '-' or '_' (max ${APP_KEY_MAX_LENGTH})`,
    );
  }
  const appKey = normalized.key;

  // Optional, because the ordinary re-import names applications that already
  // exist. Defaulting to the key rather than erroring keeps validation
  // independent of database state: a row's verdict must not depend on whether
  // the application happens to exist, or the same file would validate
  // differently on its second upload.
  const appName = cell(record, 'app_name') || appKey;
  if (appName.length > APP_NAME_MAX_LENGTH) {
    return reject(`app_name exceeds ${APP_NAME_MAX_LENGTH} chars`);
  }

  const planNameRaw = cell(record, 'plan_name');
  if (planNameRaw.length > PLAN_NAME_MAX_LENGTH) {
    return reject(`plan_name exceeds ${PLAN_NAME_MAX_LENGTH} chars`);
  }

  const noteRaw = cell(record, 'note');
  if (noteRaw.length > NOTE_MAX_LENGTH) {
    return reject(`note exceeds ${NOTE_MAX_LENGTH} chars`);
  }

  const seatsRaw = cell(record, 'seats');
  let seats: number | null = null;
  if (seatsRaw !== '') {
    if (!SEATS_PATTERN.test(seatsRaw)) {
      return reject(`seats ${quote(seatsRaw)} must be a whole number`);
    }
    seats = Number(seatsRaw);
    if (seats > SEATS_MAX) {
      return reject(`seats must be at most ${SEATS_MAX}`);
    }
  }

  const unitPriceRaw = cell(record, 'unit_price');
  let unitPrice: string | null = null;
  if (unitPriceRaw !== '') {
    if (!UNIT_PRICE_PATTERN.test(unitPriceRaw)) {
      return reject(
        `unit_price ${quote(unitPriceRaw)} must be a non-negative amount with at most 12 digits and 2 decimal places`,
      );
    }
    unitPrice = unitPriceRaw;
  }

  const currencyRaw = cell(record, 'currency');
  let currency: string | null = null;
  if (currencyRaw !== '') {
    // Length before folding, so the transform stays length-preserving and the
    // stored code is the operator's own three characters.
    const upper = currencyRaw.length === 3 ? currencyRaw.toUpperCase() : currencyRaw;
    if (!CURRENCY_PATTERN.test(upper)) {
      return reject(`currency ${quote(currencyRaw)} must be a three-letter code`);
    }
    currency = upper;
  }

  const cycleRaw = cell(record, 'billing_cycle');
  let billingCycle: BillingCycle | null = null;
  if (cycleRaw !== '') {
    const lowered = cycleRaw.toLowerCase();
    // Derived from the shared domain, which is itself pinned to the Postgres
    // enum's declaration order — a hand-written pair here would be a second
    // copy of the enum with nothing keeping it honest.
    const found = BILLING_CYCLES.find((value) => value === lowered);
    if (!found) {
      return reject(`billing_cycle ${quote(cycleRaw)} must be one of ${BILLING_CYCLES.join(', ')}`);
    }
    billingCycle = found;
  }

  const termStartRaw = cell(record, 'term_start');
  if (termStartRaw !== '' && !isStorableDate(termStartRaw)) {
    return reject(`term_start ${quote(termStartRaw)} must be a calendar date as YYYY-MM-DD`);
  }
  const termEndRaw = cell(record, 'term_end');
  if (termEndRaw !== '' && !isStorableDate(termEndRaw)) {
    return reject(`term_end ${quote(termEndRaw)} must be a calendar date as YYYY-MM-DD`);
  }
  // Lexicographic comparison is the calendar comparison for zero-padded
  // ISO dates, and both sides are known to be well-formed by this point.
  if (termStartRaw !== '' && termEndRaw !== '' && termEndRaw < termStartRaw) {
    return reject('term_end must not be before term_start');
  }

  return {
    row: {
      appKey,
      appName,
      planName: planNameRaw || null,
      seats,
      unitPrice,
      currency,
      billingCycle,
      termStart: termStartRaw || null,
      termEnd: termEndRaw || null,
      note: noteRaw || null,
    },
  };
}

/**
 * Every NOT NULL column without a default appears in this list; the acceptance
 * test derives that set from the catalog and fails when one is missing, because
 * 23502 aborts the transaction like every other rejection.
 *
 * ON CONFLICT rather than a pre-check: `saas_contracts` carries UNIQUE
 * (tenant_id, saas_app_id) — SCL1's one-contract-per-application — so a file
 * that names an application twice, or a re-upload of a corrected file, would
 * otherwise raise 23505 and abort. Last row wins, which is what a corrected
 * re-upload means.
 */
export const CONTRACT_INSERT_SQL = `
  INSERT INTO saas_contracts
    (tenant_id, saas_app_id, plan_name, seats, unit_price, currency, billing_cycle,
     term_start, term_end, note)
  VALUES ($1, $2, $3, $4, $5::numeric, $6, $7::billing_cycle, $8::date, $9::date, $10)
  ON CONFLICT ON CONSTRAINT saas_contracts_tenant_id_saas_app_id_key DO UPDATE SET
    plan_name = EXCLUDED.plan_name,
    seats = EXCLUDED.seats,
    unit_price = EXCLUDED.unit_price,
    currency = EXCLUDED.currency,
    billing_cycle = EXCLUDED.billing_cycle,
    term_start = EXCLUDED.term_start,
    term_end = EXCLUDED.term_end,
    note = EXCLUDED.note,
    updated_at = now()
`;

async function findAppId(tx: PoolClient, tenantId: string, key: string): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    'SELECT id FROM saas_apps WHERE tenant_id = $1 AND key = $2',
    [tenantId, key],
  );
  return result.rows[0]?.id ?? null;
}

async function createApp(
  tx: PoolClient,
  tenantId: string,
  key: string,
  displayName: string,
): Promise<string> {
  // DO NOTHING, then re-read: the advisory lock makes a conflict unreachable
  // from a second import, but POST /saas-apps is not behind that lock, and a
  // 23505 here would abort the transaction along with every row already
  // applied. DO UPDATE was the alternative and was rejected — it would let a
  // file about prices rename an application the operator manages elsewhere.
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO saas_apps (tenant_id, key, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, key) DO NOTHING
     RETURNING id`,
    [tenantId, key, displayName],
  );
  const insertedId = inserted.rows[0]?.id;
  if (insertedId) {
    return insertedId;
  }

  const raced = await findAppId(tx, tenantId, key);
  if (!raced) {
    throw new Error('saas_apps upsert neither inserted nor found a row');
  }
  return raced;
}

export function registerContractImportRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/contract-import',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!file) {
        return reply.code(400).send({ error: 'file is required' });
      }

      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch (err: unknown) {
        const isFileTooLarge =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          err.code === 'FST_REQ_FILE_TOO_LARGE';
        if (isFileTooLarge) {
          return reply.code(400).send({ error: 'file exceeds 10MB limit' });
        }
        throw err;
      }

      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        return reply.code(400).send({ error: 'file must be UTF-8 encoded' });
      }
      if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
      }

      let records: Record<string, string>[];
      try {
        records = parse(text, { columns: true, skip_empty_lines: true, trim: false });
      } catch {
        return reply.code(400).send({ error: 'malformed CSV' });
      }

      if (records.length > CONTRACT_IMPORT_MAX_ROWS) {
        return reply.code(400).send({ error: `too many rows (max ${CONTRACT_IMPORT_MAX_ROWS})` });
      }

      const validRows: { rowNumber: number; row: ContractRow }[] = [];
      const errors: ImportRowIssue[] = [];
      const warnings: ImportRowIssue[] = [];
      let skipped = 0;
      const seenKeys = new Set<string>();

      records.forEach((record, index) => {
        const rowNumber = index + 2; // +1 for 1-indexing, +1 for the header row
        const result = validateContractRow(record, rowNumber);
        if ('error' in result) {
          skipped += 1;
          if (errors.length < MAX_IMPORT_ERRORS) {
            errors.push(result.error);
          }
          return;
        }
        if (seenKeys.has(result.row.appKey)) {
          warnings.push({
            row: rowNumber,
            message: `duplicate app_key "${result.row.appKey}" overwrites an earlier row`,
          });
        }
        seenKeys.add(result.row.appKey);
        validRows.push({ rowNumber, row: result.row });
      });

      const { tenantId, userId } = req.sessionContext;
      const createdApps: string[] = [];

      const imported = await withTenant(deps.pool, tenantId, async (tx) => {
        await lockTenantAppCatalog(tx, tenantId);

        const appIds = new Map<string, string>();
        const refusedKeys = new Set<string>();
        let appCount = await countTenantApps(tx, tenantId);

        for (const { row } of validRows) {
          if (appIds.has(row.appKey) || refusedKeys.has(row.appKey)) {
            continue;
          }
          const existingId = await findAppId(tx, tenantId, row.appKey);
          if (existingId) {
            appIds.set(row.appKey, existingId);
            continue;
          }
          // Only a NEW application spends the ceiling. A file that re-prices
          // the whole catalog creates nothing and is never refused for length.
          if (appCount >= MAX_SAAS_APPS_PER_TENANT) {
            refusedKeys.add(row.appKey);
            continue;
          }
          appIds.set(row.appKey, await createApp(tx, tenantId, row.appKey, row.appName));
          createdApps.push(row.appKey);
          appCount += 1;
        }

        let applied = 0;
        for (const { rowNumber, row } of validRows) {
          const saasAppId = appIds.get(row.appKey);
          if (!saasAppId) {
            // The ceiling is a per-row outcome, not a request-level failure:
            // rows naming applications that already exist are still applied.
            skipped += 1;
            if (errors.length < MAX_IMPORT_ERRORS) {
              errors.push({
                row: rowNumber,
                message: `application catalog is full (max ${MAX_SAAS_APPS_PER_TENANT}); "${row.appKey}" was not created`,
              });
            }
            continue;
          }
          await tx.query(CONTRACT_INSERT_SQL, [
            tenantId,
            saasAppId,
            row.planName,
            row.seats,
            row.unitPrice,
            row.currency,
            row.billingCycle,
            row.termStart,
            row.termEnd,
            row.note,
          ]);
          applied += 1;
        }

        // Inside the transaction, so the trail and what it describes commit
        // together. An upload that changed nothing still records: "nobody
        // uploaded anything" and "somebody uploaded a file we rejected entirely"
        // are different facts, and only one of them is an operator error.
        await recordContractImportAudit(tx, tenantId, 'contract_import', {
          actorUserId: userId,
          imported: applied,
          skipped,
          createdAppKeys: createdApps,
        });

        return applied;
      });

      errors.sort((a, b) => a.row - b.row);

      const body: ContractImportResponse = {
        imported,
        skipped,
        createdApps,
        errors,
        warnings,
      };
      return reply.code(200).send(body);
    },
  );
}
