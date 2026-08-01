import { z } from 'zod';

export const rawTokenSchema = z.object({
  // The aggregation key. FR1 counts users per APPLICATION, and the client id is
  // the only stable identifier a grant carries — `displayText` is chosen by the
  // third party and two applications may share one.
  clientId: z.string().min(1),
  displayName: z.string().nullable(),
  scopes: z.array(z.string()),
  // Three states, not two. Google returns these as optional, and absence means
  // "not stated" rather than `false`: forging `anonymous: false` would report an
  // application Google does not recognise as one it does — the direction that
  // hides exactly the discovery this feature exists for.
  anonymous: z.boolean().nullable(),
  nativeApp: z.boolean().nullable(),
  userKey: z.string().min(1),
});
