import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { AppDeps } from './deps.js';
import { requireSession, UnauthorizedError } from './auth.js';
import { registerLoginRoute } from './routes/login.js';
import { registerLogoutRoute } from './routes/logout.js';
import { registerHrImportRoute } from './routes/hr-import.js';
import { registerSaasAppsRoute } from './routes/saas-apps.js';
import { registerSyncMatchRoutes } from './routes/sync-match.js';
import { registerAccountsRoute } from './routes/accounts.js';
import { registerAccountLabelsRoute } from './routes/account-labels.js';
import { registerAccountLabelsBulkRoute } from './routes/account-labels-bulk.js';
import { registerIdentitiesRoute } from './routes/identities.js';
import { registerEventsRoute } from './routes/events.js';
import { registerLicensesRoute } from './routes/licenses.js';

export type RegisteredRoute = { method: string; url: string; hasRateLimit: boolean };

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  // Route-table introspection for the programmatic sweeps required by C6's
  // acceptance criteria (401 sweep, Origin 403 sweep) — collected via onRoute
  // rather than a hardcoded list, so new routes stay covered automatically.
  const apiRoutes: RegisteredRoute[] = [];
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url.startsWith('/api/')) {
      const hasRateLimit =
        typeof routeOptions.config?.rateLimit === 'object' && routeOptions.config.rateLimit !== null;
      for (const method of [routeOptions.method].flat()) {
        apiRoutes.push({ method, url: routeOptions.url, hasRateLimit });
      }
    }
  });
  app.decorate('apiRoutes', apiRoutes);

  void app.register(cookie);
  void app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  // In-memory store: MVP runs a single api instance (docker-compose), so a
  // shared external rate-limit store is not required. Revisit if the api
  // service is ever scaled horizontally.
  void app.register(rateLimit, { global: false });

  // Health endpoint is a GET, so the Origin gate below (non-GET only) never
  // applies to it, and it is registered outside the /api scope entirely so
  // the session-auth gate never applies either. This is intentional: the
  // docker-compose smoke test polls this endpoint before any session exists.
  app.get('/healthz', async () => ({ status: 'ok' }));

  void app.register(
    async (api) => {
      // --- Gate 1: Origin (S9) ---
      // Every non-GET request under /api, ZERO exemptions (login included),
      // is rejected with 403 unless Origin matches APP_ORIGIN exactly.
      // Registered as a global onRequest hook at the /api scope root so new
      // routes are covered by default (fail-closed registration pattern).
      api.addHook('onRequest', async (req, reply) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          return;
        }
        const origin = req.headers.origin;
        if (origin !== deps.appOrigin) {
          return reply.code(403).send({ error: 'origin_mismatch' });
        }
      });

      // --- Login lives OUTSIDE the session-auth gate (its single exemption) ---
      registerLoginRoute(api, deps);

      // --- Gate 2: session-auth (S9) ---
      // Registered as a preHandler at this nested scope root, not per-route,
      // so every route added below requires a valid session by default.
      void api.register(async (authenticated) => {
        authenticated.addHook('preHandler', async (req) => {
          const sessionContext = await requireSession(deps.pool, req);
          req.sessionContext = sessionContext;
        });

        registerLogoutRoute(authenticated, deps);
        registerHrImportRoute(authenticated, deps);
        registerSaasAppsRoute(authenticated, deps);
        registerLicensesRoute(authenticated, deps);
        registerSyncMatchRoutes(authenticated, deps);
        registerAccountsRoute(authenticated, deps);
        registerAccountLabelsRoute(authenticated, deps);
        registerAccountLabelsBulkRoute(authenticated, deps);
        registerIdentitiesRoute(authenticated, deps);
        registerEventsRoute(authenticated, deps);
      });
    },
    { prefix: '/api' },
  );

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof UnauthorizedError) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Fastify's default serializer puts `message` in the body, so rethrowing
    // here shipped driver text to the client — a bad cursor answered with
    // `date/time field value out of range`, naming the column type and the
    // failing value.
    //
    // The body comes from a status-keyed table rather than from the error's own
    // `code`: reflecting `code` sent framework internals
    // (FST_ERR_CTP_INVALID_JSON_BODY) to callers and made them a de-facto part
    // of the contract, and it also mislabelled throttling — @fastify/rate-limit
    // carries no string code, so every 429 came back as `bad_request`, which
    // hides an abuse signal behind what reads as a client mistake.
    //
    // Routes that answer 4xx themselves never reach here; they `reply.send`
    // their own documented bodies.
    const details = error as { statusCode?: unknown };
    const declared = typeof details.statusCode === 'number' ? details.statusCode : 500;
    const status = reply.statusCode >= 400 ? reply.statusCode : declared;
    if (status < 500) {
      const CLIENT_ERRORS: Record<number, string> = {
        400: 'bad_request',
        403: 'forbidden',
        404: 'not_found',
        413: 'payload_too_large',
        415: 'unsupported_media_type',
        429: 'too_many_requests',
      };
      // A status with no entry falls back to a neutral label rather than to
      // 'bad_request': claiming the caller sent a bad request is a statement
      // about a status we have not classified, and mislabelling is what made
      // the 429 regression invisible.
      return reply.code(status).send({ error: CLIENT_ERRORS[status] ?? 'client_error' });
    }

    req.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  // An unmatched route never reaches the error handler, so Fastify's default
  // body survived it: `{"message":"Route GET:/nope not found","error":"Not
  // Found","statusCode":404}`, which echoes the requested route back. Nothing
  // sensitive, but the flat shape is what every other error path now sends.
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));

  return app;
}
