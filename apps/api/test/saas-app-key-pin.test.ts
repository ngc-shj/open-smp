import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as apiTypes from '@open-smp/api-types';
import {
  isConnectorKeySetUnreserved,
  CONNECTOR_APP_KEYS,
  RESERVED_EVENT_SOURCES,
} from '@open-smp/api-types';
import { saasAppBodySchema } from '../src/routes/saas-apps.js';
import { RESERVED_APP_KEYS, normalizeAppKey } from '../src/app-key.js';

// C29/I29.5 control 3, restated for C2.
//
// WHAT CHANGED. Until C2 this file's claim was that `saas_apps.key` could only
// ever be one literal, so no application could be registered under a key that
// collides with `discovery_events.source` — where a collision means sync rows,
// carrying connector-supplied payloads, answering `?source=label` alongside the
// audit trail. The contract import writes `saas_apps.key` from a CSV cell, so
// "one literal" is no longer true of every write path, and a file asserting it
// would be asserting something the product had stopped doing.
//
// WHAT IT IS NOW. The property is unchanged; only its proof moved. Three write
// paths reach the column — POST /saas-apps, POST /contract-import, and seed.ts
// — and the claim is that none of them can write a product-owned source value:
//
//   1. POST /saas-apps pins its zod field to CONNECTOR_APP_KEYS, a set asserted
//      disjoint from the reserved sources — and the route is asserted on what it
//      ACCEPTS, not on how the field is spelled (below).
//   2. POST /contract-import refuses the reserved set, on the exact bytes it
//      would store (normalizeAppKey, below).
//   3. seed.ts writes the same literal the schema pins.
//
// and that the reserved set is a DERIVATION rather than a copy: no source value
// may be spelled at its INSERT site, and every `*_EVENT_SOURCE` the shared
// package exports must be a member.
//
// SC30's exit condition and SC38's deferral both rest on this file, so it stays
// a CONTROL_FILES member.

// SC2/C2. `z.enum` over the named constant, not the old one-literal form.
// A NAMED constant matters to this detector specifically: KEY_DECLARATION stops
// at the first comma, so an inline `z.enum(['a', 'b'])` would truncate and the
// comparison below would pin a fragment.
const PINNED_KEY = 'key: z.enum(CONNECTOR_APP_KEYS)';
const SEEDED_KEY = 'google-workspace';

