import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// C1/C2/C3/C5/C6/C8. Until this gate existed, `pnpm -C apps/api test` reported
// green while running one file — the integration suite — and never executing
// `api-types-boundary.test.ts` or `saas-app-key-pin.test.ts`. vitest finds the
// config by searching upward but takes `root` from the cwd, so the root config's
// `packages/**` / `apps/**` globs match nothing from inside a package, while the
// depth-agnostic `**/*.integration.test.ts` still does.
//
// The gate is two structurally independent halves. Neither alone is sufficient:
//
//   left  — the package's `test` script string is byte-identical to a canonical
//           form computed from the package's own directory. Binds the artifact.
//   right — that same argv, with `run` swapped for `list --filesOnly`, resolves
//           exactly the files the root runner assigns to that directory.
//           Proves the behavior.
//
// A gate that only did the right half would construct its own command and
// compare the root config against itself — green even after a member's script
// was reverted. A gate that only did the left half would assert about a string
// nobody runs. Both halves derive from ONE producer (`canonicalArgv`), so a
// defect in the producer surfaces as a non-zero child rather than being written
// into every manifest and then compared against itself.
//
// `vitest run --filesOnly` does not exist (CACError), and running a member's
// real script from a gate that lives inside a member package recurses — those
// two facts are why the halves are split rather than fused.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

// Every child is spawned with this env. `NODE_NO_WARNINGS` is the sanctioned
// answer to the one ambient stderr writer that cannot be silenced at source:
// Node's own runtime warnings, which differ between the local toolchain and the
// Node 22 CI pins. It provably cannot weaken the stderr assertion below —
// vitest writes its deprecation banner through `logger.deprecate` directly, not
// through `process.emitWarning`, so a restored `poolOptions` still produces the
// 196 bytes this gate reds on.
const CHILD_ENV = {
  ...process.env,
  CI: '1',
  NO_UPDATE_NOTIFIER: '1',
  npm_config_update_notifier: 'false',
  NODE_NO_WARNINGS: '1',
};

type Tier = 'unit' | 'integration';

/**
 * The single producer. The left half compares against `.join(' ')`; the right
 * half spawns this array with `run` replaced by `list --filesOnly`. Authoring
 * the two independently is what would let a producer defect be written into all
 * eight manifests and then compared against itself.
 */
function canonicalArgv(dir: string, tier: Tier): string[] {
  return ['-w', 'exec', 'vitest', 'run', '--project', tier, `${dir}/`];
}

function canonicalScript(dir: string, tier: Tier): string {
  return `pnpm ${canonicalArgv(dir, tier).join(' ')}`;
}

type Child = { status: number | null; stdout: string; stderr: string; error?: Error | undefined };

function runChild(argv: string[], cwd = REPO_ROOT): Promise<Child> {
  return new Promise((resolve) => {
    const proc = spawn('pnpm', argv, { cwd, env: CHILD_ENV, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c));
    proc.stderr.on('data', (c) => (stderr += c));
    proc.on('error', (error) => resolve({ status: null, stdout, stderr, error }));
    proc.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/**
 * Per-child discipline, applied to EVERY child this gate spawns — the vitest
 * listings, the Playwright listing, and `git ls-files` alike. `vitest list` on a
 * path that matches nothing exits 0 with empty stdout, and `git ls-files`
 * outside a repository exits 128 with empty stdout; without reading the status
 * first, both read as "resolved nothing" and a set comparison against another
 * empty set passes. The identity is carried in the assertion message so a
 * failure names the child rather than surfacing as an unattributed mismatch.
 */
function assertChildOk(identity: string, child: Child): void {
  expect(child.error, `${identity}: spawn failed — ${child.error?.message}`).toBeUndefined();
  expect(child.status, `${identity}: exited ${child.status}\n${child.stderr}`).toBe(0);
  // C6's first enforcement mechanism. Never relax this to a substring or regex
  // filter: the deprecation banner it exists to catch would be the first thing
  // such a filter swallowed. If a legitimate ambient writer ever appears, pin it
  // in CHILD_ENV or silence it at source.
  expect(child.stderr, `${identity}: expected empty stderr, got:\n${child.stderr}`).toBe('');
}

/** `[unit] apps/api/test/x.test.ts` → `apps/api/test/x.test.ts`. */
function stripProjectTag(line: string): string {
  return line.replace(/^\[[^\]]*\]\s*/, '');
}

function lines(stdout: string): string[] {
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

// Started eagerly and shared across every assertion. Two things are being
// bought here, and both were measured: memoising stops each `it` re-spawning
// the same listing (~4s → ~1.8s), and starting them at module load rather than
// on first await lets the independent children overlap instead of queueing
// (~1.8s → the figure recorded in the plan's budget). A unit suite that runs in
// ~0.7s cannot absorb a gate that serialises a dozen process spawns.
function startRootListing(tier: Tier): Promise<Set<string>> {
  return (async () => {
    const child = await runChild(['-w', 'exec', 'vitest', 'list', '--filesOnly', '--project', tier]);
    assertChildOk(`root listing (${tier})`, child);
    return new Set(lines(child.stdout).map(stripProjectTag));
  })();
}

const rootListings: Record<Tier, Promise<Set<string>>> = {
  unit: startRootListing('unit'),
  integration: startRootListing('integration'),
};

function rootListing(tier: Tier): Promise<Set<string>> {
  return rootListings[tier];
}

async function memberListing(dir: string, tier: Tier): Promise<Set<string>> {
  const argv = canonicalArgv(dir, tier).map((a) => (a === 'run' ? 'list' : a));
  argv.splice(argv.indexOf('list') + 1, 0, '--filesOnly');
  // Spawned from the package directory, which is the cwd pnpm gives the real
  // `pnpm -C <dir> test`. `-w exec` normalises cwd to the workspace root either
  // way, so this changes no result today — it removes the inference that it
  // would not, which is the kind of inference the rest of this file refuses.
  const child = await runChild(argv, path.join(REPO_ROOT, dir));
  assertChildOk(`${dir} (${tier})`, child);
  // Compared RAW, not re-filtered by a `${dir}/` prefix. The real script has no
  // such re-filter, so discarding foreign paths here would hide an over-matching
  // filter argument: the gate would compare equal while `pnpm -C <pkg> test`
  // executed a superset. Under-match reds as a subset, over-match as a superset.
  return new Set(lines(child.stdout).map(stripProjectTag));
}

type WorkspaceEntry = { name: string; path: string };

const workspaceEntriesPromise: Promise<WorkspaceEntry[]> = (async () => {
  const child = await runChild(['list', '-r', '--depth', '-1', '--json']);
  assertChildOk('pnpm list -r', child);
  return JSON.parse(child.stdout) as WorkspaceEntry[];
})();

function workspaceEntries(): Promise<WorkspaceEntry[]> {
  return workspaceEntriesPromise;
}

// The Playwright claimant runs the SAME script CI runs (`pnpm -C e2e test`),
// with `--list --reporter=json` appended. `-s` suppresses pnpm's script banner,
// which otherwise precedes the JSON on stdout and breaks the parse. Started
// eagerly alongside the vitest listings so all four overlap.
type PlaywrightSpec = { title?: string; tests?: { annotations?: { type: string }[] }[] };

type PlaywrightSuite = {
  file: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
};

type PlaywrightReport = { config: { rootDir: string }; suites: PlaywrightSuite[] };

/**
 * Specs live under `suites[].suites[]` for anything inside a `test.describe`,
 * and only at `suites[].specs` for a top-level `test(...)`. Reading the first
 * level alone makes this an assertion over an empty array — it passed against a
 * `test.describe.skip` on the auth suite until the mutation was executed.
 */
function walkSpecs(suite: PlaywrightSuite): NonNullable<PlaywrightSuite['specs']> {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(walkSpecs)];
}

const playwrightReportPromise: Promise<PlaywrightReport> = (async () => {
  const child = await runChild(['-s', '-C', 'e2e', 'test', '--list', '--reporter=json']);
  assertChildOk('playwright listing', child);
  return JSON.parse(child.stdout) as PlaywrightReport;
})();

async function manifest(dir: string): Promise<{ scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
  return JSON.parse(await readFile(path.join(REPO_ROOT, dir, 'package.json'), 'utf8'));
}

// Runners this repo knows how to account for. A deliberate allowlist, permitted
// where a package-name exemption for `e2e` was not, because the failure
// directions differ: an unrecognised runner reds (investigated), whereas a
// name-keyed exemption would have left the gate green over a package it had
// stopped checking. A package testing via `node --test` declares no runner
// dependency and reds here — correct, and it forces a deliberate entry.
const KNOWN_TEST_RUNNERS = ['vitest', '@playwright/test'] as const;

const TEST_SHAPED = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Files git considers part of this repository and present in the working tree.
 * Deliberately NOT bare `git ls-files`: that reads the index, while every
 * claimant globs the working tree, so an unstaged test file would be claimed by
 * vitest and absent here — redding on the most ordinary developer action, and
 * making the two probes that prove this control pass green.
 */
function trackedOrUntrackedFiles(): string[] {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: CHILD_ENV,
  });
  assertChildOk('git ls-files', { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error });
  return lines(r.stdout);
}

