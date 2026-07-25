import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE_PATH } from './fixtures/auth';

// Target = the compose stack (production-like), not a dev server — no
// webServer auto-boot here; stack lifecycle belongs to docker compose.
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  // Shared stateful stack: parallel specs would race on tenant-global state
  // (match runs, account_labels). One worker sidesteps intra-suite races.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }]],
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
