import { existsSync } from 'node:fs';
import { chromium, request, type FullConfig } from '@playwright/test';
import { DEMO_TENANT_SLUG, DEMO_EMAIL, DEMO_PASSWORD, STORAGE_STATE_PATH } from './fixtures/auth';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const READINESS_TIMEOUT_MS = 60_000;
const READINESS_POLL_INTERVAL_MS = 1_000;

class StackNotRunningError extends Error {
  constructor(target: string, cause: unknown) {
    super(
      `e2e: the compose stack does not look up at ${target}. ` +
        `Run "docker compose up -d --build" and wait for the seed job to ` +
        `finish before running the e2e suite. (${String(cause)})`,
    );
    this.name = 'StackNotRunningError';
  }
}

async function waitForOk(url: string): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`unexpected status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_POLL_INTERVAL_MS));
  }

  throw new StackNotRunningError(url, lastError);
}

async function performLogin(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseURL}/login`);
    await page.getByLabel('Tenant').fill(DEMO_TENANT_SLUG);
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${baseURL}/accounts`);

    await context.storageState({ path: STORAGE_STATE_PATH });
  } finally {
    await browser.close();
  }
}

// A still-valid saved session skips the login entirely: back-to-back suite
// runs (T-E2's twice-consecutive gate, CI retries) would otherwise stack
// login POSTs inside the 5/min/IP limit window and 429 the second run's
// setup. The 24 h sliding session TTL makes reuse safe.
async function hasValidSavedSession(): Promise<boolean> {
  if (!existsSync(STORAGE_STATE_PATH)) return false;
  // request.newContext THROWS synchronously on a corrupt state file (half-
  // written by a killed run, disk-full, manual edit) — any failure here means
  // "no usable session", never "abort the suite": fall back to a fresh login.
  try {
    const ctx = await request.newContext({ baseURL: API_URL, storageState: STORAGE_STATE_PATH });
    try {
      const res = await ctx.get('/api/accounts');
      return res.ok();
    } finally {
      await ctx.dispose();
    }
  } catch {
    return false;
  }
}

// Fails fast with a clear message when the stack is down (T-E1), then
// performs AT MOST one UI login for the whole suite, shared via storageState
// (round-1 FN-F1 — login-budget arithmetic documented in the plan).
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';

  await waitForOk(`${API_URL}/healthz`);
  await waitForOk(baseURL);

  if (await hasValidSavedSession()) return;
  await performLogin(baseURL);
}
