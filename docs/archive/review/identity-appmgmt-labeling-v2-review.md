# Plan Review: identity-appmgmt-labeling-v2

Date: 2026-07-25
Review rounds: 5 (newest first)

---

# Round 5 (verification-only)

**5 findings — 0 Critical, 0 Major, 5 Minor.** All applied. First round with **no Major**: 2 Critical → 0 → 0 → 0 → 0; 11 → 9 → 3 → 2 → **0** Major.

Every finding landed on C24, the contract round 4 changed most — and four of the five are the same defect class the review has now diagnosed repeatedly: a fix applied to half of something, with the other half left asserting the superseded state.

## Two reviewers applied the change and ran the suite

Both the functionality and testing experts patched `csvField` into the real `apps/web/src/lib/csv-export.ts`, ran the web suite, and reverted. Independently reported **20/20 green across 2 files**, confirming C24 breaks nothing. The working tree was verified clean afterward. This is the first round where a proposed production change was executed rather than reasoned about.

## The ordering question turned out to have two different answers

Investigating TEST-F1 produced the round's most useful measurement. C24's strip can be mis-ordered two ways, and they are **not** equivalent:

```
A = quote(strip(neutralize(v)))   <- the contract
B = strip(quote(neutralize(v)))   <- RS6 violation: strip AFTER quoting
C = quote(neutralize(strip(v)))   <- strip BEFORE neutralizing

A vs B: identical on every input   -> NOT behaviorally observable
A vs C: differs on 4 of 10 inputs  -> observable, AND a security regression
        "\r=cmd"  ->  A: "' =cmd"   C: " =cmd"   (formula neutralization LOST)
```

**B is unobservable** because newline-stripping is invariant under quote-escaping — escaping touches only `"`. No assertion over today's transformation set can distinguish it, which means I24.3's RS6 half has no gate and the plan now says so plainly rather than implying one exists. **C is observable and is the dangerous one**: it silently disables `neutralizeCell` for `\r`-leading cells, including the live CSV-injection vector `"\r=cmd"`. That is now the criterion, constructible through the public `buildAccountsCsv` alone.

The security expert independently swept all three-character prefixes over `{= + - @ \t \r \n space ' " a}` and found **zero** cases where the strip promotes a formula trigger to position 0 — structurally impossible, since `\r`/`\n` become a *space*, which is not a trigger. RS6 is intact under the change.

## Round-5 Functionality Findings (3 Minor)

- **F1** — C24's fenced block still declared `csv-export.ts` **UNCHANGED** twelve lines above I24.2's bolded "the exporter **DOES** change". Round 4 fixed the `.optional()` half of this same block and left its other half. The two halves of C24 were mutually unsatisfiable. → Applied, with the real `csvField`/`stripNewlines` bodies written into the block.
- **F2** — C25's changed-files list omitted `csv-export.ts` while C26 already listed its *test* file. Combined with F1, **no contract in the plan scheduled the `csvField` edit** — it existed only in prose, the exact FN-F8 failure mode round 1 established. → Applied.
- **F3** — I24.3's forbidden pattern misses the realistic violation. Measured: `quoteCsvCell(neutralizeCell(value)).replace(…)` is **missed** because `[^)]*` stops at the inner `)`; only the paren-free-argument form matches. Sixth mechanical guard to fail this way, and pointed timing — C24 now asks an implementer to add exactly the newline-to-space replacement this guard exists to catch. → Applied: demoted from "makes the invariant mechanical" to a review prompt.

## Round-5 Security Findings (1 Minor)

- **F1** — the 512 cursor cap **still rejects API-minted cursors**, this time for C0 control characters (623 chars). The expert's framing is the valuable part: this bound has now been derived twice from *sampled* inputs — round 3 measured ASCII and called 256 settled; round 4 measured five scripts and called 512 settled on "the worst case (CJK at 367)". Neither was the worst case. → Applied, but **not** by raising the cap again: `source` is now constrained to `^[a-z0-9_-]+$`. Every real value is a slug, so nothing legitimate is rejected, the encoded cursor is ASCII-bounded at 196 forever, and SC30's collision surface narrows independently. Raising the cap a third time would have left the next reviewer re-deriving a charset argument.

Verified clean by this expert: privilege-before-RLS re-probed on a throwaway database including three vectors no round had checked — `TRUNCATE` denied, `INSERT … ON CONFLICT DO UPDATE` denied (closing the upsert-as-forgery path), `SELECT … FOR UPDATE` denied. It also confirmed the constraint name against the live DB, swept `withTenant`'s GUC handling, and chased a pino-logging credential-echo path to a conclusion before declining to raise it as theoretical — explicitly refusing to manufacture a finding.

## Round-5 Testing Findings (1 Minor)

- **F1** — I24.3's proof obligation regressed when C24 gained the strip: the criterion asserts a composition over `csvField`/`quoteCsvCell`, both **module-private** (`csv-export.ts:15,20` — only `neutralizeCell` and `buildAccountsCsv` are exported), so it cannot be written; and its mechanical backstop misses the realistic form. → Applied via the A/B/C analysis above.

This expert **self-rejected two further items** and disclosed them anyway, both of which were my transcription errors and both now fixed: the `"Ev\r\nil"` criterion said one space where `\r\n` is two characters (an implementer would have gone red against a correct implementation), and the existing-suite claim counted six `\r\n` splits where there are seven (`:144` missed). Neither rose to a finding; both cost nothing to correct.

## Round-5 Orchestrator Notes

**The defect population is now entirely documentation.** Zero Majors, zero design findings, and every Minor was a stale or imprecise statement rather than a wrong decision. Three separate experts verified the same underlying designs by execution — patching and running the suite, probing Postgres privileges on throwaway databases, sweeping charset domains — and none found a design flaw.