// Anchored on the left. The previous form was `['"]?key['"]?…` with nothing
// before it, so a zod field named `app_key` matched as a `key` declaration —
// the count assertion below would then have failed for a reason that has
// nothing to do with the property, and the file had no owner to notice.
const KEY_DECLARATION = /(?<![A-Za-z0-9_$])['"]?key['"]?\s*:\s*z\s*\.[^,)]*\)?/g;

// The source column of an `INSERT INTO discovery_events`, as far as the first
// comma. A bound placeholder is the only acceptable spelling; a literal is what
// makes the reserved set a copy that can drift from what the code writes.
const EVENT_INSERT = /INSERT INTO discovery_events\s*\([^)]*\)\s*(?:VALUES|SELECT)\s*\(?\s*[^,]+,\s*([^,]+),/gi;

function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

const API_SRC = path.join(import.meta.dirname, '..', 'src');
const WORKER_SRC = path.join(import.meta.dirname, '..', '..', 'worker', 'src');

describe('C29/I29.5 control 3: no write path registers a product-owned event source', () => {
  it('declares a zod `key` field exactly once, and it reads the connector key set', async () => {
    const files = await collectSourceFiles(API_SRC);
    expect(files.length).toBeGreaterThan(0);

    // Every zod object field named `key`, wherever it lives. Scoped to the
    // whole of apps/api/src rather than to saas-apps.ts, so extracting the
    // schema to a shared module does not carry it out of the gate silently.
    const declarations: { file: string; text: string }[] = [];
    for (const file of files) {
      const source = normalizeSource(await readFile(file, 'utf8'));
      for (const match of source.matchAll(KEY_DECLARATION)) {
        declarations.push({
          file: path.relative(API_SRC, file),
          // Collapse `z .literal(...)` back to the canonical spacing the
          // comparison uses; normalizeSource may have split the member access.
          text: match[0].replace(/\s*\.\s*/g, '.').replace(/\s*:\s*/, ': ').trim(),
        });
      }
    }

    // The count is the anti-file-move device: a second schema, or the same one
    // relocated and duplicated, fails here rather than escaping the glob.
    expect(
      declarations,
      `expected exactly one zod key declaration, found: ${JSON.stringify(declarations)}`,
    ).toHaveLength(1);
    expect(declarations[0]!.text).toBe(PINNED_KEY);
  });

  // The detector must be shown able to fire, AND shown not to fire on the field
  // name that defeated its previous form. Both directions, because a pattern
  // that over-matches breaks a green build for the wrong reason and a pattern
  // that under-matches is not a control at all (RT10).
  it.each([
    ['a bare declaration', "key: z.literal('google-workspace')", true],
    ['a quoted field name', "'key': z.string()", true],
    ['a formatter-split chain', 'key : z .string() .min(1)', true],
    ['a field whose name ends in key', 'app_key: z.string().max(64)', false],
    ['a field whose name ends in Key', 'appKey: z.string()', false],
  ])('%s is %s a key declaration', (_label, snippet, expected) => {
    expect([...normalizeSource(snippet).matchAll(KEY_DECLARATION)].length > 0).toBe(expected);
  });

  it('seeds a key the route would also accept', async () => {
    // seed.ts writes saas_apps.key directly, with no schema in the path — so
    // the column has two authors and the control is about the column, not the
    // route.
    //
    // NOT "every key seed writes is a connector key", which is false by design:
    // `ensureContractOnlyApp` seeds 'notion' precisely because SCL16 needs an
    // application with a contract and no connector visible in the demo. The
    // claim that holds for every seeded key is the reserved-set refusal below.
    const seed = await readFile(path.join(API_SRC, 'seed.ts'), 'utf8');

    expect(seed).toContain(`'${SEEDED_KEY}'`);
    expect(CONNECTOR_APP_KEYS as readonly string[]).toContain(SEEDED_KEY);
  });

  it('seeds no reserved key at all', async () => {
    // C6 gave seed.ts a SECOND application, so "it contains the pinned literal"
    // stopped being a statement about every key it writes. This file claims the
    // refusal holds on all three write paths; without this, the seed was the
    // one making that claim true by having only one key.
    //
    // A whole-file literal scan, not an app-key-position scan: locating the
    // argument would need the shape of two call sites, and the false-positive
    // cost here is a seed that may not spell 'label' in quotes anywhere — which
    // it has no reason to.
    const seed = normalizeSource(await readFile(path.join(API_SRC, 'seed.ts'), 'utf8'));

    const found = [...RESERVED_EVENT_SOURCES].filter(
      (source) => seed.includes(`'${source}'`) || seed.includes(`"${source}"`),
    );
    expect(found, `seed.ts spells a reserved event source: ${found.join(', ')}`).toEqual([]);
  });

  // The claim above is about how the field is SPELLED. These are about what it
  // ACCEPTS, and the difference is the whole reason claim 1 stopped being a
  // text comparison: a source scan cannot tell `z.enum(CONNECTOR_APP_KEYS)`
  // from a field widened to `z.string()`, and neither can an assertion that the
  // two SETS are disjoint — that stays true however the schema degrades.
  describe.each([
    ...RESERVED_EVENT_SOURCES.map((source) => [`the reserved source ${source}`, source, false] as const),
    ...CONNECTOR_APP_KEYS.map((key) => [`the connector key ${key}`, key, true] as const),
    // The cell with a failing state under `z.string()`, and the only one here
    // that has one. Without it every assertion in this block survives the
    // mutation that makes the route accept anything.
    ['a key that is neither', 'not-a-connector', false] as const,
  ])('POST /saas-apps and %s', (_label, key, accepted) => {
    it(`${accepted ? 'accepts' : 'refuses'} it`, () => {
      const parsed = saasAppBodySchema.safeParse({
        key,
        displayName: 'Anything',
        credentials: {},
      });

      expect(parsed.success).toBe(accepted);
    });
  });

  // The runtime half of the same property. The cells above prove the ROUTE
  // refuses a reserved key; this proves the guard that stops a colliding set
  // from loading at all — and it is here because the guard could not otherwise
  // be shown able to fire: with the shipped keys clean, deleting it changes
  // nothing observable. Measured, as a survived mutation.
  it.each([...RESERVED_EVENT_SOURCES])('rejects a connector key set containing %s', (source) => {
    expect(isConnectorKeySetUnreserved([SEEDED_KEY, source])).toBe(false);
  });

  it('admits the set actually shipped, and an ordinary key', () => {
    // RT10's allow side, adjacent to the boundary. A predicate that rejected
    // everything satisfies every assertion above and refuses to load the
    // process.
    expect(isConnectorKeySetUnreserved(CONNECTOR_APP_KEYS)).toBe(true);
    expect(isConnectorKeySetUnreserved(['some-future-connector'])).toBe(true);
  });

  it('refuses every reserved source, in every spelling a CSV cell can carry', () => {
    expect(RESERVED_APP_KEYS.size).toBeGreaterThan(0);

    for (const source of RESERVED_EVENT_SOURCES) {
      // Trim and case folding happen BEFORE the reserved test, so the check
      // sees the bytes that would be stored. Checking the raw cell instead
      // accepts each of these.
      for (const spelling of [source, source.toUpperCase(), ` ${source} `, `  ${source.toUpperCase()}`]) {
        expect(normalizeAppKey(spelling), `app_key ${JSON.stringify(spelling)}`).toEqual({
          rejected: 'reserved',
        });
      }
    }
  });

  // The paired allow case, adjacent to the boundary rather than far from it: a
  // refusal that also refuses ordinary keys would take the feature down while
  // every deny assertion above stayed green (RT10).
  it.each(['labels', 'label-studio', 'matcher2', 'contracts', 'google-workspace'])(
    'still admits %s',
    (key) => {
      expect(normalizeAppKey(key)).toEqual({ key });
    },
  );

  it('reserves every source value the shared package declares', () => {
    // Derived from the naming convention the declaration site enforces, not
    // from a list restated here: a fourth `*_EVENT_SOURCE` that nobody adds to
    // RESERVED_EVENT_SOURCES is a registrable key, and this is what sees it.
    const declared = Object.entries(apiTypes)
      .filter(([name, value]) => /_EVENT_SOURCE$/.test(name) && typeof value === 'string')
      .map(([, value]) => value as string);

    expect(declared.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...RESERVED_EVENT_SOURCES].sort());
    expect([...RESERVED_APP_KEYS].sort()).toEqual([...RESERVED_EVENT_SOURCES].sort());
  });

  it('writes no event source as a literal at its INSERT site', async () => {
    const files = [...(await collectSourceFiles(API_SRC)), ...(await collectSourceFiles(WORKER_SRC))];
    expect(files.length).toBeGreaterThan(0);

    const inserts: { file: string; source: string }[] = [];
    for (const file of files) {
      const text = normalizeSource(await readFile(file, 'utf8'));
      for (const match of text.matchAll(EVENT_INSERT)) {
        inserts.push({ file: path.basename(file), source: match[1]!.trim() });
      }
    }

    // Non-zero, or the assertion below is satisfied by finding nothing at all —
    // which is what a renamed table or a reworded statement would produce.
    expect(inserts.length, 'no discovery_events INSERT found to check').toBeGreaterThan(0);

    const literals = inserts.filter((insert) => /^['"]/.test(insert.source));
    expect(
      literals,
      `event source must be bound, not written inline: ${JSON.stringify(literals)}`,
    ).toEqual([]);
  });

  // The detector's own failing state, on the exact shape the matcher used to
  // have. Without this the assertion above is indistinguishable from a regex
  // that matches nothing.
  it('detects a literal source written inline', () => {
    const regressed = normalizeSource(`await tx.query(
      \`INSERT INTO discovery_events (tenant_id, source, kind, payload)
       VALUES ($1, 'matcher', 'match_completed', $2::jsonb)\`);`);

    const found = [...regressed.matchAll(EVENT_INSERT)].map((match) => match[1]!.trim());
    expect(found).toEqual(["'matcher'"]);
  });
});