function inventory(): string[] {
  return trackedOrUntrackedFiles().filter((f) => TEST_SHAPED.test(f));
}

describe('C1/C2: package test scripts delegate to the root runner', { timeout: 60_000 }, () => {
  it('every domain member declares the canonical scripts, and only those with files in a tier declare that tier', async () => {
    const entries = await workspaceEntries();
    const unit = await rootListing('unit');
    const integration = await rootListing('integration');

    const assigned = (dir: string, set: Set<string>) => [...set].filter((f) => f.startsWith(`${dir}/`));

    // Two passes, deliberately. The domain has to be coherent before the
    // per-package obligations mean anything, and a single pass hides the
    // agreement check behind whichever clause throws first: deleting `vitest`
    // from a member's devDependencies trips clause 2 on that package before the
    // agreement is ever evaluated, so the assertion that exists to catch that
    // exact edit never runs. Found by executing the mutation against a stated
    // expected assertion rather than against "does it go red".
    const packages: { dir: string; pkg: Awaited<ReturnType<typeof manifest>>; deps: Record<string, string>; d1: boolean; d2: boolean }[] = [];
    for (const entry of entries) {
      const dir = path.relative(REPO_ROOT, entry.path);
      // D0 — the root is the authority, not a member. Without this conjunct the
      // root qualifies under D1 and D2 alike: it declares vitest and `./` is a
      // prefix of every assigned file. C8 covers it instead.
      if (dir === '') continue;
      const pkg = await manifest(dir);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      packages.push({
        dir,
        pkg,
        deps,
        d1: assigned(dir, unit).length + assigned(dir, integration).length > 0,
        d2: 'vitest' in deps,
      });
    }

    const members = packages.filter((p) => p.d1).map((p) => p.dir);
    const declaresVitest = packages.filter((p) => p.d2).map((p) => p.dir);

    // C1 Forbidden: no member's filter argument may be a prefix of another's
    // path. Asserted here rather than left to the right half — both sides of
    // that comparison apply the same `startsWith(dir + '/')` predicate, so a
    // nested member satisfies it by construction while `pnpm -C <outer> test`
    // silently runs the inner member's suite too. `packages/*` already matches
    // `packages/connectors`, so this is one `package.json` away from real.
    //
    // Before the D1 = D2 agreement, deliberately. Nesting is a property of the
    // raw enumeration and is logically prior to domain coherence: a bare nested
    // manifest makes the agreement fire first and report "has assigned files
    // but does not declare vitest", which is true, a consequence of the
    // nesting, and not the defect. That is D2's shape, regenerated by appending
    // a new assertion after the one D2 moved.
    const nested = packages.flatMap(({ dir }) =>
      packages.filter((o) => o.dir !== dir && o.dir.startsWith(`${dir}/`)).map((o) => `${dir} contains ${o.dir}`),
    );
    expect(nested, 'workspace members nested inside one another').toEqual([]);

    // Control 1 — a member set that came back empty would satisfy every
    // per-member assertion below vacuously.
    expect(members.length, 'no domain members enumerated').toBeGreaterThan(0);

    // D1 ≡ D2. Asserted, not merely stated: without it, deleting `vitest` from a
    // member's devDependencies drops it from the domain and stops binding its
    // script, restoring the condition this cycle exists to remove.
    expect([...members].sort(), 'packages with assigned files vs packages declaring vitest').toEqual([...declaresVitest].sort());

    for (const { dir, pkg, deps, d1, d2 } of packages) {
      // One predicate, not two: clauses 2 and 3 are the two directions of the
      // same question, and two copies drift the day one is widened.
      const otherRunners = KNOWN_TEST_RUNNERS.filter((r) => r !== 'vitest' && r in deps);

      if (d1 && d2) {
        // C2 clause 1 — symmetric. `test` iff the package has unit files,
        // `test:integration` iff it has integration files. Demanding `test`
        // unconditionally would mint a script that can only exit 1 for a member
        // holding integration files only — the packages/queues shape this gate
        // removes, regenerated from inside the contract that removes it.
        const wantUnit = assigned(dir, unit).length > 0 ? canonicalScript(dir, 'unit') : undefined;
        const wantInteg = assigned(dir, integration).length > 0 ? canonicalScript(dir, 'integration') : undefined;
        expect(pkg.scripts?.test, `${dir}: test script`).toBe(wantUnit);
        expect(pkg.scripts?.['test:integration'], `${dir}: test:integration script`).toBe(wantInteg);
      } else {
        // C2 clauses 2 and 4 — a non-member may declare a test script only if
        // it declares its own non-vitest runner. packages/queues declared
        // `vitest run` with no dependencies at all and resolved the binary off
        // the ancestor PATH; that is the case this rejects. Both tiers, per
        // requirement F2: an unbacked `test:integration` is the same defect on
        // the axis the tier split created.
        for (const key of ['test', 'test:integration'] as const) {
          if (pkg.scripts?.[key] === undefined) continue;
          expect(otherRunners, `${dir}: declares ${key} but no recognised non-vitest runner`).not.toHaveLength(0);
        }
      }

      // C2 clause 3 — a package declaring a non-vitest runner MUST declare a
      // test script. This pins e2e's, which root `test:e2e` invokes directly,
      // without naming the package.
      if (otherRunners.length > 0) {
        expect(pkg.scripts?.test, `${dir}: declares ${otherRunners.join(', ')} but no test script`).toBeDefined();
      }
    }
  });

  it('every member script resolves exactly the files the root runner assigns it', async () => {
    const entries = await workspaceEntries();
    const unit = await rootListing('unit');
    const integration = await rootListing('integration');
    const rootByTier: Record<Tier, Set<string>> = { unit, integration };

    const jobs: { dir: string; tier: Tier; expected: string[] }[] = [];
    for (const entry of entries) {
      const dir = path.relative(REPO_ROOT, entry.path);
      if (dir === '') continue;
      for (const tier of ['unit', 'integration'] as Tier[]) {
        const expected = [...rootByTier[tier]].filter((f) => f.startsWith(`${dir}/`));
        if (expected.length > 0) jobs.push({ dir, tier, expected });
      }
    }

    // Control 1 — a derivation that produced nothing would satisfy the loop
    // below by never entering it.
    expect(jobs.length, 'no member/tier jobs derived').toBeGreaterThan(0);

    // Control 2 — the executed (package, tier) set, asserted against a set
    // derived a different way. `jobs` comes from the workspace enumeration
    // crossed with the tier map; `assignedPairs` comes from the root listings'
    // own file paths. A tier map that silently drops a tier — or a package —
    // shrinks the first and not the second.
    //
    // An earlier draft asserted `job.expected.length > 0` inside the loop below,
    // which cannot fail: jobs are only pushed when that is already true.
    // Deleting it left the suite green, which is the definition of decorative.
    const memberDirs = entries
      .map((e) => path.relative(REPO_ROOT, e.path))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const ownerOf = (file: string): string | undefined => memberDirs.find((d) => file.startsWith(`${d}/`));

    const pairsFromListings = new Set<string>();
    const unowned: string[] = [];
    for (const tier of ['unit', 'integration'] as Tier[]) {
      for (const f of rootByTier[tier]) {
        // Longest-prefix match against the enumerated members, not a positional
        // chop of two path components. The chop assumed `<pkg>/test/<file>` and
        // invented a package name for anything nested deeper — so a red pointed
        // at a phantom package instead of at the file that caused it.
        const owner = ownerOf(f);
        if (owner === undefined) unowned.push(f);
        else pairsFromListings.add(`${owner}|${tier}`);
      }
    }
    expect(unowned, 'assigned files belonging to no workspace member').toEqual([]);
    const pairsFromJobs = new Set(jobs.map((j) => `${j.dir}|${j.tier}`));
    expect([...pairsFromJobs].sort(), 'executed (package, tier) set').toEqual([...pairsFromListings].sort());

    const results = await Promise.all(
      jobs.map(async (job) => ({ job, observed: await memberListing(job.dir, job.tier) })),
    );

    for (const { job, observed } of results) {
      expect([...observed].sort(), `${job.dir} (${job.tier})`).toEqual([...job.expected].sort());
    }
  });
});