**Six mechanical guards have now failed across five rounds**, and the diagnosis has stabilized: a guard bound to *how code is written* fails silently the first time someone writes it differently. The plan's guards now assert properties at the layer where those properties exist — the built WHERE clause, the database privilege, the exported CSV cell, the validator's domain — and where a property genuinely cannot be tested (I24.3's RS6 half), the plan says so instead of implying a gate.

**Two experts declined to manufacture findings** (security on the pino path, testing on two self-rejected items it disclosed rather than inflated). That is the behavior a converging review should show.

**Convergence: reached.** Round 5 produced no Major and no design finding; its five Minors are applied. The remaining risk is not in the plan but in Phase 2's fidelity to it.

---

# Round 4 (verification + final adversarial pass)

**8 findings — 0 Critical, 2 Major, 6 Minor.** All applied. The trend holds: 2 Critical → 0 → 0 → 0; 11 → 9 → 3 → 2 Major.

**No finding this round was a design defect.** Every one was either a stale document artefact (prose or a fenced block left behind by an earlier round's fix) or a guard mechanism that does not guard. The underlying designs were re-verified as correct, several by direct measurement.

## The round's most important finding was [Adjacent], and it inverted C24's target

**SEC-F3 — the CSV newline defect was never really about `note`.** Three rounds hardened the one field that was already best protected. Measured across the export's attacker-influenced columns:

```
displayName    -> 3 records  <-- SPLIT
matchedValue   -> 3 records  <-- SPLIT
candidates     -> 3 records  <-- SPLIT
note           -> 2 records  (guarded by I24.1)
```

`note` is operator-authored, length-capped, entered through a single-line `<input>`, and now newline-rejected at the API. The other three are **provider- and HR-supplied and stored verbatim** — `apps/worker/src/sync.ts:51-65` upserts `display_name` straight from the connector, `hr-import.ts:197` does the same for identities. A sloppy Google Workspace directory entry or an HR CSV cell containing a CRLF splits the export today, with no API call required.

So cycle 1's actual ask — settle the input-vs-API asymmetry "as a whole" — was **not met** by boundary rejection alone. Boundary rejection is right for `note` (a newline there is always a mistake) and wrong for `displayName` (rejecting a sync over provider data the operator does not control would break ingestion). → **Applied**: `csvField` now strips `\r`/`\n` from every cell between `neutralizeCell` and `quoteCsvCell`, preserving I24.3's "quoting is last" ordering. `note` keeps its API guard as defense in depth. The four-case pin was re-measured post-fix (all four now yield one record) and its job changed from "which newline is dangerous" to locking cell contents.

Worth recording *why* the scope drifted: cycle 1's `TODO(labeling-v2)` marker was never inserted into source. A grep-able marker on `csvField` would have pointed at the exporter; a prose note in a review document pointed at `note`.

## A reviewer invalidated its own fix for the second time

Round 3 replaced a dead regex with an executed source test. Round 4's security expert — the same one who proposed both — tested the replacement across eight authoring variants and reported it also brittle. Reproduced independently, seven shapes:

```
CAUGHT  naive expansion (THE defect)      silent  row-wise (safe)
CAUGHT  bare OR                           silent  parenthesized OR (safe)
silent  hoisted variable  <-- MISSED      silent  helper call      <-- MISSED
silent  array spread      <-- MISSED      silent  index assignment <-- MISSED
```

Its diagnosis of the root cause is the durable lesson: **moving from regex to an executed test changed the mechanism but not the coupling** — both bind to the syntax of one authoring idiom rather than to the property being protected. Hoisting a predicate into a variable is an ordinary refactor, after which the guard goes silent while the defect stays reachable.

→ **Applied**: assert on the **built clause** instead of the source text — extract `conditions.join(' AND ')` and check for ` OR ` at paren depth zero. Verified across all four clause shapes (defect caught; row-wise, parenthesized, and with-filter all clean). Authoring-independent by construction, so all four blind spots close. Requires extracting the predicate builder into an exported function — a small refactor the route benefits from anyway.

This was the **fifth** mechanical guard to fail in this review (three greps returning empty, two dead pattern-matchers). The corrective is now consistent: guards assert the property at the layer where it exists, not a spelling of it.

## Round-4 Functionality Findings

- **F1 (Minor)** — C24's fenced note schema dropped `.optional()`, contradicting both the shipped code (`account-labels.ts:19`) and C23's own signature. An implementer copying the block makes `note` **required** on a live endpoint, and **no criterion catches it** because every other criterion supplies a note. → Applied, plus a new criterion (a body with no `note` succeeds) that exists specifically to falsify this regression. The same edit removed a stale `quoteCsvCell` "corrected body" comment the reviewer had not flagged.
- **F2 (Minor)** — I26.5's teardown rationale cited "204 on no-op" where `DELETE …/label` returns 404 if the *account* is absent. → Applied: precise semantics stated (204 when the account exists regardless of label; 404 when it does not).

Verified clean by this expert: all four round-3 fixes resolve rather than relocate; both orchestrator measurements re-derived (the regex table reproduced cell-for-cell; `seed.ts:172-181` confirmed never re-applying `display_name`). It read every contract for the round-3 defect class and found C18–C22, C25, and C27 clean. Implementability assessed as good — "no decision the plan failed to make that would block an implementer."

## Round-4 Security Findings

- **F1 (Major)** — the round-3 source test is also brittle. See above.
- **F2 (Minor)** — the 256-byte cursor cap **rejects cursors the API itself mints** when `source` is non-ASCII. Round 3's "60 chars of headroom" was an ASCII-only measurement; `source` is `.max(64)` in UTF-16 units with no charset restriction. Re-measured: accented 282, CJK 367, emoji 282 — all over the cap. Unreachable today (`key` is pinned to a literal) but reachable under SC30. → Applied: cap raised to 512.
- **F3 (Minor, [Adjacent] → Functionality)** — the CSV defect beyond `note`. See above; promoted in effect to the round's headline change.

Verified clean by this expert: privilege-before-RLS independently reproduced on a throwaway database, including the decisive foreign-tenant case and `TRUNCATE` (which no round had checked); `createDb` still zero-callered, and noted it *is* publicly re-exported, which is what makes recording the zero-caller status load-bearing exactly right; the `s` binding introduces no oracle. Adversarial pass clean: `account_labels` has exactly three writers and the CASCADE that would erase labels untraced is unreachable; no `dangerouslySetInnerHTML` tree-wide; the bulk `missing` array echoes only caller-supplied ids.

## Round-4 Testing Findings

- **F1 (Major)** — I22.5's round-3 discharge named `saas_apps_saas_app_id_fkey`, which **does not exist**. Postgres names a foreign key after the *referencing* table: the constraint is `saas_accounts_saas_app_id_fkey`. Re-measured against the live database — `SELECT conname FROM pg_constraint WHERE contype='f' AND confrelid='saas_apps'::regclass` returns exactly that one row. The plan had it right at line 83 and in I22.5 itself, and wrong only in the round-3 text. Because the discharge is a **source-matching** test, it would have been red against a correct implementation, or would have taught an implementer to write a catch that never fires. → Applied, with the inverted-polarity failure recorded.
- **F2 (Minor)** — SC17's resolution paragraph still asserted the seed gate does not check display name, which round 3's own fix superseded. → Applied; the E2E credential prohibition was folded in as an explicit obligation rather than being implicit in three scoping statements.
- **F3 (Minor)** — the C20 guard's blind spots. Merged with SEC-F1.

Verified by this expert: both its round-3 fixes sound, with premises re-derived independently (`seed.ts` vs `ensureIdentities` asymmetry confirmed — the latter *does* carry `DO UPDATE SET display_name`, so the gap is specific to `saas_apps`). Full coverage pass: **all 27 invariants across C18–C27 now have a falsifiable criterion**; two thin ones (I21.3 non-mutation, I22.2b single-UPDATE atomicity) were self-rejected under RT2 as not constructible rather than manufactured into findings. Full E2E state-safety pass: no proposed spec can make an ungated mutation to the shared stack.

## Round-4 Orchestrator Notes

**Both Majors this round were defects in fixes from earlier rounds** — one mine (the constraint name), one the security expert's own (the source test). Neither was a design flaw. That is the expected shape of a converging review: the remaining defects are in the scaffolding, not the structure.

**Five mechanical guards have now failed across four rounds**, every one caught by an independent expert and never by the author. The pattern is fully diagnosed: a guard coupled to *how code is written* rather than to *what must be true* fails silently the first time someone writes it differently. Every load-bearing guard in the plan now asserts a property at the layer where that property exists — the built WHERE clause, the database privilege, the exported CSV cell — with a red-proof.

**Convergence.** Round 4's findings are two scaffolding defects and six documentation corrections. No expert found a design flaw, all 27 invariants carry falsifiable criteria, and two experts self-rejected candidate findings on constructibility rather than padding the round. Round 5 should be verification-only.

---

# Round 3 (verification + fresh scrutiny of the round-2 edits)

**9 findings — 0 Critical, 3 Major, 6 Minor.** All applied. Severity continues to fall (2 Critical → 0 → 0; 11 Major → 9 → 3).

## Round-3 Convergence

**All three experts independently found the same defect**: C20's normative `ts` block was never updated alongside the prose that supersedes it.

| Issue | Reported by | Merged severity |
|---|---|---|
| `type EventCursor = { t; id }` omits the `s` field the same block's encoding line and totality rules require | Functionality (F2, Major) + Security (F3, Minor) + implied by Testing's coverage pass | **Major** |
| The query schema block is `.strict()` with no `source` key — the contract as written 400s every `?source=` request | Functionality (F1, Major) | Major |

Round 2 rewrote C20's prose thoroughly — encoding, totality rules, binding semantics, every acceptance criterion — and left the fenced block at its round-1 state. The consequence is not cosmetic: an implementer copying the block (the block's entire purpose) ships a contract with **no `?source=` filter and no cursor binding**, rendering the round's headline fix inert. Lesson recorded in the plan: when a round rewrites a contract's prose, its fenced blocks are part of the contract and must be re-read, not assumed to still agree.

## A reviewer invalidated its own round-2 fix

The security expert tested the forbidden pattern **it had itself proposed in round 2** (`conditions\.push\([^)]*\bOR\b(?![^)]*\))`) and reported it unsatisfiable. Adjudicated by direct execution rather than accepting either the original or the proposed replacement:

```
[round-2 pattern] [reviewer's fix]
     miss              miss      conditions.push(`created_at < $${n} OR (created_at = $${n} AND id < $${m})`)   <- THE defect
     miss              MATCH     conditions.push(`a < $1 OR b = $2`)
     miss              miss      conditions.push(`(created_at, id) < ($1, $2)`)                                 <- safe
     miss              miss      conditions.push(`(a < $1 OR b = $2)`)                                          <- safe
```

The round-2 pattern matches **nothing at all**, and the reviewer's own replacement still misses the real defect (the predicate contains `$${n}` and inner parens, so any `[^)]*` scan stops early). A guard that reads as protection while matching nothing is worse than no guard — it manufactures exactly the false confidence that let three grep-based claims fail in rounds 1–2. Replaced with an executed source test following `no-rotation-route.test.ts`'s precedent.

## Round-3 Functionality Findings

- **F1 (Major)** — C20's query-schema block omits `source` and is `.strict()`. → Applied; both the schema and `EventCursor` corrected, with the divergence recorded.
- **F2 (Major)** — `EventCursor` omits `s`. → Merged with SEC-F3; applied.
- **F3 (Minor)** — C23's accounts cursor is left unbound to its filters while C20 binds its own, with no stated rationale. → **Applied as a recorded decision**, not a change: the events cursor was being rebuilt anyway (binding cost one field), whereas the accounts cursor is an untouched `sa.id >` keyset carrying three filters; the UI cannot drop a filter (C25's href fix), and a direct caller replaying across filters gets a correctly-paged different query rather than silent omission, because the accounts cursor is a plain id keyset.
- **F4 (Minor)** — the malformed-cursor criterion lists four cases, none exercising `s`; a decoder ignoring the field passes all four. → Applied: added missing-`s` and extra-key cases, which are what give the "exactly the keys" totality rule a proof obligation.

