import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { destroySession, getSessionCookieName } from '../auth.js';
import { MUTATION_RATE_LIMIT } from '../rate-limits.js';

export function registerLogoutRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/auth/logout',
    { config: { rateLimit: MUTATION_RATE_LIMIT } },
    async (req, reply) => {
      const cookieValue = req.cookies[getSessionCookieName()];
      if (cookieValue) {
        await destroySession(deps.pool, cookieValue);
      }
      reply.clearCookie(getSessionCookieName(), { path: '/' });
      return reply.code(204).send();
    },
  );
}