describe('C3 positive controls: inventory, reconciliation, canaries, environment', { timeout: 60_000 }, () => {
  it('reconciles the working-tree inventory against every runner\'s observed discovery', async () => {
    const unit = await rootListing('unit');
    const integration = await rootListing('integration');

    // The join base comes from Playwright's own `config.rootDir` rather than a
    // hardcoded `e2e/specs/` — hardcoding it would be a second declaration of
    // `testDir`, going stale on exactly the narrowing this control catches.
    const report = await playwrightReportPromise;
    const playwright = new Set(
      report.suites.map((s) => path.relative(REPO_ROOT, path.join(report.config.rootDir, s.file))),
    );

    // Claim and discovery, not execution: a declaration-level skip would leave a
    // spec claimed and discovered while never running. The annotations are in
    // the JSON already parsed, so this costs nothing.
    // One walk, three consumers. Reading the same nested path twice is how the
    // guards below end up protecting a different accessor from the one the
    // skip computation uses — which is the `canonicalArgv` lesson applied to a
    // JSON shape rather than to an argv.
    const specs = report.suites.flatMap((suite) => walkSpecs(suite).map((spec) => ({ file: suite.file, spec })));
    const tests = specs.flatMap(({ file, spec }) => (spec.tests ?? []).map((t) => ({ file, title: spec.title ?? '', t })));
    const annotations = tests.flatMap(({ file, title, t }) => (t.annotations ?? []).map((a) => ({ file, title, a })));

    // Identity carried through the walk, not just the type. Collecting bare
    // annotation objects made the failure read `expected [ Array(1) ] to equal
    // []` — no file, no title — in a file whose own discipline is that a
    // failure names its cause.
    const skipped = annotations
      .filter(({ a }) => a.type === 'skip' || a.type === 'fixme')
      .map(({ file, title }) => `${file} :: ${title}`);
    expect(skipped, 'playwright specs carrying a declaration-level skip/fixme').toEqual([]);

    // Reachability, at every hop. The skip assertion above walks three levels
    // of optional chaining, and each `?? []` turns a renamed key into a silent
    // pass. The spec-level guard alone was not enough: renaming `annotations`
    // left the control green with `test.describe.skip` applied to the auth
    // suite. These three make every hop fail red instead.
    expect(specs.length, 'playwright report yielded no specs').toBeGreaterThan(0);
    expect(tests.length, 'playwright report yielded no tests').toBeGreaterThan(0);
    expect(
      tests.filter(({ t }) => !Array.isArray(t.annotations)).map(({ file, title }) => `${file} :: ${title}`),
      'playwright tests without an annotations array — the accessor no longer lands on data',
    ).toEqual([]);

    // Named canaries, at spec granularity. The claimed set above is file-level,
    // so a narrowing that leaves one spec per file standing — `--grep-invert`
    // on a single title, say — passes every set comparison. These two titles
    // are the login and session-expiry proofs; their absence is the event.
    const titles = specs.map(({ spec }) => spec.title ?? '');
    expect(titles, 'the login proof').toContain('valid login lands on /accounts with nav visible');
    expect(
      titles.filter((t) => t.includes('redirects to /login on 401')).length,
      `no session-expiry spec discovered; titles were:\n${titles.join('\n')}`,
    ).toBeGreaterThan(0);

    const files = inventory();
    // Control 5's own non-emptiness. A shrunken inventory satisfies a
    // one-directional `inventory ⊆ union` vacuously, which is why the assertion
    // below is equality rather than containment.
    expect(files.length, 'inventory is empty').toBeGreaterThan(0);

    const claimed = new Set([...unit, ...integration, ...playwright]);
    expect([...files].sort(), 'files on disk vs files claimed by a runner').toEqual([...claimed].sort());

    // Pairwise, across all three claimants — "exactly one", not "at least one".
    // The vitest integration glob is depth-agnostic and Playwright's default
    // testMatch accepts `.test.ts`, so an `e2e/specs/*.integration.test.ts` is
    // claimed by both while the union still equals the inventory.
    const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((f) => b.has(f));
    expect(overlap(unit, integration), 'claimed by both vitest projects').toEqual([]);
    expect(overlap(unit, playwright), 'claimed by vitest unit and playwright').toEqual([]);
    expect(overlap(integration, playwright), 'claimed by vitest integration and playwright').toEqual([]);
  });

  it('the union of per-member assignments equals the full root listing', async () => {
    const entries = await workspaceEntries();
    const unit = await rootListing('unit');
    const integration = await rootListing('integration');
    const all = new Set([...unit, ...integration]);

    // Control 3 — detects a member vanishing from `pnpm list -r`. It does NOT
    // detect glob narrowing: `union(partition(X)) == X` holds for every X,
    // including a shrunken one. Control 5 is what observes the globs.
    const partitioned = new Set<string>();
    for (const entry of entries) {
      const dir = path.relative(REPO_ROOT, entry.path);
      if (dir === '') continue;
      for (const f of all) if (f.startsWith(`${dir}/`)) partitioned.add(f);
    }
    expect([...partitioned].sort(), 'union of per-member assignments vs full root listing').toEqual([...all].sort());
  });

  it('every test file that is itself a security control is still assigned', async () => {
    // Control 6. Everything else here is relative: deleting a gate file shrinks
    // the inventory and the unit set together, so control 5 stays green and only
    // a named list can see it.
    //
    // The membership rule, so the next addition is mechanical rather than
    // remembered: a file belongs here when it is not a unit test of product
    // code but a control whose deletion removes a repository-wide invariant.
    // An earlier draft named two, taken from the sentence in the plan that
    // motivated the cycle rather than from that property — which left
    // workflow-pins (the only thing stopping a mutable third-party action ref)
    // deletable with every control green.
    // Two families satisfy the rule, and the discriminator only ever covered
    // one of them.
    //
    //   (a) tests that READ REPOSITORY FILES at runtime — workflow-pins reading
    //       .github/workflows, seed-gate-agreement comparing two files;
    //   (b) tests that IMPORT A DOMAIN and compare it against a second
    //       declaration — label-kinds asserting LABEL_FILTERS derives from
    //       ACCOUNT_LABEL_KINDS without widening it, link-statuses pinning the
    //       status chips to the same declaration.
    //
    // An earlier draft ran `grep -l "from 'node:fs"` and called the result
    // derived. That is family (a) only — a proxy for how *some* controls happen
    // to be implemented, not for what makes a test a control — and it dropped
    // two members of family (b) whose own headers say they are the only thing
    // checking their invariant. The rule is the property, not the grep: **a
    // test that asserts over a domain, a manifest, or a repository-wide
    // relation rather than over the behaviour of one module.**
    //
    // The list stays literal because deriving it at runtime from the unit set
    // would make a deletion shrink both sides and go green — which is the one
    // thing this control exists to catch. The addition-guard below covers what
    // a mechanical proxy can cover; family (b) still has to be added by hand,
    // and that residue is named rather than papered over.
    //
    // `package-test-parity.test.ts` is deliberately absent: if it is deleted
    // nothing runs, and if it is running it is necessarily in the unit set, so
    // an entry for it has no failing state.
    const CONTROL_FILES = [
      'apps/api/test/accounts-query-domain.test.ts', // pins the ?status= input-validation domain to z.enum(LINK_STATUSES)
      'apps/api/test/api-types-boundary.test.ts', // C39 — keeps server-only code out of the browser bundle
      'apps/api/test/audit-append-only.test.ts', // the audit trail has no update or delete path
      'apps/api/test/label-kinds.test.ts', // C29 — LABEL_FILTERS derives from ACCOUNT_LABEL_KINDS without widening it
      'apps/api/test/no-rotation-route.test.ts', // key rotation is not reachable over HTTP
      'apps/api/test/saas-app-key-pin.test.ts', // SC30 — keeps saas_apps.key off the reserved audit source
      'apps/api/test/seed-gate-agreement.test.ts', // C38 — the shell seed gate and the E2E fixtures agree
      'apps/api/test/workflow-pins.test.ts', // C32 — every GitHub Action pinned to a SHA
      'apps/web/test/label-filters.test.ts', // I37.3 — the label bar's options and order, which no E2E spec asserts
      'apps/web/test/link-statuses.test.ts', // SC42 — status chips derive from one declaration
      'apps/web/test/page-spec-membership.test.ts', // I26.6 — every page under apps/web/src/app has an E2E spec
      'apps/worker/test/upsert-link-domain.test.ts', // the last type-level checkpoint before a status reaches the enum
      'packages/matcher/test/package-edge.test.ts', // pins a manifest dependency edge pnpm hoisting would hide
    ];
    const unit = await rootListing('unit');
    expect(CONTROL_FILES.filter((f) => !unit.has(f)), 'security-control test files no longer assigned').toEqual([]);

    // Addition-guard, strictly additive. The literal list above stays the sole
    // authority for detecting DELETION; this only catches a control being
    // ADDED without being listed, which the previous form missed entirely —
    // de-listing an entry and adding a qualifying file were both green.
    //
    // The proxy is deliberately wider than the draft it replaces (double quotes,
    // the bare `fs` specifier, dynamic import, child_process were all missed by
    // `from 'node:fs`), and it is still only family (a). It cannot see family
    // (b), nor a control that reads through a shared helper — stated so this
    // guard is not read as proving the list complete.
    const READS_FILES = /from ['"](node:)?fs|import\(['"](node:)?fs|from ['"]node:child_process/;
    const unlisted = [...unit]
      .filter((f) => f !== path.relative(REPO_ROOT, import.meta.filename))
      .filter((f) => !CONTROL_FILES.includes(f))
      .filter((f) => READS_FILES.test(readFileSync(path.join(REPO_ROOT, f), 'utf8')));
    expect(unlisted, 'unit tests that read repository files but are not listed as controls').toEqual([]);
  });

  it('a pnpm selector that matches nothing fails loudly', async () => {
    // THE boundary for this class, and the only control in this file whose
    // verdict comes from pnpm instead of from reading text.
    //
    // `pnpm --filter <no-match> …` exits 0 having done nothing, so renaming a
    // package turns a CI step into a green no-op — the route that could have
    // removed the repository's only end-to-end auth and session-expiry coverage
    // from CI while every other signal stayed green. `failIfNoMatch: true` in
    // `pnpm-workspace.yaml` makes it exit 1 at the tool.
    //
    // This is asserted behaviourally, not by reading the setting, because the
    // property that matters is what pnpm DOES. Reading the config would be the
    // same surface-form move the scan below is confined to, one level down. And
    // because it holds at the tool, it holds for every notation no text scan can
    // see: quoted, inside a JSON exec array, assembled by a YAML folded scalar,
    // held in a shell variable, or behind a wrapper script — the whole of
    // SC60's residue.
    //
    // It does NOT cover `--filter <real-pkg> test` with no `test` script, which
    // still exits 0 via pnpm's `test` shorthand. That half is C2 clause 3's.
    const entries = await workspaceEntries();
    expect(entries.length, 'no workspace entries enumerated').toBeGreaterThan(0);

    // Derived from a real name rather than invented, so it stays a non-match
    // even if the workspace is renamed wholesale.
    const impossible = `${entries[0]?.name ?? 'open-smp'}-no-such-package-95f3c1`;

    const deny = await runChild(['--filter', impossible, 'exec', 'node', '--version']);
    expect(deny.error, `deny probe: spawn failed — ${deny.error?.message}`).toBeUndefined();
    expect(
      deny.status,
      `\`pnpm --filter ${impossible}\` exited 0 — the no-match route is silent again; check failIfNoMatch in pnpm-workspace.yaml`,
    ).not.toBe(0);
    // Failed for the right reason. Without this, a pnpm that cannot start at
    // all reports the boundary as present (R50 (i)/(iii)).
    expect(
      `${deny.stdout}${deny.stderr}`,
      'the no-match probe failed for some reason other than the filter matching nothing',
    ).toContain('No projects matched the filters');

    // RT10's allow side, adjacent to the boundary: the SAME command with a real
    // member must still succeed. A guard that denies legitimate work gets
    // disabled, and the protection leaves with it.
    const allow = await runChild(['--filter', entries[0]?.name ?? 'open-smp', 'exec', 'node', '--version']);
    expect(allow.error, `allow probe: spawn failed — ${allow.error?.message}`).toBeUndefined();
    expect(allow.status, `a selector matching a real member exited ${allow.status}:\n${allow.stderr}`).toBe(0);
    expect(allow.stdout, 'the allow probe produced no node version').toMatch(/v\d+\./);
  });

  it('no tracked artifact holds a literal pnpm selector', async () => {
    // A best-effort tripwire, NOT the boundary — the assertion above is. Its job
    // is to keep selector-by-name notation out of the tree so the question is
    // settled at review time rather than at the tool.
    //
    // The history is the contract. This scan was widened four times across three
    // rounds — spelling, then flag position, then file kind, then match
    // granularity — and each widening followed a demonstration that the previous
    // needle missed a member. Round 3 replaced widening with a method claimed to
    // "remove the axes"; plan review then found two axes it had never removed
    // (quoted and JSON-array forms) and one it had introduced (a classifier
    // matching against `file: line`, where `.*` spanned the boundary so any line
    // mentioning `.md: ` was exempted — fail-open). The lesson is not a better
    // regex. It is that this predicate cannot be complete, which is why the
    // boundary above exists and why this is declared a tripwire.
    //
    // Three things changed as a result, and each removes a maintenance burden
    // rather than adding a case:
    //
    //  1. LINE COMMENTS ARE STRIPPED. The expected set is therefore EMPTY. The
    //     previous form pinned matched lines as a literal list, so every comment
    //     explaining why `--filter` was abandoned had to be added to it — a
    //     hand-maintained member set that grew to three the moment
    //     `pnpm-workspace.yaml` documented the boundary. An empty expected set
    //     is a real invariant; a growing literal list is bookkeeping.
    //  2. THE DECISION IS SCOPED TO PNPM'S OWN ARGV. `pnpm exec grep -F needle`
    //     passes `-F` to grep, not to pnpm; the old form redded on it, and on
    //     `pnpm exec curl -sF` and `pnpm exec tsx x.ts -Force`. Scanning up to
    //     the hand-off token removes that whole false-red class by construction.
    //  3. MARKDOWN IS EXCLUDED BY FILE KIND. CI executes no markdown. The old
    //     form claimed in its own comment to be "keyed on the file being
    //     markdown, not on the directory" while being keyed on both — and the
    //     `docs/` anchor is what made the classifier leak.
    //
    // Residue, stated rather than chased: a YAML folded scalar (`run: >`) that
    // assembles `pnpm` and the selector from separate physical lines, and a `#`
    // inside a quoted string that this strip reads as a comment. Both are MISS
    // (measured). Neither is a hole in the hazard — the boundary above covers
    // them — and closing them needs the host format's parser, which C8 refused
    // on dependency grounds. SC60.
    const SELECTOR_FAMILY = /^(--filter[a-z-]*(=.*)?|-[a-zA-Z]*F[a-zA-Z]*)$/;

    // After these, the remaining argv belongs to a program pnpm invokes, and its
    // flags are not pnpm's to interpret. `--` ends pnpm's own options.
    const HANDOFF = new Set(['exec', 'dlx', 'x', '--']);

    // `#` and `//` only when at line start or preceded by whitespace, so
    // `https://…`, `file#frag`, and `echo "#"` are not treated as comments.
    const stripLineComment = (line: string): string => line.replace(/(^|\s)(#|\/\/).*$/, '');

    const selectorLines = (source: string): string[] => {
      const joined = source.replace(/\\\n[ \t]*/g, ' ');
      const held: string[] = [];
      for (const raw of joined.split('\n')) {
        for (const cmd of stripLineComment(raw).split(/[;|&]+/)) {
          // Split on commas too, and strip bracket/quote punctuation, so
          // `["pnpm", "--filter", "e2e", "build"]` — the Dockerfile/compose exec
          // form, already used by three CMD lines and one compose service —
          // tokenises the same as the shell form.
          const tokens = cmd
            .split(/[\s,]+/)
            .map((t) => t.replace(/^[[("'`]+|[\])"'`]+$/g, ''))
            .filter(Boolean);
          const at = tokens.indexOf('pnpm');
          if (at < 0) continue;
          const own: string[] = [];
          for (const t of tokens.slice(at + 1)) {
            if (HANDOFF.has(t)) break;
            own.push(t);
          }
          if (own.some((t) => SELECTOR_FAMILY.test(t))) {
            held.push(raw.trim());
            break;
          }
        }
      }
      return held;
    };

    // Anti-vacuity, and RT10's allow side, both against synthetic input. The
    // expected set below is empty, so a predicate that matched NOTHING would
    // pass — the literal list this replaced provided that proof incidentally,
    // and it has to be provided deliberately now.
    expect(selectorLines('RUN pnpm --filter @open-smp/web build'), 'the predicate no longer detects the plain form').toHaveLength(1);
    expect(selectorLines('RUN ["pnpm", "--filter", "e2e", "build"]'), 'the predicate no longer detects the exec-array form').toHaveLength(1);
    expect(selectorLines('RUN pnpm -rF x build'), 'the predicate no longer detects clustered short flags').toHaveLength(1);
    expect(selectorLines('RUN pnpm -C apps/web build'), 'the predicate reds on the sanctioned directory form').toEqual([]);
    expect(selectorLines('RUN pnpm exec grep -F needle file.txt'), "the predicate reds on a sub-program's own -F").toEqual([]);

    // The family is pinned against pnpm's own flag surface. The previous form
    // extracted candidates with `/--filter[a-z-]*/g` and then asserted each
    // matched SELECTOR_FAMILY — the same production twice, so the filtered array
    // was empty for EVERY possible input and the pin could not fire. It was the
    // ninth vacuous assertion found in this file and the first found by review
    // rather than by mutation.
    //
    // The real pin reads the declaration column of pnpm's "Filtering options"
    // block and requires every flag declared there to be either in the family or
    // on an explicitly reviewed non-selector list. A new selector flag is then
    // neither, and reds. Measured on pnpm 10.34.5: the block declares
    // `--changed-files-ignore-pattern`, `--fail-if-no-match`, `--filter`,
    // `--filter-prod`, `--test-pattern`, `-F`.
    //
    // Only the declaration column is read (2-10 leading spaces). Descriptions
    // wrap at column 48 and split flag names across lines
    // (`--changed-files-ignore-` / `pattern=…`), which a whole-block scan
    // mis-extracts as a flag that does not exist.
    const NON_SELECTOR_FILTERING_FLAGS = new Set([
      '--changed-files-ignore-pattern',
      '--test-pattern',
      // Not a selector — it is the boundary the first assertion in this describe
      // observes behaviourally.
      '--fail-if-no-match',
    ]);

    const help = await runChild(['run', '--help']);
    assertChildOk('pnpm run --help', help);
    const helpLines = help.stdout.split('\n');
    const blockStart = helpLines.findIndex((l) => /^Filtering options/.test(l));
    expect(blockStart, 'pnpm run --help declares no Filtering options block; the family cannot be pinned').toBeGreaterThanOrEqual(0);
    let blockEnd = helpLines.length;
    for (let i = blockStart + 1; i < helpLines.length; i++) {
      const line = helpLines[i];
      if (line && /^\S/.test(line) && line.trim()) {
        blockEnd = i;
        break;
      }
    }
    const declared = [
      ...new Set(
        helpLines
          .slice(blockStart + 1, blockEnd)
          .map((l) => /^ {2,10}(-{1,2}[A-Za-z][A-Za-z0-9-]*)/.exec(l)?.[1])
          .filter((f): f is string => Boolean(f)),
      ),
    ];
    expect(declared.length, 'no flags parsed from the Filtering options block').toBeGreaterThan(0);
    expect(
      declared.filter((f) => SELECTOR_FAMILY.test(f)).sort(),
      'the family matches none of the flags pnpm declares under Filtering options',
    ).not.toEqual([]);
    expect(
      declared.filter((f) => !SELECTOR_FAMILY.test(f) && !NON_SELECTOR_FILTERING_FLAGS.has(f)).sort(),
      'pnpm declares a filtering flag that is neither in the selector family nor reviewed as a non-selector',
    ).toEqual([]);

    // This file necessarily contains the pattern, in the predicate and in the
    // comments explaining it. `import.meta.filename`, not
    // `new URL(import.meta.url).pathname` — the latter is percent-encoded, so a
    // checkout path containing a space would never match an inventory entry and
    // the gate would red on itself forever.
    const self = path.relative(REPO_ROOT, import.meta.filename);

    const inventoryFiles = trackedOrUntrackedFiles();
    const scanned = inventoryFiles.filter((f) => f !== self && !f.endsWith('.md'));
    expect(scanned.length, 'nothing scanned').toBeGreaterThan(0);
    // Only two exclusions are sanctioned. A third added later reds here rather
    // than silently shrinking the scanned set.
    expect(
      inventoryFiles.filter((f) => !scanned.includes(f) && f !== self && !f.endsWith('.md')),
      'files excluded from the selector scan for no stated reason',
    ).toEqual([]);

    // What was actually READ is pinned, not what was selected for scanning: an
    // exclusion written inside this loop, or a file swallowed by the catch, is
    // otherwise invisible.
    const read: string[] = [];
    const holders = scanned.flatMap((f) => {
      let source: string;
      try {
        source = readFileSync(path.join(REPO_ROOT, f), 'utf8');
      } catch {
        // Binary or unreadable: not a place a shell command is invoked from.
        return [];
      }
      read.push(f);
      return selectorLines(source).map((l) => `${f}: ${l}`);
    });
    expect(scanned.filter((f) => !read.includes(f)), 'files in scope that were never read').toEqual([]);

    expect(holders.sort(), 'artifacts holding a literal pnpm selector').toEqual([]);
  });

  it('the Dockerfile dependency stage copies every workspace manifest', async () => {
    // `pnpm install --frozen-lockfile` is SILENT when a lockfile importer has no
    // manifest on disk, so an omitted COPY installs none of that member's
    // registry dependencies and the image builds green. The list was
    // hand-enumerated and had been missing api-types and e2e.
    //
    // A fail-closed verification gate over Dockerfile TEXT. The adjudicator for
    // what the image actually contains is the builder, not this parse: the
    // image-level form is `docker build --target deps`, recorded as step 4 of the
    // manual test plan. Neither subsumes the other — a leaf member with no
    // dependencies and no dependents is invisible in the image and visible here
    // (SC62).
    const entries = await workspaceEntries();
    expect(entries.length, 'no workspace entries enumerated').toBeGreaterThan(0);

    // Continuations are joined first. C9 treats line assembly as an axis it must
    // normalise away and proved a Dockerfile continuation defeats a
    // physical-line scan (M57); this assertion modelled physical lines in the
    // same file — R33's shape inside one `it`.
    const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8')
      .replace(/\\\n[ \t]*/g, ' ')
      .split('\n');

    // Every matcher here is case- and flag-tolerant. Dockerfile instructions are
    // case-insensitive; `FROM --platform=$BUILDPLATFORM …`, `RUN --mount=… pnpm
    // install` and `COPY --link` are all idiomatic BuildKit and all plausible
    // next edits. A strict matcher reds on a legitimate change, and a false red
    // is what gets a gate relaxed rather than fixed.
    const isStage = (l: string): boolean => /^FROM\b/i.test(l);
    const depsStart = dockerfile.findIndex((l) => /^FROM\s+(--\S+\s+)*\S+\s+AS\s+deps\s*$/i.test(l));
    expect(depsStart, 'no `FROM … AS deps` stage in the Dockerfile').toBeGreaterThanOrEqual(0);

    // Bounded to the stage. The previous form searched to end of file, so if the
    // deps install were moved out while a later stage had one, the slice would
    // span stages and COPY lines belonging to a different stage would satisfy
    // the check — the assertion would report on a subject other than the one it
    // names.
    const nextStage = dockerfile.findIndex((l, i) => i > depsStart && isStage(l));
    const stageEnd = nextStage < 0 ? dockerfile.length : nextStage;
    const installAt = dockerfile.findIndex(
      (l, i) => i > depsStart && i < stageEnd && /^RUN\s+(--\S+\s+)*pnpm\s+install\b/i.test(l),
    );
    expect(installAt, 'no `RUN pnpm install` inside the `deps` stage').toBeGreaterThan(depsStart);

    // The Problem statement above is a property of `--frozen-lockfile`. Without
    // it the image resolves versions outside the reviewed lockfile, and nothing
    // else in the repository pins this line.
    expect(
      dockerfile[installAt],
      "the deps stage's install does not pass --frozen-lockfile, so the image can resolve outside the lockfile",
    ).toContain('--frozen-lockfile');

    // Where each COPY source actually LANDS, not merely that a source token
    // appears. `COPY packages/schema/package.json packages/matcher/package.json`
    // passed the previous form while leaving `packages/schema` with no manifest —
    // the exact silent-install condition this gate exists for — and additionally
    // clobbering another member's.
    //
    // Both destination spellings are accepted: `COPY a/package.json
    // a/package.json` and `COPY a/package.json a/` land in the same place, and
    // rejecting the second would be a false red.
    const landings = dockerfile.slice(depsStart, installAt).flatMap((l) => {
      const tokens = l
        .split(/[\s,]+/)
        .map((t) => t.replace(/^[["'`]+|[\]"'`]+$/g, ''))
        .filter(Boolean);
      if (tokens[0]?.toUpperCase() !== 'COPY') return [];
      // Token comparison, never an interpolated RegExp: `dir` comes from
      // `pnpm list -r` and is PR-influenceable — a dot became a metacharacter
      // matching a different package's line (fail-open), and a bracket threw an
      // uncaught SyntaxError.
      const args = tokens.slice(1).filter((t) => !t.startsWith('--'));
      const dest = args.at(-1);
      if (!dest || args.length < 2) return [];
      // Normalised, because the builder normalises: `./apps/api/package.json`
      // and `apps/api/package.json` are the same path to Docker, and three
      // legitimate spellings redded before this — the same notation-versus-
      // resolution mistake this whole contract keeps recording, one level down.
      // `path.posix.normalize`, not a lowercase fold: Dockerfile paths are
      // case-sensitive on Linux, so folding case would make two distinct
      // manifests compare equal.
      const norm = (p: string): string => path.posix.normalize(p);
      return args.slice(0, -1).map((source) => ({
        source: norm(source),
        at: norm(dest.endsWith('/') || dest === '.' ? path.posix.join(dest, path.posix.basename(source)) : dest),
      }));
    });

    // Anti-vacuity and RT10's allow side, against synthetic input: the
    // assertions below compare against an empty expected set, so a parse that
    // extracted NOTHING would pass every one of them.
    expect(/^FROM\s+(--\S+\s+)*\S+\s+AS\s+deps\s*$/i.test('FROM --platform=$BUILDPLATFORM node:22 AS deps'), 'the FROM matcher reds on --platform').toBe(true);
    expect(/^FROM\s+(--\S+\s+)*\S+\s+AS\s+deps\s*$/i.test('from base as deps'), 'the FROM matcher is case-sensitive').toBe(true);
    expect(/^RUN\s+(--\S+\s+)*pnpm\s+install\b/i.test('RUN --mount=type=cache,target=/pnpm pnpm install --frozen-lockfile'), 'the RUN matcher reds on --mount').toBe(true);
    expect(landings.length, 'no COPY landings parsed from the deps stage').toBeGreaterThan(0);

    const memberDirs = entries.map((e) => path.relative(REPO_ROOT, e.path)).filter(Boolean);
    // Guards the DERIVED set. `entries.length` above guards the raw enumeration,
    // which includes the workspace root; a defect in the map/filter below would
    // leave this list empty, `missing` empty, and the `it` green having checked
    // no member at all.
    expect(memberDirs.length, 'no workspace member directories derived').toBeGreaterThan(0);
    expect(memberDirs.length, 'the derived member set is smaller than the raw enumeration by more than the root').toBe(entries.length - 1);

    const missing = memberDirs.filter(
      (dir) => !landings.some((l) => l.source === `${dir}/package.json` && l.at === `${dir}/package.json`),
    );
    expect(missing, 'workspace members not COPYed into the deps stage before `pnpm install`').toEqual([]);

    // The root is the one entry `filter(Boolean)` above removes — its relative
    // path is the empty string. Revision 7 left that subtraction undeclared and
    // uncomplemented, which is the shape the plan treats as load-bearing for D0
    // and C8. These are its complement.
    //
    // `pnpm-workspace.yaml` is not cosmetic here: it carries `failIfNoMatch`,
    // the boundary the first assertion in this describe observes. If it does not
    // reach the image, `pnpm --filter <no-match>` is silent again inside every
    // build stage.
    for (const required of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
      expect(
        landings.some((l) => l.source === required && l.at === required),
        `\`${required}\` is not COPYed to the deps stage root; the workspace root manifest and its settings must reach the image`,
      ).toBe(true);
    }
  });

  it('pnpm resolves, so a PATH failure reads as a PATH failure', async () => {
    // Control 4. Without it every child fails identically and the gate reports a
    // parity mismatch for an environment problem.
    const child = await runChild(['--version']);
    assertChildOk('pnpm --version', child);
  });
});

describe('C5: exactly one vitest config exists', { timeout: 60_000 }, () => {
  it('the repository declares vitest configuration in one place', () => {
    // Counting files that exist is not the prohibited pattern — no config source
    // is read. Deleting apps/web/vitest.config.ts was a one-time cleanup; this
    // is what keeps it deleted, because the parity gate is structurally blind to
    // a re-added twin (children run with cwd at the repo root, so it is never
    // consulted).
    //
    // `vite(st)?`, not `vitest`: vitest also resolves `vite.config.*` carrying a
    // `test` key, so matching only the `vitest.*` spelling would leave a second
    // declaration invisible to the one control that watches for it.
    const found = trackedOrUntrackedFiles().filter((f) => /(^|\/)vite(st)?\.(config|workspace)\.[^/]+$/.test(f));
    expect(found.sort()).toEqual(['vitest.config.ts']);
  });
});

describe('C6: the declared pool behaviour is the effective pool behaviour', { timeout: 60_000 }, () => {
  it('neither the root test config nor any project declares an unrecognised option', async () => {
    // Imported through a computed specifier: the root config sits outside this
    // package's tsconfig `include`, and a literal `.ts` path is rejected under
    // `allowImportingTsExtensions: false`. Vite transforms it at runtime either
    // way. This is a live module import and inspection of the resulting object,
    // not a parse of its source — the same category as reading package.json for
    // a key, and deliberately not the source-text inference the plan forbids.
    const specifier = pathToFileURL(path.join(REPO_ROOT, 'vitest.config.ts')).href;
    const mod = (await import(/* @vite-ignore */ specifier)) as { default?: unknown };
    const cfg = (mod.default ?? mod) as { test: Record<string, unknown> };

    // An ALLOWLIST, not a denylist. A denylist of the two keys that disable
    // parallelism today would miss `maxWorkers: '50%'` (resolves to 1 on a
    // 2-core runner), `sequence.concurrent`, `isolate`, and whatever vitest
    // renames them to next. The repo already rejected the denylist shape twice
    // in cycle 3 — see the comment block in api-types-boundary.test.ts.
    //
    // Note the object levels: vitest's project entries are `{ test: {...} }`
    // wrappers, so the options live one level below `projects[i]`. Asserting
    // against `projects[i]` itself would red on the correct config, and the
    // obvious repair — permitting `test` — would leave this inspecting nothing.
    expect(Object.keys(cfg.test).sort(), 'root test keys').toEqual(['projects']);

    const projects = cfg.test.projects as { test?: Record<string, unknown> }[];
    expect(Array.isArray(projects), 'test.projects is an array').toBe(true);
    // Cardinality guard. Without it the loop below reports green over an empty
    // array while examining nothing — the same shape as the control-2 defect in
    // D3, and this loop is the only enforcement keeping `pool` out of the config.
    expect(projects.length, 'no projects inspected').toBeGreaterThan(0);
    // `pool` is deliberately NOT permitted. Re-adding `pool: 'forks'` is the
    // change measured at 13.8s against 7.2s — the tier ran on the default pool
    // all along because the deprecated `poolOptions` sibling made vitest discard
    // the declaration. Anything that wants a pool back must add it here first.
    const permitted = ['exclude', 'hookTimeout', 'include', 'name', 'testTimeout'];
    for (const project of projects) {
      // vitest also accepts string entries (globs/paths); Object.keys on one
      // would be meaningless, so the shape is asserted rather than assumed.
      expect(typeof project, 'project entry is an inline object').toBe('object');
      expect(Object.keys(project), 'project entry keys').toEqual(['test']);
      const keys = Object.keys(project.test ?? {});
      expect(keys.filter((k) => !permitted.includes(k)), `project ${project.test?.name}: unrecognised keys`).toEqual([]);
    }
  });
});

describe('C8: the root scripts CI invokes still mean what their names say', { timeout: 60_000 }, () => {
  it('pins the value of every root script the CI workflow runs', async () => {
    const pkg = await manifest('.');
    // A literal list, deliberately not derived from ci.yml: deriving it would
    // make the pinned SET shrink whenever the workflow shrank, which is the
    // silent-narrowing shape control 5 exists to close, relocated into this
    // gate's own input. The list was CHOSEN by enumerating ci.yml's
    // `run: pnpm …` lines (23, 24, 25, 42, 151). Root `test` and `build` are
    // deliberately absent — no CI path invokes either.
    //
    // This gate does NOT assert that ci.yml still invokes them. Establishing
    // that from a text read is inference from dialect-bearing text: a commented
    // step, an `if: false`, or `continue-on-error: true` each leaves the string
    // intact while removing the invocation. See SC56 in the plan.
    expect(pkg.scripts).toMatchObject({
      lint: 'eslint .',
      typecheck: 'pnpm -r --parallel exec tsc --noEmit',
      'test:unit': 'vitest run --project unit',
      'test:integration': 'vitest run --project integration',
      'test:e2e': 'pnpm -C e2e test',
    });
  });
});
