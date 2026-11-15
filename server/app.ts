import express from 'express';
import path from 'node:path';
import type { Collector } from './collector.js';

export function createApp(collector: Pick<Collector, 'getMetrics'>, staticDirectory = path.resolve('dist')) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // Loopback binding plus Host/Origin validation prevents remote webpages and DNS rebinding from reading stats.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return void res.status(403).json({ error: 'Local access only.' });
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) return void res.status(403).json({ error: 'Same-origin access only.' }); }
      catch { return void res.status(403).json({ error: 'Invalid origin.' }); }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.get('/api/metrics', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const since = req.query.since === undefined ? 0 : Number(req.query.since);
    if (!Number.isFinite(since) || since < 0) return void res.status(400).json({ error: 'since must be a non-negative timestamp.' });
    const data = collector.getMetrics(since);
    if (!data) return void res.status(503).json({ error: 'Collecting the first system sample. Please wait a moment.' });
    res.json(data);
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'API endpoint not found.' }); });
  app.use(express.static(staticDirectory));
  app.get('/{*path}', (_req, res, next) => { res.sendFile(path.join(staticDirectory, 'index.html'), error => { if (error) next(error); }); });
  return app;
}