Independently re-derived by this expert (obligation 2, all three confirmed): privilege-before-RLS on a throwaway database — including the decisive foreign-tenant case where RLS would hide every row and the `42501` still fires; both Load-more hrefs dropping exactly the params claimed; `buildApp` called once with a single-version key map. It additionally verified empirically that the row-wise predicate uses the declared index as an **Index Cond** (not a post-filter, no sort node) and returns a byte-identical id set to the expanded disjunction.

## Round-3 Security Findings

- **F1 (Major)** — the round-2 forbidden pattern is unsatisfiable. See above.
- **F2 (Minor)** — I27.2's blind-spot class is bounded only for raw SQL. Drizzle is a live dependency (`packages/schema/src/db.ts:2`), and an ORM emits SQL no source grep can see. Traced: `createDb` has **zero callers** tree-wide (re-verified: `grep -rn createDb` returns only its own definition), so the class is genuinely closed today — but C27's analysis *rests* on that zero-caller status, unrecorded. → Applied: recorded so a future contract adopting `createDb` is a decision rather than an accident.
- **F3 (Minor)** — `EventCursor` omits `s`. Merged with FN-F2.

Verified clean by this expert: the cursor's new `s` binding introduces **no oracle** — the 400 is a pure function of two values the caller already supplies and can decide client-side, the cursor carries no tenant identifier, and the mismatch check runs before any DB access, so SEC-F8's property survives intact (a well-formed foreign cursor under a *matching* source still returns 200-empty, indistinguishable from exhausted). The exhaustion bound was measured, not asserted: a maximal three-field cursor encodes to 196 base64url chars against the 256 cap, 60 chars of headroom. The blind-spot search covered the class (template interpolation: 8 hits, all in the RLS suite, exactly two UPDATE/DELETE) rather than re-running the shape that failed twice.

## Round-3 Testing Findings

- **F1 (Major)** — the extended `assert-seed-preserved.sh` still misses `saas_apps.display_name`. The plan *noticed* this exposure and mitigated it only with an `afterEach` — the very mechanism that fails when a spec crashes. **Worse than a leaked label, because the seeder does not repair it**: verified at `apps/api/src/seed.ts:172-181`, which returns the existing app id on a `(tenant_id, key)` hit and never re-applies `display_name`. A leaked rename survives every `docker compose up` and every seed re-run, permanently, and the next run's first apps assertion fails with a "cell not found" naming neither cause nor culprit. → Applied: the gate now asserts the seeded `displayName` too, with a red-proof.
- **F2 (Minor, adjacent)** — I22.5's `23503` → 409 backstop has no acceptance criterion; omitting the catch entirely passes every stated C22 criterion. The expert correctly rejected the obvious test on RT2 grounds (forcing a real `23503` means winning the race I22.4 closes). → Applied with a source-level discharge, closing the last invariant in the plan lacking a proof obligation.

