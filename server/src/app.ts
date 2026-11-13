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

  // Full CORS support for local dev (Vite on port 5173, custom origins, etc.)
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-uid, Cache-Control');
    res.setHeader('Access-Control-Expose-Headers', '*');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '512kb' }));

  // Mount API routes at /api and root fallback (for Vercel serverless function rewrites)
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  return app;
}

export function attachCentralErrorHandler(app: Express): void {
  app.use(centralErrorHandler);
}
