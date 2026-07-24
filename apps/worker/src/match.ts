import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '@open-smp/schema';
import { defaultRules, matchAccounts, type AccountView, type IdentityView } from '@open-smp/matcher';
import type { MatchJobData, MatchJobResult } from '@open-smp/queues';

export interface MatchDeps {
  pool: Pool;
}

interface IdentityRow {
  id: string;
  primary_email: string;
  secondary_emails: string[];
  display_name: string;
  status: 'active' | 'left';
  left_at: string | null;
}

interface AccountRow {
  id: string;
  email: string | null;
  display_name: string | null;
  account_status: 'active' | 'suspended' | 'archived';
}

async function loadIdentities(tx: PoolClient): Promise<IdentityView[]> {
  const { rows } = await tx.query<IdentityRow>(
    'SELECT id, primary_email, secondary_emails, display_name, status, left_at FROM identities',
  );
  return rows.map((row) => ({
    id: row.id,
    primaryEmail: row.primary_email,
    secondaryEmails: row.secondary_emails,
    displayName: row.display_name,
    status: row.status,
    leftAt: row.left_at,
  }));
}

async function loadAccounts(tx: PoolClient): Promise<AccountView[]> {
  const { rows } = await tx.query<AccountRow>(
    'SELECT id, email, display_name, account_status FROM saas_accounts',
  );
  // AccountView requires non-null email/displayName; accounts with no email
  // can never match a rule (all rules compare against account.email), so an
  // empty string is a safe, non-matching placeholder for provider rows that
  // omit these fields.
  return rows.map((row) => ({
    id: row.id,
    email: row.email ?? '',
    displayName: row.display_name ?? '',
    accountStatus: row.account_status,
  }));
}

async function upsertLink(
  tx: PoolClient,
  tenantId: string,
  link: {
    saasAccountId: string;
    identityId: string | null;
    status: 'matched' | 'orphan' | 'ghost' | 'ambiguous';
    confidence: number;
    ruleId: string | null;
    evidence: unknown;
  },
  computedAt: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO account_links
       (tenant_id, saas_account_id, identity_id, status, confidence, rule_id, evidence, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (tenant_id, saas_account_id) DO UPDATE SET
       identity_id = EXCLUDED.identity_id,
       status = EXCLUDED.status,
       confidence = EXCLUDED.confidence,
       rule_id = EXCLUDED.rule_id,
       evidence = EXCLUDED.evidence,
       computed_at = EXCLUDED.computed_at`,
    [
      tenantId,
      link.saasAccountId,
      link.identityId,
      link.status,
      link.confidence,
      link.ruleId,
      link.evidence === null ? null : JSON.stringify(link.evidence),
      computedAt,
    ],
  );
}

/**
 * Runs one match job: load identities + saas_accounts, run the pure matcher,
 * upsert account_links, and record a single discovery_events row. All DB
 * work happens inside withTenant(job.tenantId, ...) per C5.
 */
export async function runMatch(deps: MatchDeps, job: MatchJobData): Promise<MatchJobResult> {
  const runId = randomUUID();
  const computedAt = new Date();

  const links = await withTenant(deps.pool, job.tenantId, async (tx) => {
    const [identities, accounts] = await Promise.all([loadIdentities(tx), loadAccounts(tx)]);

    const results = matchAccounts(identities, accounts, defaultRules);

    for (const result of results) {
      await upsertLink(
        tx,
        job.tenantId,
        {
          saasAccountId: result.saasAccountId,
          identityId: result.identityId,
          status: result.status,
          confidence: result.confidence,
          ruleId: result.ruleId,
          evidence: result.evidence,
        },
        computedAt,
      );
    }

    await tx.query(
      `INSERT INTO discovery_events (tenant_id, source, kind, payload)
       VALUES ($1, 'matcher', 'match_completed', $2::jsonb)`,
      [job.tenantId, JSON.stringify({ counts: { links: results.length }, runId })],
    );

    return results.length;
  });

  return { links, runId };
}
