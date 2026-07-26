import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as apiTypes from '@open-smp/api-types';

// C39/I39.1. `@open-smp/api-types` is imported by apps/api AND apps/web, so what
// it exports crosses into the browser bundle. C8 originally read "type-only, no
// runtime exports"; C29 made that false by adding the label-kind domain, and the
// amended wording permits primitive domain constants and the type guards over
// them — but no I/O, no imports from apps/*, no server-only modules.
//
// That amendment lived only in a comment. This is what makes it executable.
//
// Stated as an ALLOWLIST over what is actually exported at runtime, not as a
// denylist of forbidden tokens. Two earlier drafts of this gate (cycle 3) went
// the other way and were rejected both times: a bare `process` / `globalThis`
// token substring-matches plausible field names and prose in a package whose
// entire domain is wire shapes, and a denylist can only forbid what someone
// thought to list. What may cross is a much smaller set than what may not.

const PACKAGE_ROOT = path.join(import.meta.dirname, '..', '..', '..', 'packages', 'api-types');
const SRC = path.join(PACKAGE_ROOT, 'src');

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('C39 acceptance: api-types stays a data-only leaf', () => {
  // A glob, not a hardcoded path. package.json names src/index.ts as `main`,
  // but nothing stops a sibling being added and re-exported — and a gate
  // anchored to one file would never see it.
  it('imports nothing except from within the package', async () => {
    const files = await sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);

    const foreign: string[] = [];
    for (const file of files) {
      const code = stripComments(await readFile(file, 'utf8'));
      for (const match of code.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gm)) {
        // Relative specifiers are fine: the package may outgrow one file.
        // Anything else is a dependency edge, and this package has none.
        if (!match[1]!.startsWith('.')) foreign.push(`${path.basename(file)}: ${match[1]}`);
      }
      for (const match of code.matchAll(/\brequire\s*\(|\bimport\s*\(/g)) {
        foreign.push(`${path.basename(file)}: dynamic ${match[0].trim()}`);
      }
    }

    expect(foreign, `api-types must not import: ${foreign.join(', ')}`).toEqual([]);
  });

  it('declares no dependencies at all', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
  });

  // The property C8 actually protects: what crosses at RUNTIME. Types erase, so
  // they are irrelevant here — every runtime export must be a frozen array of
  // strings, or a guard over one.
  it('exports only frozen string arrays and predicates over them', () => {
    const runtimeExports = Object.entries(apiTypes);
    expect(runtimeExports.length).toBeGreaterThan(0);

    for (const [name, value] of runtimeExports) {
      if (typeof value === 'function') {
        // A guard, not an operation. Named as a predicate and taking one
        // argument — anything with I/O would not fit either.
        expect(name, `${name} must be named as a type guard`).toMatch(/^is[A-Z]/);
        expect(value.length, `${name} must take exactly one argument`).toBe(1);
        continue;
      }

      expect(Array.isArray(value), `${name} must be an array or a guard`).toBe(true);
      // Through `unknown`: the freeze narrows these to readonly tuples, which
      // do not overlap a mutable array type. The gate inspects them at runtime,
      // so the static shape is not what is being checked here.
      const array = value as unknown as readonly unknown[];
      expect(array.every((v) => typeof v === 'string'), `${name} must hold only strings`).toBe(true);
      // I39.3: `as const` is erased at runtime, so without the freeze the
      // domain can be widened in place — and isAccountLabelKind, which guards
      // the audit projection against out-of-domain kinds, would start
      // accepting whatever was pushed.
      expect(Object.isFrozen(array), `${name} must be frozen, not merely 'as const'`).toBe(true);
    }
  });
});