Independently re-derived by this expert: the fourth CSV case (`"a\rb"` → 2) **confirmed**, completing the four-case characterization; all five login sites confirmed present where claimed, with an explicit check for a sixth (`session-expiry.spec.ts` and `auth.spec.ts:40-45` navigate but never submit) — five is exact. It also verified that TEST-F2's proposed harness change actually works against `beforeEach`'s structure (`deps` stays in scope, so a test-local `buildApp({...deps, …})` does not disturb the shared instance or `afterAll`'s close).

## Round-3 Orchestrator Notes

**The mechanical-guard failure rate is the story of this review.** Across three rounds, five mechanical claims or guards failed: three greps that returned empty and were read as evidence of absence (the `hasRateLimit` sweep, the C21 guard's kind, C27's dependency analysis), and now two regexes that matched nothing while reading as protection. Every one was caught by an independent expert, never by the author. The corrective applied throughout: where a mechanical guard is load-bearing, it is now an **executed test** with a red-proof (I19.4's append-only grep, C20's `OR` guard, I22.5's catch-block assertion) rather than a forbidden pattern in a document — following the repo's own `no-rotation-route.test.ts` precedent, which is the pattern that has actually held.

**Convergence assessment.** Round 3 found no Critical findings, and its three Majors are all *documentation-vs-prose* divergences or guard-mechanism defects rather than design flaws — the underlying designs (C20's predicate and index, C27's privilege model, the audit trail's transaction semantics) were independently re-verified as correct, several by direct measurement. The Minors are coverage completions. Round 4 is required to confirm the round-3 edits, but the trend across 58 total findings (2 Critical → 0 → 0; 11 → 9 → 3 Major) indicates the plan is converging rather than churning.

---

# Round 2 (incremental — verification of round-1 fixes + fresh scrutiny of C27)

All three perspectives ran again as independent delegated agents, each instructed to be adversarial about the fixes to its **own** round-1 findings and to independently re-derive the orchestrator's adjudications. **21 findings — 0 Critical, 9 Major, 12 Minor.** All applied.

## Round-2 Convergence

**Two experts independently found the same Major defect in C27**, the contract promoted in-branch during round 1:

| Issue | Reported by | Severity |
|---|---|---|
| C27's `REVOKE` breaks the existing RLS suite; the plan's own walkthrough asserts the opposite | Functionality (F2) + Security (F1) | **Major** |

Both traced it to the same root cause and both noted that the plan's justifying grep *could not* have found it. `packages/schema/test/rls.integration.test.ts` runs its cross-tenant matrix over `MEMBER_TABLES` (`:12-21`, which includes `discovery_events` at `:17`) via `` `UPDATE ${table} …` `` (`:266`) and `` `DELETE FROM ${table} …` `` (`:286`) — **template interpolation, so no literal-table-name grep can ever match it**. The orchestrator's I27.2 claimed the check was "verified before writing the migration, and re-verified after"; the re-verification repeated the same blind method and returned the same false clean.

Adjudicated by direct measurement on the live DB (in a transaction, rolled back — no production change):

```
BEGIN; REVOKE UPDATE, DELETE ON discovery_events FROM opensmp_app;
SET LOCAL ROLE opensmp_app; UPDATE discovery_events SET tenant_id = tenant_id WHERE id = …;
-> SQLSTATE 42501 insufficient_privilege
ROLLBACK;
```

**Postgres checks table privilege before RLS row filtering**, so two existing `it.each` cases stop returning `rowCount === 0` and start throwing. The security expert reproduced this independently on a throwaway database with the same schema shape. C27 is still the right control — the revoke is strictly stronger than the app-level pattern it supersedes, since it holds even for a code path that sets no tenant GUC — but the plan now records the required test change rather than asserting the suite is unaffected.

## A reviewer retracted its own round-1 finding

The testing expert was asked to independently re-derive the orchestrator's CSV adjudication, which had gone against **both** round-1 reviewers. It reproduced all three measured cases and wrote: *"the orchestrator's adjudication against both reviewers — including against my own round-1 claim that today's code yields 3 records for a newline note — is correct, and my round-1 finding was wrong."* It then found a **fourth** case the pin was missing (interior bare `\r` → 2), which was added. This is the D7 re-delegation lesson working in the intended direction: the orchestrator's self-performed measurement was checked rather than trusted, and the check both confirmed it and improved it.

## Round-2 Functionality Findings

- **F1 (Major) — `?source=` and the composite cursor were designed in the same round and never reconciled.** The cursor encodes a position; the filter comes from the current request. Verified this is the *default* path, not an edge case: `events/page.tsx:73` builds the Load-more href with `cursor` only, so following it under `?source=label` drops the filter and resumes a filtered position inside an unfiltered set — silently omitting rows in an audit UI whose purpose is completeness. → **Applied**: the filter is now bound into the cursor (`s`) and a mismatch is a 400, rather than relying on the UI to preserve the param; C25 also gains the href fix. Both are needed, but binding makes the API correct regardless of consumer behavior.
- **F2 (Major) — C27 breaks the RLS suite.** Merged with SEC-F1; see above.
- **F3 (Major) — `accountsTruncated` had no acceptance criterion.** Present in the type, the invariant, and the walkthrough; absent from all five criteria, and both seeded criteria exercise one-account identities. An implementer omitting the `LIMIT` would pass everything. Identical in shape to round-1 TEST-F7. → **Applied**: 60-account and exactly-50 boundary criteria, with a red-proof.
- **F4 (Major) — C24 carried two contradictory copies of the same forbidden pattern.** The round-1 FN-F5 fix was *inserted* rather than replacing the original, leaving the superseded "in label route files" scope in force twenty lines below the correction. → **Applied**: stale block deleted (verified: zero occurrences remain).
- **F5 (Minor) — C21's `sync_raw` fixture used a key no producer emits.** Merged with SEC-F4; see below.
- **F6 (Minor) — the accounts Load-more href drops `?label=`.** The UI-tier counterpart of I23.6, and the same defect class as F1. → **Applied** in C25 alongside the events href.
- **F7 (Minor) — the sweeps cast `route.method as 'GET' | 'POST'`;** C22 adds the first `PATCH`. Harmless (a cast over a `string`; `app.inject` accepts any method) but the same lines are already being edited. → **Applied** to the existing C26 obligation.

## Round-2 Security Findings

- **F1 (Major) — C27 vs. the RLS suite.** Merged with FN-F2; see above.
- **F2 (Major) — C20 never stated the SQL comparison predicate.** The plan locked the encoding, validation, ordering, and index, but not the WHERE clause. The naive expansion `created_at < $n OR (created_at = $n AND id < $m)` pushed into the existing `conditions` array (`events.ts:60-64`) and joined with `AND` yields a **tenant-unqualified disjunct** — `AND` binds tighter than `OR`. RLS still blocks the rows, so it is not an exploitable leak here; it is a one-token defect in a security-sensitive builder, in the contract whose round-1 Critical was about this same cursor. → **Applied**: the row-wise form `(created_at, id) < ($n, $m)` is now contractual, with a forbidden pattern against unparenthesized `OR` in the builder.
- **F3 (Minor) — the re-grant forbidden pattern missed `GRANT ALL` forms.** `GRANT ALL ON discovery_events`, `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA`, and `ALTER DEFAULT PRIVILEGES` would all silently restore the privileges. → **Applied**: alternation widened, two patterns added.
- **F4 (Minor) — C21's `sync_raw` fixture named `rawAccounts`;** the sole producer writes `{runId, accounts: rawPayloads}` (`sync.ts:157-160`) with no `counts` key at all. The name was copied from the `sync_completed` test that SEC-F1 established was testing the wrong kind. The allowlist drops unknown keys regardless, so the guard would still pass and still redden — fidelity, not vacuity — but `accounts` is precisely the key an implementer might let through, and a guard that never names it teaches the wrong production shape. → **Applied**.
- **F5 (Minor, adjacent) — `source` namespace collision, unreachable today.** Sync writes `source = app.key`; C19 writes `source = 'label'`. Pinned by the `key` literal now, but SC30 contemplates widening it — at which point registering `key = 'label'` would make sync events indistinguishable from audit records under `?source=label`. → **Applied**: recorded as a constraint *on SC30*, the contract that would unlock the collision.

Verified clean by this expert on re-examination: the scope-level session and Origin gates; the rotation boundary; parameterization of both dynamic builders; `unnest($1::uuid[])` (bind parameter plus `::uuid` cast = two independent gates); the `?source=` predicate; `decodeCursor` against resource exhaustion (256-byte cap before parsing), prototype pollution (`JSON.parse` creates an own property, and "exactly the keys" leaves no merge sink), and cross-tenant probing; `accountsTruncated`'s disclosure surface; and NFR4 under the new PATCH (Fastify's default logger emits headers, not bodies).

## Round-2 Testing Findings

- **F1 (Major) — I26.5's API-driven teardown was not constructible as written.** Two blockers: the specs work from *emails* with no account-id fixture, so ids must be derived from `GET /api/accounts` first; and the Origin gate (`app.ts:56-64`) rejects every non-GET `/api` request without a matching `Origin`, which Playwright's `request` context does not set. A teardown that silently 403s is exactly the poisoning obligation 2 exists to catch — but the gate only fires at the end of the run. → **Applied**: all three requirements stated, including that the teardown asserts its own response status.
- **F2 (Major) — C22's multi-version credential criterion was vacuous.** This was the proof SEC-F4 added as *the* thing that fails when `credentials_key_version` is not written. Measured: `api.integration.test.ts:115` hard-codes a one-entry key map and `buildApp` is called exactly once in the file (grep: 1 occurrence), so `Math.max(...keys.keys())` always yields 1 and the criterion degenerates to "1 stays 1" — passing whether or not the version column is written. → **Applied**: C26 now requires a per-test deps override building a second app with a two-version map, citing `rotation.integration.test.ts:22-25` as the in-repo precedent.
- **F3 (Major) — the login-budget arithmetic was wrong in both directions.** The round-1 note counted two logins and claimed one of margin. The real set is five: the `ci.yml:88` curl gate, `global-setup.ts:65`'s fallback (the normal case on a fresh CI stack), `auth.spec.ts:11,22`, and `assert-seed-preserved.sh:21` — which I26.5 obligation 2 keeps. `auth.spec.ts:6` already documented "1 setup + 2 here = 3", contradicting the round-1 count. That is 5 of 5 before `retries: 1`, and the plan is simultaneously adding a two-consecutive-runs criterion that doubles all of it. → **Applied**: recomputed with the five sites tabulated, and the margin claim **withdrawn**. Whether the limiter trips today depends on `playwright install` separating the windows — accident, not design.
- **F4 (Minor) — the CSV pin omitted interior bare `\r`.** → **Applied** as a fourth measured case; without it the pin cannot distinguish the two competing explanations for why `\r` is harmless, and those diverge under exactly the mutation I24.2 names as its falsifiability demonstration.
- **F5 (Minor) — the cursor-boundary criterion asserted cardinality but not order.** A predicate comparing `id >` instead of `id <` within the tied group still yields 51 distinct ids in the wrong relative order. → **Applied**: added a non-increasing `(created_at, id)` assertion over the concatenation.
- **F6 (Minor) — `accountsTruncated` unexercised.** Duplicate of FN-F3; merged.
- **F7 (Minor) — C18's criteria named demo-seed fixtures unavailable at the integration tier.** `api.integration.test.ts` never calls the seeder (grep: no `runSeed`/`seed(`); every test hand-inserts into its own tenant. As phrased the criteria invite either a wasted attempt to reach the seed or a fifth copy of the seed facts. → **Applied**: criteria restated by shape ("an active identity with one matched account").
- **F8 (Minor) — duplicated forbidden-pattern block.** Duplicate of FN-F4; merged.
- **F9 (Minor, adjacent) — "integration count grows" names no target.** Any non-zero delta passes, including one where half the cases were never written — and the revisions roughly doubled the case count. → **Applied**: counts become stated targets reconciled against per-contract sums.

Independently verified by this expert: C27's privilege test is constructible and **not** vacuous (the ACL check fires before RLS row filtering, so the error is raised even with zero visible rows — the realistic failure mode of "0 rows, no error" cannot occur); `audit-append-only.test.ts` lands correctly in the unit project; the integration-tier app lifecycle works for create→rename→delete.

## Round-2 Adjacent Findings

| ID | Raised by | Routed to | Disposition |
|---|---|---|---|
| SEC-F5 | Security | Functionality (scope) | Applied — constraint recorded on SC30 |
| TEST-F9 | Testing | Functionality | Applied — C26 counts become targets |

## Round-2 Orchestrator Notes

**Three "verified by grep" claims have now failed in this plan**, each on a construct the grep shape could not express: the `hasRateLimit` sweep (round 1, stopped scanning early), the C21 guard's kind (round 1, read the wrong test), and C27's dependency analysis (round 2, literal-name pattern vs. template interpolation). The pattern is consistent — a grep returning empty was read as evidence of absence rather than as evidence about the grep. Every remaining mechanical claim in the plan has been re-verified by a method that does not share the failure mode: direct file reads for the test claims, and a live-DB transaction probe for the privilege behavior.

**Convergence is not yet reached.** Round 2 closed with 21 applied findings and no expert returning "No findings", so a round 3 is required before any contract can lock.

---

# Round 1 (initial)

Review round: 1
Merge method: manual (Ollama unavailable all session — pre-screening skipped, all three experts ran full-plan review against the live tree)

## Changes from Previous Round

Initial review. All three experts were instructed to verify the plan's factual claims against the repository rather than review it as a self-contained document — the plan asserts many "measured" facts (FK delete behaviors, grant contents, existing test line numbers, a Fastify routing probe). That instruction is what produced the round's two highest-value findings: **two of the plan's load-bearing "measured" claims were not actually measured and were false.**

Round-1 totals: **28 findings — 2 Critical, 11 Major, 15 Minor** (counting the merged duplicates once).

---

## Cross-Perspective Convergence

Two issues were found independently by more than one expert. Per "Perspective Convergence as a Severity Signal", each takes the **higher** severity of the reports:

| Issue | Reported by | Merged severity |
|---|---|---|
| C21's designated S5 regression guard does not exercise `sync_raw` | Security (F1, Critical) + Testing (F5, Minor) | **Critical** |
| C24's CSV newline criterion is unfalsifiable as written | Functionality (F7, Minor) + Testing (F6, Minor) | **Minor**, but both were partly wrong about the cause — see the orchestrator note below |

A third claim produced a **three-way disagreement worth recording**: Security F2 and Testing F1 both reported that the plan's "no test asserts `hasRateLimit`" claim is **false**, while the Functionality expert independently *confirmed* the plan's (wrong) claim as "correct and genuinely valuable". The orchestrator settled it by direct grep: `apps/api/test/api.integration.test.ts:1166` asserts `route.hasRateLimit` with `.toBe(true)`, inside `T-L9` at `:1150-1170`, carrying its own recorded RT7 red-proof. **Two experts and the orchestrator's original claim were wrong; the majority was right for the right reason.** This is the clearest evidence in the round that "verify against the tree" must beat "verify against the document".

---

## Functionality Findings

**FN-F1 — Critical — C20's composite cursor breaks the request schema, and the site is never listed.** `apps/api/src/routes/events.ts:8` validates the cursor as `z.string().uuid()`. No composite encoding is a valid uuid, so every "Load more" on `/events` would have returned 400 — and `apps/web/src/app/events/page.tsx:17-19` turns a non-ok response into `throw new Error(...)`, i.e. a rendered error page. The draft named only `events.ts:75` (`ORDER BY id`) as the change site. Worse, the draft's own acceptance criteria ("a malformed cursor returns 400") would have **passed against the unchanged schema** while the happy path was broken.
→ **Applied**: C20 now locks the encoding (`base64url(JSON.stringify({t, id}))`), names `events.ts:8` explicitly, replaces `.uuid()` with a length-capped string plus a total `decodeCursor`, and adds the missing happy-path round-trip criterion.

**FN-F2 — Major — C21 never states the widened wire type.** The draft said the type "MUST widen to a discriminated shape" without saying what it is. Three concrete obstacles it left unresolved: `kind` is `string` (`packages/api-types/src/index.ts:49`) so a discriminated union cannot narrow; narrowing `kind` makes the four raw-SQL worker producers (`sync.ts:151,158,179`, `match.ts:126`) members of a class nothing links them to; and a union `payload` breaks `events/page.tsx:54`'s existing `event.payload.counts` at the typecheck gate.
→ **Applied**: C21 locks `DiscoveryEventPayload` as a single open shape with all fields optional and deliberately does **not** narrow `kind`, with the trade-off (type permits `actorUserId` on a sync event; the allowlist, not the type, is the guard) stated explicitly.

**FN-F3 — Major — audit events are unfilterable, making scenario S3 unreachable.** The draft wrote label audits into the same undifferentiated list as sync events. With `sync_completed` + `sync_raw` accumulating per sync, S3 ("security reviewer opens `/events`, finds the `label_set` entry") has no working path at realistic volume — the trail is written but not readable, defeating the stated security purpose.
→ **Applied**: C20 adds `?source=` (one more parameterized predicate on the existing builder at `events.ts:61-67`). Chose `source` over `kind` so the whole audit family selects in one predicate and future audit kinds need no filter change (R12).

**FN-F4 — Major — C18 declares non-nullable `confidence`/`linkStatus` without pinning the join.** The natural shape to copy is `accounts.ts:127-131`'s `LEFT JOIN account_links`, which makes both columns nullable; `Number(null)` then yields `0` silently — a wrong value, not a crash. The forbidden pattern catches missing coercion but not nullability.
→ **Applied**: I18.4 pins the query as driven **from `account_links`** with the join written out.

**FN-F5 — Major — R42-C's member set and C24's forbidden-pattern scope disagree.** The pattern was scoped to "label route files", but C23's bulk endpoint schema does not live in `account-labels.ts` — so the mechanical guard covered one of the two members while the plan claimed both.
→ **Applied**: pattern scope widened to `apps/api/src/routes/**` unconditionally.

**FN-F6 — Minor — deleting an app orphans an in-flight sync job with no audit trace.** Verified: `apps/worker/src/sync.ts:92` assigns `appKey` *after* `loadSaasApp` returns, so a deleted app throws first, `appKey` stays `null`, and the failure handler's `if (appKey !== null)` guard at `:174` suppresses the `sync_failed` write.
→ **Applied**: recorded as I22.7 (known limitation, not fixed — it is worker failure semantics, not an app-management defect) + SC31, with a C26 obligation that `apps.spec.ts` not interleave sync and delete.

**FN-F7 — Minor — C24 specified a `quoteCsvCell` change with no defect and an unachievable red-proof.** See the merged treatment under TEST-F6 below.

**FN-F8 — Major [Adjacent → Testing] — R42-derived obligations never entered C26.** Three obligations (the rate-limit sweep, the `:param` substitution, the `**/page.tsx` glob) were stated only in the R42 section, so Phase 2 would have dropped them.
→ **Applied**: C26 gained an explicit obligations table. One of the three was withdrawn entirely (see SEC-F2).

**FN-F9 — Minor [Adjacent → Security] — C23's cap bounds ids, not work.** The forbidden pattern blocked per-id *transactions* but permitted per-id *statements*: ~300 statements/request × 60 req/min ≈ 18,000 statements/minute from one caller.
→ **Applied**: I23.7 requires set-based SQL (`= ANY`, `INSERT … SELECT … unnest`), which also makes I23.2's atomicity trivially true.

Verified clean by this expert (no action): the FK `confdeltype` table, the `no-rotation-route.test.ts:12` regex, the `numeric(3,2)`-as-string claim, the `0001_init.sql` seven-table grant, `withTenant`'s `READ COMMITTED` shape, `api-types.ts:6-22`'s explicit re-export list, `SaasAppForm.tsx:6-14`'s deliberate anti-idiom, `csv-export.ts` ordering, `labeling.spec.ts:17-26`, `assert-seed-preserved.sh:54-60`, the R42-A route enumeration (13 routes, no route-generating helper or `fastify.route({})` form in the tree), and R42-B's glob-gap correction. The migration runner executes each file in its own transaction, so C20's non-`CONCURRENTLY` `CREATE INDEX` is correct.

---

## Security Findings

**SEC-F1 — Critical (escalated) — C21's designated S5 guard tests the wrong kind.** The plan named `api.integration.test.ts:441` as C21's regression guard in four places and instructed the implementer **not to modify it**. That test inserts `kind: 'sync_completed'` (`:451`), not `sync_raw`. Under today's kind-blind projection the distinction is immaterial; under C21's per-kind allowlist it becomes the whole point — an implementer adding a permissive `sync_raw` branch (the only kind that ever carries provider PII; sole writer `apps/worker/src/sync.ts:158`) would see green and would satisfy the stated criterion verbatim. Escalation reason recorded by the expert: the design change is precisely what converts a currently-sound test into a vacuous one, and the plan forbade fixing it.
→ **Applied**: C21's criteria now require a **new** `sync_raw` test carrying `phone`/`orgUnit`, keep the `sync_completed` test as the unchanged-behavior check for that branch, and require **two** red-proofs — the `sync_raw` branch one being the one that matters. The `:441` citation was corrected to `:443-471`.

**SEC-F2 — Major — the plan's "measured" claim that no test asserts `hasRateLimit` is false.** The sweep exists at `api.integration.test.ts:1150-1170` with a documented executed red-proof. The plan's grep stopped at the two sweeps near `:133`/`:152`.
→ **Applied**: the claim is **retracted in full** in R42-A, the derived C26 obligation is **withdrawn**, and the section now warns the implementer not to add a duplicate sweep or displace `T-L9`. A process note was added recording that two "measured" claims in the draft were asserted from partial greps.

**SEC-F3 — Major — `DELETE /label` has no source for the audit `before` field.** `account-labels.ts:87-98` checks only that the saas_account exists, then issues an unconditional `DELETE` and returns `true` without reading the row or inspecting `rowCount`. So `before` has no source and `found` is `true` whether or not a label was removed — a naive implementation either fabricates `label_cleared` events for no-ops or emits none at all.
→ **Applied**: I19.2 now requires `DELETE … RETURNING kind, note`, emission skipped when `rowCount === 0`, and the same for `PUT`'s prior-row read. The acceptance criterion was strengthened from "an event exists" to "`before` deep-equals the removed label".

**SEC-F4 — Major — I22.2 misstated the AAD, and the criterion built on it would pass against a corrupt row.** `buildAad` (`packages/crypto/src/index.ts:67-78`) includes a 4-byte big-endian `keyVersion`. Because `encryptCredentials` always selects the max version (`:85`), a replacement after a key rollout lands on a new version — so PATCH must persist `credentials_key_version` alongside `credentials_enc`. Updating the ciphertext alone leaves the row permanently undecryptable, and the draft's criterion ("decrypts under AAD `{tenantId, saasAppId}`") would pass because the test author supplies the version they just encrypted with.
→ **Applied**: AAD corrected throughout; I22.2b requires a single `UPDATE` writing both columns; the criterion now requires re-reading **both** columns and decrypting with the version **read back from the row**, plus a multi-version case that fails if the version column is not written.

**SEC-F5 — Major — SC29's deferral rested on a premise the tree contradicts.** The draft priced the `REVOKE` as spanning three packages with new integration coverage. Re-verified: every `discovery_events` write in the tree is an `INSERT` (7 sites); no `UPDATE`, no `DELETE`. The migration precedent exists (`0003_account_labels.sql:25` is a standalone per-table `GRANT`). Anti-Deferral rule 7 applies — `discovery_events` is the one uncovered member of the audit-integrity class, and this plan is what makes its contents security-relevant.
→ **Applied**: SC29 **withdrawn** and promoted in-branch as **C27** (`REVOKE UPDATE, DELETE`), with a `42501` privilege test that must run as `opensmp_app` (the owner is not subject to the revoke, so an owner-run assertion would pass vacuously). Live-DB grant state confirmed before writing the contract: `opensmp_app` currently holds `DELETE, INSERT, SELECT, UPDATE`.

**SEC-F6 — Minor — C18 returned an uncapped array while C23 got an explicit cap.** Same concern, inconsistent treatment inside one plan. The bound is matcher output, not anything the API controls.
→ **Applied**: I18.5 caps at `PAGE_SIZE` and adds `accountsTruncated` to the response (the page cannot otherwise distinguish "exactly 50" from "cut off").

**SEC-F7 — Minor — I24.3 stated the wrong RS6 invariant.** The conclusion was right but the reasoning ("neutralizeCell prepends a single quote") would permit a post-quoting transformation that breaks RS6 while satisfying the words.
→ **Applied**: restated as **"`quoteCsvCell` is the final transformation applied to any cell"**, with a mechanical forbidden pattern.

**SEC-F8 — Minor [Adjacent → Testing] — C20 left malformed-vs-foreign cursor behavior to a coin flip.** The draft said "400 or an empty page — pick one". These are not equivalent: a 400 for a well-formed foreign cursor is a cross-tenant probing oracle, and `''` is falsy so it short-circuits the predicate entirely today.
→ **Applied**: malformed → 400; well-formed-but-invisible → 200 empty page, indistinguishable from exhausted; `''` → page one, pinned by assertion.

Verified clean by this expert (no action): session and Origin gates are scope-level hooks (`app.ts:56-64`, `:72-85`) so all four new routes inherit them; all existing queries are parameterized (the two dynamic builders interpolate only `$n`); RS4 clean (plan examples and seeded fixtures are synthetic); the rotation boundary is intact and I22.6 restates it correctly; R31 clean — the empty-only delete is enforced server-side inside the transaction, not in the UI.

---

## Testing Findings

**TEST-F1 — Major — duplicate of SEC-F2.** Merged; see above.

**TEST-F2 — Major — C20's tie-break criterion is neither constructible nor falsifiable as phrased.** Two independent problems. (a) `created_at` defaults to `now()` = `transaction_timestamp()`, constant *within* a transaction but distinct across them — a tie cannot be "seeded deliberately", it needs an explicit literal (or C23's bulk path, which does tie because all its audit rows share one transaction). (b) A cursor boundary needs ≥51 rows, since `nextCursor` is emitted only when `hasMore` at `PAGE_SIZE = 50` — with the draft's three events the cursor is always `null` and the boundary property is never exercised. The expert confirmed constructibility at the integration tier before raising it (RT2).
→ **Applied**: split into three explicit cases — tie within a page (assert the id sequence), tie across a boundary (51+ rows via `generate_series`, assert `new Set([...p1,...p2]).size === 51`), and the previously-absent happy-path round-trip.

**TEST-F3 — Major — the designated E2E teardown cannot hold, and the gate that should catch it is blind.** `labeling.spec.ts:17-26` is single-account and UI-driven. C26's bulk spec labels several of the four seeded accounts. Verified against the gate: `assert-seed-preserved.sh:49-52` checks link status for all four but `:54-60` checks `.label == null` for the **orphan only** — so a bulk spec leaving `alice.tanaka` labelled **passes the gate** and silently poisons the shared stack for every later run, against which C23's own `?label=none` counts are written.
→ **Applied**: I26.5 rewritten with three obligations — API-driven teardown (idempotent, survives UI failure), extend the gate to all four accounts (red-proven), and specs record and clear exactly what they mutated.

**TEST-F4 — Major — the SC17 unblock is structurally impossible.** `saas_apps` has `UNIQUE (tenant_id, key)` (`0001_init.sql:38`) and the POST schema pins `key: z.literal('google-workspace')` (`saas-apps.ts:11`), so the demo tenant holds exactly one app — the seeded one. Registering a throwaway app 409s, which `apps.spec.ts:16-27` already asserts as expected; and the seeded app cannot be deleted to make room because C22 refuses it (4 accounts). The register→delete→re-register loop is closed against itself.
→ **Applied**: the SC17-unblock claim is **withdrawn from two places**. Adopted the reviewer's option (c): the full cycle is verified at the **integration** tier (per-test `randomUUID` tenant makes the unique constraint irrelevant); E2E covers only rename-and-restore-in-`afterEach` plus the 409. SC17 remains deferred with its real blocker identified, recorded as SC30.

**TEST-F5 — Minor — duplicate of SEC-F1.** Merged at Critical; see above.

**TEST-F6 — Minor — C24's CSV criterion passes against today's code.** Merged with FN-F7. **Both experts were partly wrong about the cause, and the orchestrator probed it rather than picking a side.** Functionality said the exporter is already correct and the defect is the consumer's `split('\r\n')`; Testing said today's code yields 3 records so a count test would be red-then-green. Measured against the real functions:

```
note "a\nb"    -> csv.split('\r\n').length === 2   (no defect)
note "a\r\nb"  -> csv.split('\r\n').length === 3   (THE defect)
note "\rlead"  -> csv.split('\r\n').length === 2   (neutralizeCell prepends ' — no defect)
```

Only a `\r\n` **pair** breaks the one-record-per-line contract. A bare `\n` is harmless (nothing splits on `\n` alone); a leading bare `\r` is harmless (`\r` is in `DANGEROUS_FIRST_CHARS`, so it is no longer first). Both reviewers were right that the draft's red-proof was impossible, and for the same underlying reason: **there is no correct `quoteCsvCell` change to revert.**
→ **Applied**: the `quoteCsvCell` change is **withdrawn**. I24.1 (boundary rejection of the whole newline class) is the fix; I24.2 becomes a regression *pin* over the three measured cases, with falsifiability demonstrated by mutating the exporter rather than reverting a non-existent change.

**TEST-F7 — Minor — I23.6 had no acceptance criterion at all.** An invariant with zero proof obligation is one that ships unimplemented. The expert confirmed it is untestable at E2E (4 accounts, `PAGE_SIZE = 50`, `nextCursor` always `null`) but straightforward at the integration tier.
→ **Applied**: added the 60-row integration criterion, and SC23 now records a **stated answer** ("proven at the integration tier instead") rather than an open Phase-2 re-evaluation.

**TEST-F8 — Minor — three new components had no test assignment.** Correctly did *not* recommend component unit tests: `apps/web` has no jsdom/Testing Library, so they are not constructible (RT2), making E2E assignment the right discharge rather than an Anti-Deferral entry.
→ **Applied**: C26 gained a component→spec mapping table; `LabelFilter` got a named assertion.

**TEST-F9 — Minor — login budget has one login of margin, unrecorded.** `auth.spec.ts` is the only login-performing spec (2 logins); with `retries: 1` a retried run consumes 4 of 5. The plan adds none, and alphabetical ordering puts `identity.spec.ts` after `auth.spec.ts`, so the budget holds.
→ **Applied**: recorded as a C26 constraint so a future login-performing test does not silently exceed it.

**TEST-F10 — Minor [Adjacent → Functionality] — C20's cursor opaqueness was argued by analogy to a different file.** The draft cited `accounts/page.tsx:145`'s `encodeURIComponent` as evidence the *events* page is safe.
→ **Applied**: verified directly — `events/page.tsx:73` already applies `encodeURIComponent` too, so the analogy happened to hold; the round-trip criterion added under FN-F1 now tests it rather than arguing it.

**TEST-F11 — Minor [Adjacent → Security] — I19.4's append-only enforcement was a grep, not a test.** The repo has two precedents for turning such greps into executed gates (`no-rotation-route.test.ts:12-23`; `api.integration.test.ts:643-666`).
→ **Applied**: C26 adds `apps/api/test/audit-append-only.test.ts`. Note this is now defense in depth rather than the primary control, since SEC-F5 promoted the schema-level `REVOKE` into C27.

Verified clean by this expert (no action): CI collection needs no config change (new files match the existing vitest project globs and Playwright `testDir`); RT3/R2 clean (no fifth copy of the seed facts); RT5/RT9 clean (C19/C21 exercise the real `projectPayload` through the real route via `app.inject`); RT8 clean — denial-path non-mutation is specified concretely, with C22's four-table count assertion called out as the strongest model.

---

## Adjacent Findings

| ID | Raised by | Routed to | Disposition |
|---|---|---|---|
| FN-F8 | Functionality | Testing | Applied — C26 obligations table |
| FN-F9 | Functionality | Security | Applied — I23.7 set-based SQL |
| SEC-F8 | Security | Testing | Applied — C20 cursor criteria |
| TEST-F10 | Testing | Functionality | Applied — verified, criterion added |
| TEST-F11 | Testing | Security | Applied — C26 test; superseded as primary control by C27 |

No adjacent finding was dropped or left unrouted.

## Quality Warnings

None. Every finding cited `file:line` and was reproduced against the tree — which is what allowed three of them (SEC-F2/TEST-F1, and the FN-F7/TEST-F6 pair) to be adjudicated against the reviewers themselves rather than accepted on assertion.

## Orchestrator Notes

**Two of the plan's "measured, not assumed" claims were not measured.** SEC-F2's (`hasRateLimit`) and SEC-F1's (the S5 guard's kind) both came from greps that stopped early. The claims were then stated with emphasis precisely because they looked like findings. Both are retracted inline in the plan with the retraction visible rather than quietly edited, and a process note was added so Phase 2 does not inherit unwarranted confidence in the remaining measured claims. The remaining ones were re-verified after round 1: the FK `confdeltype` dump, the `account_labels` count (0), the `discovery_events` grant state, the Fastify colon-segment probe, and the CSV newline behavior — the last two re-run from scratch during this round.

