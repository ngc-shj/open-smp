import type { SessionContext } from './auth.js';
import type { RegisteredRoute } from './app.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessionContext: SessionContext;
  }
  interface FastifyInstance {
    apiRoutes: RegisteredRoute[];
  }
}
