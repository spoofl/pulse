import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, open, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from './app.js';
import { StorageError, StorageScanner } from './storage.js';
import type { MetricsResponse, StorageUsage } from '../shared/types.js';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pulse-storage-'));
  const scanner = new StorageScanner();
  return { root, scanner, clean: async () => { scanner.stop(); await rm(root, { recursive: true, force: true }); } };
}

async function completed(scanner: StorageScanner, root: string, folder = root) {
  let result = await scanner.getUsage(root, folder, [root], true);
  const deadline = Date.now() + 5000;
  while (result.status === 'scanning' && Date.now() < deadline) {
    await delay(20);
    result = await scanner.getUsage(root, folder, [root]);
  }
  assert.equal(result.status, 'ready', result.message || 'Scan did not finish');
  return result;
}

test('disk usage includes hidden and nested data, ranks items, and never follows symlinks', async () => {
  const { root, scanner, clean } = await fixture();
  try {
    await mkdir(path.join(root, 'large', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'large', 'nested', 'data'), Buffer.alloc(128 * 1024));
    await writeFile(path.join(root, '.hidden'), Buffer.alloc(8192));
    const unusual = 'tab\tline\nwith spaces é';
    await writeFile(path.join(root, unusual), Buffer.alloc(4096));
    await symlink(path.join(root, 'large'), path.join(root, 'shortcut'));
    const result = await completed(scanner, root);
    assert.equal(result.partial, false);
    assert.equal(result.entries[0].name, 'large');
    assert.equal(result.entries[0].kind, 'directory');
    assert.ok(result.entries[0].bytes >= 128 * 1024);
    assert.equal(result.entries.find(entry => entry.name === '.hidden')?.kind, 'file');
    assert.equal(result.entries.find(entry => entry.name === unusual)?.path, path.join(root, unusual));
    const shortcut = result.entries.find(entry => entry.name === 'shortcut')!;
    assert.equal(shortcut.kind, 'symlink');
    assert.ok(shortcut.bytes < result.entries[0].bytes);
    assert.equal(result.entries.reduce((sum, entry) => sum + entry.bytes, 0) + result.otherBytes, result.total);
    const child = await completed(scanner, root, path.join(root, 'large'));
    assert.equal(child.entries[0].name, 'nested');
  } finally { await clean(); }
});

test('allocated size handles sparse files and counts hard-linked data once', async () => {
  const { root, scanner, clean } = await fixture();
  try {
    const sparse = await open(path.join(root, 'sparse'), 'w');
    await sparse.truncate(64 * 1024 * 1024);
    await sparse.close();
    await writeFile(path.join(root, 'original'), Buffer.alloc(64 * 1024));
    await link(path.join(root, 'original'), path.join(root, 'hardlink'));
    const result = await completed(scanner, root);
    const sparseStat = await stat(path.join(root, 'sparse'));
    assert.equal(result.entries.find(entry => entry.name === 'sparse')?.bytes, sparseStat.blocks * 512);
    assert.ok(result.total! < 64 * 1024 * 1024, 'Logical sparse-file length must not inflate disk usage');
    const linkedBytes = result.entries.filter(entry => ['original', 'hardlink'].includes(entry.name)).reduce((sum, entry) => sum + entry.bytes, 0);
    assert.equal(linkedBytes, (await stat(path.join(root, 'original'))).blocks * 512);
  } finally { await clean(); }
});

test('results are cached until a rescan is explicitly requested', async () => {
  const { root, scanner, clean } = await fixture();
  try {
    const idle = await scanner.getUsage(root, root, [root]);
    assert.equal(idle.status, 'idle');
    assert.equal(idle.total, null);
    const first = await completed(scanner, root);
    await writeFile(path.join(root, 'new-file'), Buffer.alloc(1024 * 1024));
    const cached = await scanner.getUsage(root, root, [root]);
    assert.equal(cached.scannedAt, first.scannedAt);
    assert.equal(cached.total, first.total);
    const refreshed = await completed(scanner, root);
    assert.ok(refreshed.total! > first.total!);
  } finally { await clean(); }
});

