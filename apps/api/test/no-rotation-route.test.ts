import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// C9/S13 acceptance: the credential-rotation sweep is a CLI in apps/worker,
// invoked from an operator shell (`pnpm rotate-credentials`) with
// ROTATE_CONFIRM=yes — it must never be reachable as an HTTP endpoint.
// This is a static, container-free check over apps/api/src/routes source: it
// fails if any route file references rotate/runRotationSweep/rotate-credentials,
// i.e. if someone wires the sweep into an HTTP route.

const ROTATION_PATTERN = /rotate|runrotationsweep|rotate-credentials/i;

describe('C9/S13 acceptance: no apps/api route references the rotation sweep', () => {
  it('no file under apps/api/src/routes/ mentions rotate/runRotationSweep/rotate-credentials', async () => {
    const routesDir = path.join(import.meta.dirname, '..', 'src', 'routes');
    const files = (await readdir(routesDir)).filter((file) => file.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(path.join(routesDir, file), 'utf8');
      expect(source, `${file} must not reference the rotation sweep`).not.toMatch(ROTATION_PATTERN);
    }
  });
});
