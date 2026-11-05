import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createCoreExpressApp, attachCentralErrorHandler } from './server/src/app';

async function startServer() {
  const app = createCoreExpressApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  attachCentralErrorHandler(app);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Logic Lab full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

