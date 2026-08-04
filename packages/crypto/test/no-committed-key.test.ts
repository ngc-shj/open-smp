import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEncryptionKeys } from '../src/index.js';

// NFR4. `docker-compose.yml` committed a fixed `ENCRYPTION_KEYS` value at three
// sites for the whole life of the repository, so any deployment that inherited
// that file had every tenant's credentials decryptable from a public clone. The
// value was described as dev/demo-only in a comment beside it, which is exactly
// how it survived: naming a hazard is not installing a detector for it.
//
// TWO HALVES, in two places, because neither can see what the other sees:
//
//   here   — no tracked artifact holds a string that would BOOT as a key.
//            Sees every file, including ones no CI job executes.
//   CI     — `docker compose config` with no `.env` exits non-zero, then
//            `scripts/setup-env.sh` makes it exit zero (compose-smoke).
//            Sees whether the stack actually stops, which no text scan can.
//
// A committed default restored under a different variable name would leave this
// file green and red the CI step; a key moved into a docs example would do the
// reverse.

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const COMPOSE = 'docker-compose.yml';

/**
 * A string that `parseEncryptionKeys` would accept as-is: `<version>:<32 bytes
 * of base64>`. 32 bytes encode to 44 characters, 43 from the alphabet plus one
 * `=` of padding.
 *
 * The version prefix is what makes this scope usable rather than merely
 * suggestive. A bare 43-character base64 run matches 400+ integrity hashes in
 * `pnpm-lock.yaml` (measured), so a scan for one would have to be silenced
 * per-file until it was silent everywhere. With the prefix the pattern matches
 * only what could be pasted into the environment and booted — which is also the
 * only form that carries the harm.
 *
 * What it does NOT see, stated rather than implied: a key split across lines, a
 * key stored under a different encoding, and a key in an untracked file. The
 * first two are not usable without an edit, and `.env`/`.env.*` are gitignored,
 * so the third cannot arrive through this repository.
 */
const USABLE_KEY = /[0-9]+:[A-Za-z0-9+/]{43}=/;

/**
 * Tracked files, read as latin1. NOT utf8: `e2e/fixtures/files/e2e-import-sjis.csv`
 * is Shift-JIS, and decoding it as utf8 replaces its invalid bytes with U+FFFD —
 * silently editing the text before the pattern ever sees it. latin1 is
 * byte-preserving, and the needle is ASCII either way.
 */
function trackedFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const files = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  // `git ls-files` outside a repository exits 128 with empty stdout, which would
  // read as "scanned everything, found nothing" — the shape that makes a scan
  // pass by scanning nothing.
  expect(files.length, 'git ls-files enumerated no tracked files').toBeGreaterThan(0);
  return files;
}

describe('NFR4: no usable encryption key is committed', () => {
  it('the pattern matches a key the crypto module would actually accept', () => {
    // The detector's own failing state, and the join between the two things it
    // has to be about at once. A pattern that no bootable key satisfies would
    // leave every assertion below green forever, and one that `parseEncryptionKeys`
    // rejects would be scanning for a string that is harmless to commit.
    const synthetic = `1:${Buffer.alloc(32, 7).toString('base64')}`;

    expect(parseEncryptionKeys(synthetic).get(1)).toEqual(Buffer.alloc(32, 7));
    expect(USABLE_KEY.test(synthetic)).toBe(true);

    // The literal this cycle removed, pinned so the detector cannot be widened
    // past the case it exists for.
    expect(USABLE_KEY.test('1:dMHgYty3ZhjhJ8bOxaTNMoenZ35KF7LBwNoT6B7b7cc=')).toBe(true);
  });

  it('no tracked file holds a string that would boot as ENCRYPTION_KEYS', () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'latin1');
      for (const [index, line] of source.split('\n').entries()) {
        const match = USABLE_KEY.exec(line);
        // The matched text is deliberately NOT echoed. A red build publishes its
        // log, and printing the key would move it from a file one clone deep to
        // a CI log that outlives the fix.
        if (match) offenders.push(`${file}:${index + 1}`);
      }
    }
    expect(offenders, 'tracked files holding a usable ENCRYPTION_KEYS value').toEqual([]);
  });

  it('every compose service takes ENCRYPTION_KEYS from a required variable', () => {
    // The text half of the fail-closed property. It cannot tell whether compose
    // STOPS — the compose-smoke job does that — but it can see all three sites
    // at once, which the boot cannot: a service that quietly dropped the
    // variable would boot fine and fail later at the first decrypt, under a
    // different key version than the one that wrote the row.
    const source = readFileSync(path.join(REPO_ROOT, COMPOSE), 'latin1');
    // The line number is carried, not just the text. All three declarations are
    // byte-identical, so a failure reporting the text alone cannot say which
    // service lost the guard — and the whole point of this assertion is that one
    // site can drift while the other two hold.
    const declarations = source
      .split('\n')
      .map((text, index) => ({ text: text.trim(), line: index + 1 }))
      .filter((d) => d.text.startsWith('ENCRYPTION_KEYS:'));

    // Three services need the key: api, worker, seed. Asserted as a count so a
    // service losing its declaration reds here rather than at a decrypt.
    expect(declarations.length, `${COMPOSE} declares ENCRYPTION_KEYS for a number of services`).toBe(3);

    const notRequired = declarations
      .filter((d) => !d.text.includes('${ENCRYPTION_KEYS:?'))
      .map((d) => `${COMPOSE}:${d.line}`);
    expect(notRequired, `${COMPOSE} declarations not using a required (\`:?\`) variable reference`).toEqual([]);
  });
});
