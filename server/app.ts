import express from 'express';
import path from 'node:path';
import type { Collector } from './collector.js';
import { StorageError, StorageScanner } from './storage.js';

interface AppOptions {
  staticDirectory?: string;
  allowedHosts?: string[];
  storageScanner?: StorageScanner;
}

export function createApp(collector: Pick<Collector, 'getMetrics'>, { staticDirectory = path.resolve('dist'), allowedHosts = [], storageScanner = new StorageScanner() }: AppOptions = {}) {
  const app = express();
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...allowedHosts].map(host => host.toLowerCase()));
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // LAN mode adds only this machine's addresses; arbitrary Host headers remain blocked.
    if (!hosts.has((req.hostname || '').toLowerCase())) return void res.status(403).json({ error: 'Host not allowed.' });
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
  app.get('/api/storage/usage', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { mount, path: directory, scan } = req.query;
    if (typeof mount !== 'string' || typeof directory !== 'string' || (scan !== undefined && scan !== '1')) {
      return void res.status(400).json({ error: 'mount and path are required; scan must be 1 when provided.' });
    }
    const data = collector.getMetrics();
    if (!data) return void res.status(503).json({ error: 'Waiting for mounted volume information.' });
    try {
      const usage = await storageScanner.getUsage(mount, directory, data.snapshot.storage.volumes.map(volume => volume.mount), scan === '1');
      res.status(usage.status === 'scanning' ? 202 : 200).json(usage);
    } catch (error) {
      res.status(error instanceof StorageError ? error.status : 500).json({ error: error instanceof StorageError ? error.message : 'Storage scanning is temporarily unavailable.' });
    }
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'API endpoint not found.' }); });
  app.use(express.static(staticDirectory));
  app.get('/{*path}', (_req, res, next) => { res.sendFile(path.join(staticDirectory, 'index.html'), error => { if (error) next(error); }); });
  return app;
}
