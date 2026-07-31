// Bounds shared by the CSV import routes. Named for their SUBJECT, not for
// their role: `MAX_ROWS` held 20 000 for the HR import, and the contract import
// needs a different value for a different reason, so one name would have to
// hold two values — and whichever route imported the other's would be wrong
// silently, because both are plausible integers.

/**
 * An HR export is one row per employee. The 10 MB byte cap does not bound the
 * row count (minimal rows pack ~150-250k into 10 MB) and the transaction issues
 * one INSERT per row, so an unbounded file holds a shared-pool connection for
 * minutes (CS2).
 */
export const HR_IMPORT_MAX_ROWS = 20_000;

/**
 * A contract file is one row per application, and SCL1 makes that one row per
 * application in total — so the ceiling below, not the employee count, is the
 * natural order of magnitude. Set above MAX_SAAS_APPS_PER_TENANT rather than
 * equal to it: rows for applications that already exist are legitimate on every
 * re-import, and a file that is exactly the catalog plus a few corrections must
 * not be refused for its length.
 */
export const CONTRACT_IMPORT_MAX_ROWS = 2_000;

/**
 * The per-tenant application-catalog ceiling. It exists because the contract
 * import is the only path that creates `saas_apps` rows without naming a
 * connector, and every authenticated session of a tenant may call it.
 *
 * Enforced under a transaction-scoped advisory lock, not by a bare count:
 * `SELECT count(*)` takes no lock at READ COMMITTED, so two concurrent imports
 * both read the pre-insert count and both proceed (measured: two transactions
 * overshot a ceiling of 10 to 18 rows).
 */
export const MAX_SAAS_APPS_PER_TENANT = 500;

/**
 * How many per-row errors a response body carries. The cap bounds the response,
 * not the validation — every row is still checked, and the contract import's
 * `skipped` counts every rejected row rather than the truncated list's length.
 */
export const MAX_IMPORT_ERRORS = 100;
