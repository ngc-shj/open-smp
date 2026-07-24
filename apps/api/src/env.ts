import { z } from 'zod';

const envSchema = z.object({
  // App-pool URL — MUST be the RLS-constrained opensmp_app role. A superuser
  // here silently bypasses every RLS policy (superusers ignore RLS), which is
  // why migrations get their own privileged URL below.
  DATABASE_URL: z.string().min(1),
  // Privileged URL used ONLY for runMigrations at boot (DDL, role creation).
  ADMIN_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Must be a full URL with scheme (CF6): the login route derives the session
  // cookie's Secure flag from `new URL(APP_ORIGIN).protocol`, which throws on a
  // scheme-less value — validate here so a misconfig fails fast at startup, not
  // per-request as a 500.
  APP_ORIGIN: z.string().url(),
  ENCRYPTION_KEYS: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  DISCOVERY_STORE_RAW: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  return envSchema.parse(source);
}
