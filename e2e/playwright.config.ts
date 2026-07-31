import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE_PATH } from './fixtures/auth';

// Target = the compose stack (production-like), not a dev server — no
// webServer auto-boot here; stack lifecycle belongs to docker compose.
export default defineConfig({
  testDir: './specs',
  // A committed `test.only` runs that one spec and exits 0. Measured: one token
  // in auth.spec.ts made `pnpm -C e2e test` report `1 passed`, exit 0, with 42
  // specs — every session-expiry proof among them — silently not running, and
  // every gate green, because `only` emits no annotation for a reader to find.
  // This makes Playwright itself refuse it.
  forbidOnly: true,
  fullyParallel: false,
  // Shared stateful stack: parallel specs would race on tenant-global state
  // (match runs, account_labels). One worker sidesteps intra-suite races.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // The JSON reporter is what makes a RUN auditable from outside. `--list` never
  // executes `globalSetup`, so a `process.exit(0)` there — the natural next edit
  // against this file's own StackNotRunningError path — leaves the listing
  // byte-identical (43 specs, 0 annotations, both canaries) and the parity gate
  // 12/12 green while `pnpm -C e2e test` exits 0 having run nothing. Measured.
  // Under that edit this file is never written at all, which is the signal.
  reporter: [['html', { open: 'never' }], ['json', { outputFile: 'test-results/report.json' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    storageState: STORAGE_STATE_PATH,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
