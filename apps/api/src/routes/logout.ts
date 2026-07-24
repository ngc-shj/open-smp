import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { destroySession, getSessionCookieName } from '../auth.js';

export function registerLogoutRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    '/auth/logout',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
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