**The Functionality expert confirmed a false claim.** It independently graded the (wrong) `hasRateLimit` finding as "correct and genuinely valuable". Two experts contradicted it and the orchestrator settled it by direct grep. Worth carrying into Phase 3: agreement between the orchestrator and one expert is not corroboration when both may be reading the same partial evidence.

**Cycle-1's D7 lesson was honored.** No review perspective was orchestrator-performed this round; all three ran as independent delegated agents, which is what caught the orchestrator's own two false claims.

---

## Recurring Issue Check

### Functionality expert
- R1–R3: N/A · R4: clean (I23.4 per-account granularity) · R5: clean (TOCTOU closed in I22.4/I23.2) · R6: **FN-F6** (FK analysis complete; BullMQ state omitted) · R7: clean (I25.5 real `<Link>`) · R8: clean · R9: clean (same-transaction emission coherent with `withTenant`) · R10: clean (no import cycle from `audit.ts`) · R11: N/A · R12: **FN-F2** (worker-emitted kinds unenumerated) · R13–R15: N/A · R16: clean · R17–R22: N/A · R23: clean (`LabelControl.tsx:61` trims at submit) · R24: clean (additive `CREATE INDEX`; runner is per-file transactional) · R25: N/A · R26: clean · R27–R39: N/A · R40: **FN-F2** · R41: N/A · R42: **FN-F5, FN-F8** (R42-A route enumeration independently recomputed and confirmed complete) · R43–R46: N/A

