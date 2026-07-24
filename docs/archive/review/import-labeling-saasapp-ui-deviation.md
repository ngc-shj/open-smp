# Coding Deviation Log: import-labeling-saasapp-ui

Entries recorded directly by the orchestrator (Ollama unavailable throughout this session — `generate-deviation-log`, `merge-findings`, `pre-review.sh`, and `generate-slug` all fell back per their documented failure handling).

## D1 — Branch base is `feature/mvp-account-matching`, not `main` (process)

Triangulate Step 1-7 defaults to branching from `main`, but `main` holds only the predecessor plan documents; the MVP implementation this work builds on lives unmerged on `feature/mvp-account-matching` (@ 4fc4f91). Branching from `main` would produce a tree without the API/web/schema this plan extends. Declared in the plan header at creation time.

## D2 — `build-codebase-fingerprint.sh` failed on macOS bash 3.2 (tooling)

Step 2-1's usage-frequency fingerprint hook aborts (`declare -A` unsupported by bash 3.2; `go.sh` plugin also hits an unbound variable). `scan-shared-utils.sh` ran but found no root-level shared dirs (monorepo packages are the shared layer). Substituted a manual inventory (recorded in the plan's Implementation Checklist) built from direct reads of the route/web/schema modules. Fix of the hook itself is out of scope for this repo (hook lives in ~/.claude, not this project).

## D3 — `rls.integration.test.ts` now seeds `tenants` rows (side-fix, Batch A)

C10's DDL gives `account_labels.tenant_id` a real FK to `tenants(id)` — the first tenant-scoped table with such an FK (the other 7 declare `tenant_id uuid NOT NULL` without one). The existing RLS integration test never inserted `tenants` rows because nothing referenced them; extending the per-table RLS coverage to `account_labels` therefore failed on the FK until the test's `beforeAll` seeds `tenantA`/`tenantB` via the admin pool. Plan-conformant (the DDL is exactly as locked); recorded because the test-infrastructure change was not itemized in the plan.

## D4 — Batch B cross-batch minimal fixes (disclosed by sub-agent)

`apps/web/src/lib/api-types.ts` barrel re-exports and a `label: null` field in `apps/web/test/csv-export.test.ts`'s existing literal were applied in Batch B (API batch) rather than Batch C (web batch) to keep `pnpm typecheck` green at the batch boundary. Both were itemized in the Implementation Checklist; only the batch assignment shifted. Batch C later added the two re-exports Batch B missed (`HrImportResponse`, `ImportRowIssue` — needed by the C12 import page); same D6 single-source category.

## D5 — Batch C presentation-level deviations (disclosed by sub-agent)

- The mandated "do not fix this back" comment in `SaasAppForm.tsx` describes the banned idiom without quoting the literal `err.message` token — quoting it would have tripped the file's own forbidden-pattern grep (`(err|error|e)\.message`). Anti-Deferral rule 5 shape (document vs. check collision) resolved in favor of the mechanical gate since the comment loses no didactic value.
- C14's "disabled+spinner while in flight" implemented as disabled + busy text ("Saving…"), matching `SyncControl.tsx`'s existing text-only busy indicators; no spinner component exists in the codebase (R8 consistency preferred over literal plan wording).

## D6 — Concurrent-batch transient typecheck failure (process note)

Batches C and D ran concurrently in the same worktree; Batch D observed a repo-wide `pnpm typecheck` failure caused by Batch C's then-incomplete barrel export (`HrImportResponse`) and correctly scoped its own gate to `@open-smp/worker` (clean) after verifying via git-stash that the error predated its change. Batch C's final verification (and the orchestrator's post-merge full-suite run below) confirms the tree is green. Future batches touching the same worktree concurrently should be avoided when a shared gate (repo-wide typecheck) is part of each batch's completion criteria.

## D7 — Additional hook failures on macOS bash 3.2 (tooling, extends D2)

Step 2-5 pre-steps: `check-propagation.sh` (lib/ast-signature.sh uses `declare -g`) and `check-event-dispatch.sh` (BSD awk lacks `asort`) fail on this machine. Manual dispositions: R3 — the diff renames no existing symbols and changes no constant values (additive feature; verified via the conformance greps and full-suite green); R4 — the new mutation sites (label PUT/DELETE) have no event-dispatching sibling in any route file (event emission lives in the worker), so no dispatch asymmetry exists. All other Step 2-5 hooks ran clean.

## D8 — T-L9 RT7 red-proof executed post-hoc by orchestrator (Self-R-Check finding, resolved)

Batch B's sub-agent substituted code review for the plan-mandated strip-and-confirm-red proof (the delegation prompt's no-mutation constraint offered that substitute — an orchestrator prompt error, since the plan names strip-and-confirm-red as the ONLY accepted RT7 evidence). Resolved during Step 2-5: the proof was executed on a throwaway `git worktree` under the session scratchpad (production tree untouched) — stripping the DELETE label route's `config` made T-L9 fail with the exact per-route assertion message; worktree discarded afterward. The test's comment now records the executed proof instead of the code-review claim.

## D9 — `/apps` page uses `apiFetch`, not the plan-named `apiGetJson` (Phase 3 R1, FN F-2)

C13's signature sketch names `apiGetJson<SaasAppListResponse>('/saas-apps')`, but `apiGetJson` is defined yet used by ZERO existing pages — both predecessor pages use `apiFetch` + manual 401/`!res.ok` handling. The implementation follows the established convention (R8/R22: consistency with real usage beats the plan's literal token). Reviewer classified this as informational, not a defect; no code change.
