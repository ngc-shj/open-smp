import { z } from 'zod';

export const rawAccountSchema = z.object({
  externalId: z.string().min(1),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  accountStatus: z.enum(['active', 'suspended', 'archived']),
  isAdmin: z.boolean(),
  lastActivityAt: z.string().nullable(),
  raw: z.unknown(),
});