### Security expert
- R1–R3: N/A · R4: clean · R5: clean · R6: clean (read-only count, appropriately scoped) · R7: clean · R8: clean · R9: clean · R10–R15: N/A · R16: cited in the withdrawn SC29 cost argument — see **SEC-F5** · R17–R22: N/A · R23: clean · R24: clean · R25: N/A · R26: clean · R27–R30: N/A · R31: clean (server-side enforcement, not UI-only) · R32–R34: N/A · R35: clean · R36–R39: N/A · R40: clean · R41: N/A · R42: **SEC-F2** (R42-B, R42-C verified clean) · R43: **SEC-F1, SEC-F4** (C22 vs the rotation boundary: clean) · R44–R46: N/A
- RS1: clean (scope-level session/Origin gates inherited by all new routes) · RS2: **SEC-F2** (the control exists; the plan's claim that it does not was the defect) · RS3: **SEC-F8**, partially **SEC-F6**; otherwise clean (all queries parameterized) · RS4: clean · RS5: clean · RS6: **SEC-F7**

### Testing expert
- R1: N/A · R2: clean (no fifth seed-fact copy) · R3: N/A · R4: clean · R5: clean · R6: N/A · R7: clean · R8: clean · R9: clean · R10–R15: N/A · R16: clean · R17–R22: N/A · R23: clean · R24: clean · R25: N/A · R26: clean · R27–R32: N/A · R33: clean (no CI config change needed) · R34: N/A · R35: clean · R36–R39: N/A · R40: **TEST-F5** · R41: N/A · R42: **TEST-F1** (R42-B glob-gap correction confirmed right) · R43: N/A · R44: clean (CI gates judged by exit status) · R45–R46: N/A
- RT1: clean · RT2: clean (two candidate findings self-rejected on constructibility — E2E pagination, component unit tests) · RT3: clean · RT4: **TEST-F2, TEST-F6** · RT5: clean · RT6: **TEST-F8** · RT7: **TEST-F1, TEST-F2, TEST-F6** · RT8: clean · RT9: clean

---

## Round-1 JSON indexes (raw)

### Functionality
```json
[{"id":"F1","severity":"Critical","title":"C20 composite cursor breaks the uuid-validated query schema; site never listed","file":"apps/api/src/routes/events.ts","line":8,"adjacent":false,"escalate":null},
{"id":"F2","severity":"Major","title":"C21 does not lock the widened DiscoveryEventListItem shape; kind:string cannot discriminate and worker-emitted kinds are unenumerated","file":"packages/api-types/src/index.ts","line":50,"adjacent":false,"escalate":null},
{"id":"F3","severity":"Major","title":"Audit events are unfilterable on GET /api/events, making scenario S3 unreachable at realistic volume","file":"apps/api/src/routes/events.ts","line":61,"adjacent":false,"escalate":null},
{"id":"F4","severity":"Major","title":"C18 IdentityAccountItem declares non-nullable confidence/linkStatus without pinning the join direction","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":143,"adjacent":false,"escalate":null},
{"id":"F5","severity":"Major","title":"R42-C member set and C24's forbidden-pattern file scope disagree; bulk note guard is mechanically unenforced","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":429,"adjacent":false,"escalate":null},
{"id":"F6","severity":"Minor","title":"C22 delete leaves in-flight sync jobs failing with no sync_failed event (appKey unresolved)","file":"apps/worker/src/sync.ts","line":92,"adjacent":false,"escalate":null},
{"id":"F7","severity":"Minor","title":"C24 specifies a quoteCsvCell change with no defect and an unachievable red-proof","file":"apps/web/src/lib/csv-export.ts","line":15,"adjacent":false,"escalate":null},
{"id":"F8","severity":"Major","title":"R42-A/B derived test obligations never enter C26's change set","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":536,"adjacent":true,"escalate":null},
{"id":"F9","severity":"Minor","title":"C23 bulk endpoint permits ~300 statements/request at 60 req/min with no set-based-SQL requirement","file":"apps/api/src/rate-limits.ts","line":5,"adjacent":true,"escalate":null}]
```

### Security
```json
[{"id":"F1","severity":"Critical","title":"C21's designated S5 regression guard tests kind='sync_completed', not 'sync_raw' — vacuous for the one kind it protects","file":"apps/api/test/api.integration.test.ts","line":451,"adjacent":false,"escalate":true},
{"id":"F2","severity":"Major","title":"R42-A's 'no test asserts hasRateLimit' is false; the sweep already exists and the derived C26 obligation is redundant","file":"apps/api/test/api.integration.test.ts","line":1151,"adjacent":false,"escalate":null},
{"id":"F3","severity":"Major","title":"DELETE /label cannot distinguish no-op from real clear and never reads the label row, so C19's before-capture has no source","file":"apps/api/src/routes/account-labels.ts","line":87,"adjacent":false,"escalate":null},
{"id":"F4","severity":"Major","title":"I22.2 misstates AAD as {tenantId, saasAppId}; it includes keyVersion, and the criterion would pass on a row with a stale credentials_key_version","file":"packages/crypto/src/index.ts","line":67,"adjacent":false,"escalate":null},
{"id":"F5","severity":"Major","title":"SC29's deferral cost analysis is contradicted by the tree; Anti-Deferral rule 7 applies to the discovery_events UPDATE/DELETE grant","file":"packages/schema/migrations/0001_init.sql","line":159,"adjacent":false,"escalate":null},
{"id":"F6","severity":"Minor","title":"C18 returns an uncapped accounts array behind LIST_RATE_LIMIT with no DoS analysis, unlike C23's explicit cap","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":140,"adjacent":false,"escalate":null},
{"id":"F7","severity":"Minor","title":"I24.3's RS6 conclusion is correct but states the wrong invariant — the property is 'quoting is last'","file":"apps/web/src/lib/csv-export.ts","line":20,"adjacent":false,"escalate":null},
{"id":"F8","severity":"Minor","title":"C20 leaves malformed/foreign cursor behavior to implementer choice, conflating parsing with cross-tenant probing","file":"apps/api/src/routes/events.ts","line":8,"adjacent":true,"escalate":null}]
```

### Testing
```json
[{"id":"F1","severity":"Major","title":"Plan's 'no test asserts hasRateLimit' claim is false; the sweep already exists with a documented red-proof","file":"apps/api/test/api.integration.test.ts","line":1150,"adjacent":false,"escalate":null},
{"id":"F2","severity":"Major","title":"C20 tie-break criterion is not constructible as phrased (now() is transaction-constant) and its cursor-boundary half cannot be exercised by a 3-event fixture","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":259,"adjacent":false,"escalate":null},
{"id":"F3","severity":"Major","title":"Designated E2E teardown is single-account and UI-driven; assert-seed-preserved.sh only checks the orphan's label, so poisoning is silent","file":"e2e/scripts/assert-seed-preserved.sh","line":54,"adjacent":false,"escalate":null},
{"id":"F4","severity":"Major","title":"SC17 unblock is unachievable: UNIQUE (tenant_id, key) plus the google-workspace key literal means a throwaway app cannot be registered","file":"packages/schema/migrations/0001_init.sql","line":38,"adjacent":false,"escalate":null},
{"id":"F5","severity":"Minor","title":"C21's S5 guard relies on a test that inserts sync_completed, never sync_raw","file":"apps/api/test/api.integration.test.ts","line":441,"adjacent":false,"escalate":null},
{"id":"F6","severity":"Minor","title":"C24's CSV newline criterion passes against today's code, so its stated red-proof is unsupported","file":"apps/web/src/lib/csv-export.ts","line":15,"adjacent":false,"escalate":null},
{"id":"F7","severity":"Minor","title":"I23.6 has no acceptance criterion at all; constructible at the integration tier with a 60-row seed","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":380,"adjacent":false,"escalate":null},
{"id":"F8","severity":"Minor","title":"Three new web components have no test assignment; LabelFilter appears in no spec","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":449,"adjacent":false,"escalate":null},
{"id":"F9","severity":"Minor","title":"Login budget under retries:1 is at 4/5 with no stated margin","file":"e2e/playwright.config.ts","line":12,"adjacent":false,"escalate":null},
{"id":"F10","severity":"Minor","title":"C20's composite-cursor opaqueness is argued by analogy rather than tested","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":264,"adjacent":true,"escalate":null},
{"id":"F11","severity":"Minor","title":"I19.4's append-only enforcement is a review-time grep with no test, despite two in-repo precedents","file":"docs/archive/review/identity-appmgmt-labeling-v2-plan.md","line":214,"adjacent":true,"escalate":null}]
```
