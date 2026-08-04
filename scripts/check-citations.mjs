#!/usr/bin/env node
// Resolves every `path:line` / `path:start-end` citation in a set of files and
// reports the ones that do not point where they say.
//
// WHY THIS EXISTS. Three consecutive review rounds on the account-status branch
// found the same mechanism: a commit edits a file and, in the same commit,
// invalidates a citation into that file — including citations it wrote itself.
// A comment grew by seven lines and the range quoting it did not; a test file
// shifted by three and the range reconciled in that very commit did not move.
// Every instance was mechanically detectable and none was caught by reading,
// across three rounds and nine expert passes. That is the signal to stop
// re-reading and to check.
//
// WHAT IT CHECKS
//   1. the cited file exists;
//   2. the cited line (or range) is within it;
//   3. **the range does not truncate a `//` comment block** — the defect that
//      recurred. A range whose last line is a `//` comment continued on the
//      next line is stopping mid-thought, and the half it cuts is the half a
//      reader never sees. Same for a range that starts mid-block.
//
// A KNOWN LIMIT, learned the hard way. It cannot tell a live citation from a
// NARRATIVE about a dead one — "the fix re-pointed four documents to foo.ts:1-2"
// parses as a citation to foo.ts:1-2. The right response is to rephrase the
// narrative (drop the colon form), never to "correct" the range: that would
// falsify the record to satisfy the gate, which is the failure a gate is
// supposed to prevent, not cause.
//
// WHAT IT DOES NOT. It cannot tell whether the cited lines SAY what the citing
// text claims. That is the reader's job and always was; this only removes the
// class where the reader is looking at the wrong lines. Declared here rather
// than left to be discovered (R49).
//
// Usage:
//   node scripts/check-citations.mjs [file ...]     # default: git diff --name-only main...HEAD

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// A citation is a repo-relative-looking path with a known extension, then :N or :N-M.
// Anchored on a non-word char so `foo.ts:12` inside a longer token is not a hit.
const CITATION =
  /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|mjs|cjs|sql|md|json|sh|ya?ml))[:#](\d+)(?:[-–](\d+))?/g;

// Extensions whose comment syntax the block check understands.
const LINE_COMMENT = { '.ts': '//', '.tsx': '//', '.js': '//', '.mjs': '//', '.cjs': '//', '.sql': '--' };

// The default subject is what this change touches, not the whole repository.
// Repo-wide the tree carries 46 of these, almost all in archived review
// documents from finished cycles — historical records whose ranges decayed as
// the code moved. Redding CI on those would be a gate nobody could keep green,
// and a gate nobody can keep green gets switched off. Scope it to the diff and
// it stays honest.
function targets() {
  if (process.argv.length > 2) return process.argv.slice(2);
  const base = process.env.CITATION_BASE ?? firstResolvable(['main', 'origin/main']);
  if (!base) {
    console.error('check-citations: no base ref (tried main, origin/main); pass files explicitly');
    process.exit(2);
  }
  return execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function firstResolvable(refs) {
  for (const r of refs) {
    try {
      execSync(`git rev-parse --verify --quiet ${r}`, { stdio: 'ignore' });
      return r;
    } catch {
      /* not present in this checkout */
    }
  }
  return null;
}

// Repo files by basename, so a short-form citation — one written without its
// directory — resolves too. Only when the basename is unique — an ambiguous one is not a
// citation this can adjudicate, and guessing would be worse than skipping.
const byBasename = new Map();
for (const f of execSync('git ls-files', { encoding: 'utf8', cwd: ROOT }).split('\n').filter(Boolean)) {
  const b = path.basename(f);
  byBasename.set(b, byBasename.has(b) ? null : f);
}

function resolveCited(p) {
  for (const cand of [path.join(ROOT, p), path.resolve(p)]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  if (!p.includes('/')) {
    const hit = byBasename.get(p);
    if (hit) return path.join(ROOT, hit);
  }
  return null;
}

const findings = [];

for (const file of targets()) {
  const abs = path.join(ROOT, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;
  const lines = readFileSync(abs, 'utf8').split('\n');

  lines.forEach((line, i) => {
    for (const m of line.matchAll(CITATION)) {
      const [, citedPath, startRaw, endRaw] = m;
      const start = Number(startRaw);
      const end = endRaw ? Number(endRaw) : start;
      const at = `${file}:${i + 1}`;
      const cite = `${citedPath}:${startRaw}${endRaw ? `-${endRaw}` : ''}`;

      const target = resolveCited(citedPath);
      if (!target) continue; // not a repo path (a URL fragment, a package name, an example)

      const targetLines = readFileSync(target, 'utf8').split('\n');
      if (start < 1 || end < start) {
        findings.push({ at, cite, why: 'malformed range' });
        continue;
      }
      if (end > targetLines.length) {
        findings.push({ at, cite, why: `out of bounds — ${citedPath} has ${targetLines.length} lines` });
        continue;
      }

      // RANGES ONLY. A single-line citation points at one line on purpose —
      // "the sentence at :183" is not a truncation, and treating it as one
      // would make this gate red on its own correct uses. The defect this
      // exists for is a RANGE that stops while its subject continues.
      if (!endRaw) continue;

      const marker = LINE_COMMENT[path.extname(target)];
      if (!marker) continue;
      const isComment = (n) => (targetLines[n - 1] ?? '').trimStart().startsWith(marker);

      // The recurring defect, stated precisely: a range that stops MID-SENTENCE
      // while the comment continues. Citing a sub-range of a longer comment is
      // ordinary and correct — you cite the sentence, not the whole block — so
      // "ends inside a comment" is not the signal. "Ends without finishing the
      // thought" is: that is what a range left behind by a grown target looks
      // like, and it is what every instance on this branch looked like.
      const text = (n) => (targetLines[n - 1] ?? '').trimStart().replace(/^(\/\/|--)\s?/, '').trimEnd();
      const finishes = (n) => /[.!?:;]["'`)\]]*$/.test(text(n)) || text(n) === '';
      if (isComment(end) && isComment(end + 1) && !finishes(end)) {
        findings.push({
          at,
          cite,
          why: `stops mid-sentence — ${citedPath}:${end} ends "…${text(end).slice(-40)}" and :${end + 1} continues it`,
        });
      }
    }
  });
}

if (findings.length === 0) {
  console.log('check-citations: every resolvable citation points where it says');
  process.exit(0);
}

for (const f of findings) console.error(`${f.at}: ${f.cite} — ${f.why}`);
console.error(`\ncheck-citations: ${findings.length} citation(s) do not point where they say`);
process.exit(1);
