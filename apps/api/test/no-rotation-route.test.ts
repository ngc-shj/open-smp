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

// I22.5: DELETE /api/saas-apps/:id counts referencing accounts inside the same
// transaction, so the foreign-key error should be unreachable — the catch is a
// backstop for the case where that guard has a hole. A real 23503 needs the
// TOCTOU race the count closes, which is not deterministically reproducible at
// the integration tier, so the discharge is a source assertion: without it, an
// implementer who deletes the catch entirely passes every other criterion.
//
// The constraint name is load-bearing and was wrong once in the plan. Postgres
// names a foreign key after the REFERENCING table, so the constraint on
// saas_accounts.saas_app_id is saas_accounts_saas_app_id_fkey — a catch written
// against the other spelling can never fire.
describe('C22/I22.5 acceptance: the app-delete foreign-key backstop is present and narrowly scoped', () => {
  it('saas-apps.ts maps 23503 on saas_accounts_saas_app_id_fkey and rethrows anything else', async () => {
    const source = await readFile(
      path.join(import.meta.dirname, '..', 'src', 'routes', 'saas-apps.ts'),
      'utf8',
    );

    expect(source).toMatch(/'23503'/);
    expect(source).toMatch(/saas_accounts_saas_app_id_fkey/);
    // Narrow scope: a bare `catch { return 409 }` would swallow unrelated
    // failures and report them as "app has accounts".
    expect(source).toMatch(/throw err/);
  });
});
