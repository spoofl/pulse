import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import type { MetricsResponse } from '../shared/types.js';

let server: Server;
let base: string;
let payload: MetricsResponse | null = null;
let receivedSince = -1;

async function statusWithHeaders(url: string, headers: Record<string, string>) {
  return new Promise<number | undefined>((resolve, reject) => {
    get(url, { headers, setHost: false }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
}

before(async () => {
  const app = createApp({ getMetrics: (since = 0) => { receivedSince = since; return payload; } });
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

test('the API reports startup explicitly instead of returning fabricated samples', async () => {
  const response = await fetch(`${base}/api/metrics`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /first system sample/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('the metrics API passes the history cursor and returns uncached JSON', async () => {
  payload = { snapshot: { timestamp: 1234 }, history: [], historyStartedAt: 1000 } as unknown as MetricsResponse;
  const response = await fetch(`${base}/api/metrics?since=1200`);
  assert.equal(response.status, 200);
  assert.equal(receivedSince, 1200);
  assert.equal((await response.json()).snapshot.timestamp, 1234);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('invalid history timestamps are rejected', async () => {
  for (const value of ['-1', 'Infinity', 'hello']) {
    assert.equal((await fetch(`${base}/api/metrics?since=${value}`)).status, 400);
  }
});

test('remote origins and DNS-rebinding Host headers cannot read system metrics', async () => {
  assert.equal((await fetch(`${base}/api/metrics`, { headers: { Origin: 'https://example.com' } })).status, 403);
  // Node's Fetch implementation rewrites Host; use a raw HTTP request to exercise rebinding protection.
  const reboundStatus = await statusWithHeaders(`${base}/api/metrics`, { Host: 'attacker.example' });
  assert.equal(reboundStatus, 403);
  assert.equal(await statusWithHeaders(`${base}/api/metrics`, { Host: '' }), 403);
  assert.equal((await fetch(`${base}/api/metrics`, { headers: { Origin: base } })).status, 200);
});

test('normal mode does not accept LAN Host headers', async () => {
  assert.equal(await statusWithHeaders(`${base}/api/metrics`, { Host: '192.168.1.25:4310' }), 403);
});

test('LAN mode accepts configured machine addresses and still enforces Host and Origin checks', async () => {
  const app = createApp({ getMetrics: () => payload }, { allowedHosts: ['192.168.1.25', 'Pulse.local'] });
  const lanServer = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const url = `http://127.0.0.1:${(lanServer.address() as AddressInfo).port}/api/metrics`;
  try {
    assert.equal(await statusWithHeaders(url, { Host: '192.168.1.25:4310' }), 200);
    assert.equal(await statusWithHeaders(url, { Host: '192.168.1.25:4310', Origin: 'http://192.168.1.25:4310' }), 200);
    assert.equal(await statusWithHeaders(url, { Host: 'pulse.local:4310', Origin: 'http://pulse.local:4310' }), 200);
    assert.equal(await statusWithHeaders(url, { Host: '192.168.1.26:4310' }), 403);
    assert.equal(await statusWithHeaders(url, { Host: 'attacker.example' }), 403);
    assert.equal(await statusWithHeaders(url, { Host: '192.168.1.25:4310', Origin: 'https://example.com' }), 403);
    assert.equal(await statusWithHeaders(url, { Host: '192.168.1.25:4310', Origin: 'http://192.168.1.25:9999' }), 403);
    assert.equal((await fetch(url)).status, 200);
  } finally {
    await new Promise<void>(resolve => lanServer.close(() => resolve()));
  }
});

test('unknown API endpoints return a JSON 404', async () => {
  const response = await fetch(`${base}/api/does-not-exist`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'API endpoint not found.');
});
