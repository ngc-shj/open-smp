import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createPool } from '@open-smp/schema';
import { parseEncryptionKeys } from '@open-smp/crypto';
import {
  SYNC_QUEUE,
  MATCH_QUEUE,
  TOKEN_AUDIT_QUEUE,
  type SyncJobData,
  type MatchJobData,
  type TokenAuditJobData,
} from '@open-smp/queues';
import { parseEnv } from './env.js';
import { createConnectorRegistry } from './connectors.js';
import { runSync } from './sync.js';
import { runMatch } from './match.js';
import { runTokenAudit } from './token-audit.js';

const env = parseEnv(process.env);

const pool = createPool(env.DATABASE_URL);
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const encryptionKeys = parseEncryptionKeys(env.ENCRYPTION_KEYS);
const connectorRegistry = createConnectorRegistry();

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.info(msg, meta ?? {}),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(msg, meta ?? {}),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(msg, meta ?? {}),
};

// attempts: 1 keeps BullMQ's built-in retry surface at zero — retries would
// re-run a job whose tenantId already came from the API-only enqueue path,
// but the C5 forbidden-pattern list bars any dispatch from inside the
// worker itself, and a silent automatic retry is a form of that.
const syncWorker = new Worker<SyncJobData>(
  SYNC_QUEUE,
  async (job: Job<SyncJobData>) =>
    runSync(
      { pool, connectorRegistry, encryptionKeys, logger, discoveryStoreRaw: env.DISCOVERY_STORE_RAW },
      job.data,
    ),
  { connection, concurrency: 1 },
);

const matchWorker = new Worker<MatchJobData>(
  MATCH_QUEUE,
  async (job: Job<MatchJobData>) => runMatch({ pool }, job.data),
  { connection, concurrency: 1 },
);

const tokenAuditWorker = new Worker<TokenAuditJobData>(
  TOKEN_AUDIT_QUEUE,
  async (job: Job<TokenAuditJobData>) =>
    runTokenAudit({ pool, connectorRegistry, encryptionKeys, logger }, job.data),
  { connection, concurrency: 1 },
);

syncWorker.on('failed', (job, error) => {
  logger.error('sync job failed', { jobId: job?.id, error: String(error) });
});
matchWorker.on('failed', (job, error) => {
  logger.error('match job failed', { jobId: job?.id, error: String(error) });
});
tokenAuditWorker.on('failed', (job, error) => {
  logger.error('token audit job failed', { jobId: job?.id, error: String(error) });
});

async function shutdown(): Promise<void> {
  logger.info('worker shutting down');
  await Promise.all([syncWorker.close(), matchWorker.close(), tokenAuditWorker.close()]);
  await connection.quit();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});

logger.info('worker started', { queues: [SYNC_QUEUE, MATCH_QUEUE, TOKEN_AUDIT_QUEUE] });
