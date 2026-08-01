#!/usr/bin/env node
// Mutation harness. Breaks one decision at a time and reports which assertion
// noticed.
//
// WHY THIS EXISTS AS A COMMITTED TOOL. Cycle 6 wrote 78 mutations, cycle 7 and 8
// wrote 53 more, and every one of them lived in a temp directory and vanished.
// What is worth keeping is not the mutation list — those go stale with the code
// they cut, and each cycle's are recorded in its plan — but the three rules that
// kept the runs honest, each of which was learned by getting it wrong:
//
//   1. ASSERT THE ANCHOR. A find-string that matches nothing produces a green
//      run that reads as "the mutation survived" when nothing was mutated. Every
//      anchor must occur EXACTLY once; zero and two are both errors.
//   2. START CLEAN. The restore is `git checkout -- .`, which discards
//      uncommitted work. A dirty tree loses it.
//   3. A SURVIVOR IS A FINDING, NOT A FAILURE. Some mutations are
//      behaviour-preserving and survive correctly; those are declared, so the
//      undeclared survivors stand out. Cycle 7's most valuable finding was one
//      of those — a test block that could not fail on the property it named.
//
// Usage:
//   node scripts/mutate.mjs <spec.mjs>
//
// A spec default-exports { mutations: [...] }, each entry:
//   { name, file, find, replace, run: ['<vitest file path>'], expectSurvives? }
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = process.cwd();

function run(command) {
  execSync(command, { cwd: ROOT, stdio: 'pipe', timeout: 900_000 });
}

function assertCleanTree() {
  const dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
  if (dirty) {
    console.error('mutate: the tree is not clean, and the restore discards uncommitted work:');
    console.error(dirty);
    process.exit(2);
  }
}

export function applyOnce(source, find, replace) {
  const occurrences = source.split(find).length - 1;
  if (occurrences !== 1) {
    return { error: `anchor occurs ${occurrences} times, expected exactly 1` };
  }
  return { mutated: source.replace(find, replace) };
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('usage: node scripts/mutate.mjs <spec.mjs>');
    process.exit(2);
  }
  assertCleanTree();

  const spec = await import(pathToFileURL(path.resolve(specPath)).href);
  const mutations = spec.default?.mutations ?? spec.mutations ?? [];
  if (mutations.length === 0) {
    console.error('mutate: the spec declares no mutations');
    process.exit(2);
  }

  const results = [];
  for (const mutation of mutations) {
    const original = readFileSync(mutation.file, 'utf8');
    const applied = applyOnce(original, mutation.find, mutation.replace);
    if (applied.error) {
      results.push({ name: mutation.name, ok: false, verdict: `ANCHOR MISS — ${applied.error}` });
      console.log(`FAIL ${mutation.name} -> ${applied.error}`);
      continue;
    }
    writeFileSync(mutation.file, applied.mutated);

    const reds = [];
    for (const target of mutation.run) {
      const project = target.includes('.integration.') ? 'integration' : 'unit';
      try {
        run(`pnpm exec vitest run --project ${project} ${target}`);
      } catch {
        reds.push(path.basename(target));
      }
    }
    run('git checkout -- .');

    const redded = reds.length > 0;
    const ok = mutation.expectSurvives ? !redded : redded;
    const verdict = redded ? `reds ${reds.join(', ')}` : 'SURVIVED';
    results.push({ name: mutation.name, ok, verdict });
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${mutation.name} -> ${verdict}` +
        (mutation.expectSurvives ? ' (survival declared)' : ''),
    );
  }

  console.log('\n=== summary ===');
  for (const result of results) {
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name}: ${result.verdict}`);
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

// Importable for its own test without running a suite.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}
