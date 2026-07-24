import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { verifyLogin, getSessionCookieName } from '../auth.js';
import { LOGIN_IP_RATE_LIMIT } from '../rate-limits.js';
import { createAccountBucketLimiter } from '../account-bucket.js';

const loginBodySchema = z
  .object({
    tenantSlug: z.string().min(1),
    email: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();

export function registerLoginRoute(app: FastifyInstance, deps: AppDeps): void {
  // Two independent limits (RS2): 5/min/IP via @fastify/rate-limit, AND
  // 20/hour per raw-input account bucket (S12) via a standalone limiter.
  // They CANNOT both be @fastify/rate-limit instances on the same route:
  // the plugin's per-request `rateLimitRan` guard lets only the first fire,
  // silently disabling the second — so the account bucket is its own limiter.
  const accountBucketPreHandler = createAccountBucketLimiter();

  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: LOGIN_IP_RATE_LIMIT,
      },
      preHandler: accountBucketPreHandler,
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
        // Secure is derived from APP_ORIGIN's scheme (CF1/CS5-A): a browser
        // drops a Secure cookie received over plain HTTP, which would break
        // the http://localhost docker-compose demo. Production sets an https
        // APP_ORIGIN and gets Secure=true; the demo gets Secure=false. The
        // Origin gate (D7) is the CSRF control, not this flag.
        secure: new URL(deps.appOrigin).protocol === 'https:',
        sameSite: 'lax',
        path: '/',
        expires: new Date(session.expiresAt),
      });

      return reply.code(200).send({ ok: true });
    },
  );
}
