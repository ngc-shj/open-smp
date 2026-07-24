import argon2 from 'argon2';
import { Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { createPool, runMigrations } from '@open-smp/schema';
import { parseEncryptionKeys } from '@open-smp/crypto';
import { SYNC_QUEUE, MATCH_QUEUE, type SyncJobData, type MatchJobData } from '@open-smp/queues';
import { parseEnv } from './env.js';
import { buildApp } from './app.js';
import { ARGON2ID_OPTIONS, type Hasher } from './auth.js';
import type { AppDeps } from './deps.js';

const env = parseEnv(process.env);

const hasher: Hasher = {
  hash: (password) => argon2.hash(password, { type: argon2.argon2id, ...ARGON2ID_OPTIONS }),
  verify: (hash, password) => argon2.verify(hash, password),
};

async function main(): Promise<void> {
  await runMigrations(env.DATABASE_URL);

  const pool = createPool(env.DATABASE_URL);
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const encryptionKeys = parseEncryptionKeys(env.ENCRYPTION_KEYS);

  const syncQueue = new Queue<SyncJobData>(SYNC_QUEUE, { connection });
  const matchQueue = new Queue<MatchJobData>(MATCH_QUEUE, { connection });

  const deps: AppDeps = {
    pool,
    encryptionKeys,
    appOrigin: env.APP_ORIGIN,
    hasher,
    syncQueue,
    matchQueue,
    getJob: async (jobId) => {
      const job: Job | undefined =
        (await syncQueue.getJob(jobId)) ?? (await matchQueue.getJob(jobId));
      if (!job) {
        return null;
      }
      const state = await job.getState();
      return { state, result: job.returnvalue ?? null };
    },
  };

  const app = buildApp(deps);

  await app.listen({ host: '0.0.0.0', port: env.PORT });
}

main().catch((error: unknown) => {
  console.error('api failed to start', error);
  process.exit(1);
});
