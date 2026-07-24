import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { verifyLogin, getSessionCookieName } from '../auth.js';

const loginBodySchema = z
  .object({
    tenantSlug: z.string().min(1),
    email: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();

// S12: the login account bucket is keyed on a hash of the RAW submitted
// `tenantSlug + ':' + email` string, never on resolved tenant/user ids, so
// bucket accrual is identical whether or not the slug or email exists.
function accountBucketKey(req: FastifyRequest): string {
  const body = req.body as { tenantSlug?: unknown; email?: unknown } | undefined;
  const tenantSlug = typeof body?.tenantSlug === 'string' ? body.tenantSlug : '';
  const email = typeof body?.email === 'string' ? body.email : '';
  return createHash('sha256').update(`${tenantSlug}:${email}`).digest('hex');
}

export function registerLoginRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          // Two independent limits (RS2): 5/min/IP (default IP keying) AND
          // 20/hour per raw-input account bucket (S12). @fastify/rate-limit
          // applies one config per route, so the account-bucket limit is
          // additionally enforced via the manual preHandler below.
          max: 5,
          timeWindow: '1 minute',
        },
      },
      preHandler: app.rateLimit({
        max: 20,
        timeWindow: '1 hour',
        keyGenerator: accountBucketKey,
      }),
    },
    async (req, reply) => {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const { tenantSlug, email, password } = parsed.data;

      const session = await verifyLogin(deps.pool, deps.hasher, tenantSlug, email, password);
      if (!session) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      reply.setCookie(getSessionCookieName(), session.id, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        expires: new Date(session.expiresAt),
      });

      return reply.code(200).send({ ok: true });
    },
  );
}
