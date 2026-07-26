import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Demo credentials, env-overridable with the seeded literals as defaults
// (apps/api/src/seed.ts is the canonical source — keep in sync). Only this
// file and global-setup.ts perform real logins; every other spec rides the
// storageState this module's path constant points at.
export const DEMO_TENANT_SLUG = 'demo';
export const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? 'admin@demo.example';
export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'demo-admin-password';

// Resolved from this module's location, NOT the process cwd: a cwd-relative
// path writes the LIVE session cookie to e2e/e2e/.auth/ when playwright runs
// with cwd=e2e/, which escapes the root .gitignore's anchored `e2e/.auth/`.
export const STORAGE_STATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.auth',
  'state.json',
);
