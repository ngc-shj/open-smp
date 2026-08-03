import { z } from 'zod';
import { ACCOUNT_STATUSES } from '@open-smp/api-types';

export const rawAccountSchema = z.object({
  externalId: z.string().min(1),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  accountStatus: z.enum(ACCOUNT_STATUSES),
  isAdmin: z.boolean(),
  lastActivityAt: z.string().nullable(),
  raw: z.unknown(),
});
