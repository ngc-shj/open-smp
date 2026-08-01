import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import type { SyncJobData, MatchJobData, TokenAuditJobData } from '@open-smp/queues';
import type { Hasher } from './auth.js';

export interface AppDeps {
  pool: Pool;
  encryptionKeys: Map<number, Buffer>;
  appOrigin: string;
  hasher: Hasher;
  syncQueue: Queue<SyncJobData>;
  matchQueue: Queue<MatchJobData>;
  tokenAuditQueue: Queue<TokenAuditJobData>;
  // BullMQ getJob is queue-agnostic by jobId; a single connection lets
  // /api/jobs/:jobId look up either queue without guessing which one.
  getJob: (jobId: string) => Promise<{ state: string; result: unknown } | null>;
}