test('large directories retain their biggest 200 items without losing the total', async () => {
  const { root, scanner, clean } = await fixture();
  try {
    for (let index = 0; index < 205; index++) await writeFile(path.join(root, `file-${index}`), Buffer.alloc(4096));
    await writeFile(path.join(root, 'largest'), Buffer.alloc(128 * 1024));
    const result = await completed(scanner, root);
    assert.equal(result.entryCount, 206);
    assert.equal(result.entries.length, 200);
    assert.equal(result.entries[0].name, 'largest');
    assert.ok(result.otherBytes >= 6 * 4096);
    assert.equal(result.entries.reduce((sum, entry) => sum + entry.bytes, 0) + result.otherBytes, result.total);
  } finally { await clean(); }
});

test('invalid paths, unknown volumes, files, and symlink escapes are rejected', async () => {
  const { root, scanner, clean } = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), 'pulse-outside-'));
  try {
    await symlink(outside, path.join(root, 'escape'));
    await writeFile(path.join(root, 'file'), 'data');
    for (const target of ['relative', `${root}/..`, `${root}-sibling`, `${root}/escape`, `${root}/file`, `${root}/bad\0path`]) {
      await assert.rejects(scanner.getUsage(root, target, [root], true), error => error instanceof StorageError && error.status === 400);
    }
    await assert.rejects(scanner.getUsage(root, root, [], true), error => error instanceof StorageError && error.status === 400);
    await assert.rejects(scanner.getUsage(root, `${root}/missing`, [root]), error => error instanceof StorageError && error.status === 404);
    // /proc must never be browsed through the persistent root filesystem.
    if (process.platform === 'linux') await assert.rejects(scanner.getUsage('/', '/proc', ['/'], true), /another filesystem/);
  } finally { await clean(); await rm(outside, { recursive: true, force: true }); }
});

test('unreadable folders produce partial results and cannot be opened', { skip: process.getuid?.() === 0 }, async () => {
  const { root, scanner, clean } = await fixture();
  const locked = path.join(root, 'locked');
  try {
    await mkdir(locked);
    await writeFile(path.join(locked, 'secret'), Buffer.alloc(8192));
    await writeFile(path.join(root, 'readable'), Buffer.alloc(4096));
    await chmod(locked, 0);
    const result = await completed(scanner, root);
    assert.equal(result.partial, true);
    assert.match(result.message!, /unreadable/);
    assert.equal(result.entries.find(entry => entry.name === 'readable')?.bytes, 4096);
    await assert.rejects(scanner.getUsage(root, locked, [root], true), error => error instanceof StorageError && error.status === 403);
  } finally { await chmod(locked, 0o700); await clean(); }
});

test('storage HTTP API validates input, uses asynchronous scans, and preserves origin protection', async () => {
  const { root, scanner, clean } = await fixture();
  const app = createApp({ getMetrics: () => ({ snapshot: { storage: { volumes: [{ mount: root }] } } }) as MetricsResponse }, { storageScanner: scanner });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/storage/usage`;
  const query = new URLSearchParams({ mount: root, path: root });
  try {
    assert.equal((await fetch(base)).status, 400);
    assert.equal((await fetch(`${base}?${query}&scan=0`)).status, 400);
    assert.equal((await fetch(`${base}?${query}`, { headers: { Origin: 'https://example.com' } })).status, 403);
    const idle = await fetch(`${base}?${query}`);
    assert.equal((await idle.json()).status, 'idle');
    assert.equal(idle.headers.get('cache-control'), 'no-store');
    const started = await fetch(`${base}?${query}&scan=1`);
    assert.equal(started.status, 202);
    assert.equal((await started.json()).status, 'scanning');
    let result: StorageUsage;
    const deadline = Date.now() + 5000;
    do { await delay(20); result = await (await fetch(`${base}?${query}`)).json(); } while (result.status === 'scanning' && Date.now() < deadline);
    assert.equal(result.status, 'ready');
    assert.equal(result.partial, false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await clean(); }
});
