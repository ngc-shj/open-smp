// Bounds for the CSV import routes that no browser code needs. Named for their
// SUBJECT, not for their role: `MAX_ROWS` held 20 000 for the HR import, and
// the contract import needs a different value for a different reason, so one
// name would have to hold two values — and whichever route imported the other's
// would be wrong silently, because both are plausible integers.
//
// The two ROW caps are not here. They cross into apps/web (@open-smp/api-types)
// because each route interpolates its cap into an over-limit message and both
// upload forms key their copy off that exact string:
//
//   HR_IMPORT_MAX_ROWS       20 000 — one row per employee. The 10 MB byte cap
//                            does not bound the row count (minimal rows pack
//                            ~150-250k into 10 MB) and the transaction issues
//                            one INSERT per row, so an unbounded file holds a
//                            shared-pool connection for minutes (CS2).
//   CONTRACT_IMPORT_MAX_ROWS  2 000 — one row per application, and SCL1 makes
//                            that one row per application in total, so the
//                            ceiling below is the order of magnitude. Set above
//                            it rather than equal: a file that is the whole
//                            catalog plus corrections must not be refused for
//                            its length.

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
