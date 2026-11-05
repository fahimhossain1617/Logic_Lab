import express, { Express } from 'express';
import { apiRouter } from './routes/apiRoutes';
import {
  securityHeadersMiddleware,
  centralErrorHandler,
} from './middleware/rateLimitAndSecurity';

/**
 * Creates the core Express application with security headers, JSON body parsing,
 * and all `/api/*` routes mounted. Used by both `server.ts` (AI Studio / local dev)
 * and `api/index.ts` (Vercel Serverless Functions).
 */
export function createCoreExpressApp(): Express {
  const app = express();

  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '64kb' }));

  // Mount API routes at /api and root fallback (for Vercel serverless function rewrites)
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  return app;
}

export function attachCentralErrorHandler(app: Express): void {
  app.use(centralErrorHandler);
}
