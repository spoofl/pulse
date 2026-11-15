import test from 'node:test';
import assert from 'node:assert/strict';
import type { Snapshot, Volume } from '../shared/types.js';
import { evaluateHealth, measurement, percent, temperature, uniqueVolumes } from './health.js';

export function sample(): Omit<Snapshot, 'health'> {
  return {
    timestamp: Date.now(), interval: 2000, uptime: 3600,
    host: { hostname: 'test-machine', os: 'Test OS', platform: 'linux', kernel: 'test', arch: 'x64', cpu: 'Test CPU', cores: 4, physicalCores: 2, model: 'Test machine' },
    cpu: { load: 10, user: 8, system: 2, cores: [10, 10, 10, 10], speed: 2, temperature: 50, maxTemperature: 55, loadAverage: [0.1, 0.2, 0.3] },
    memory: { total: 1000, used: 300, available: 700, cached: 500, free: 200, percent: 30, swapTotal: 100, swapUsed: 0 },
    storage: { volumes: [{ fs: '/dev/test', type: 'ext4', mount: '/', size: 1000, used: 300, available: 700, use: 30 }], drives: [{ device: '/dev/test', name: 'Disk', type: 'SSD', size: 1000, interface: 'SATA', smart: 'unknown', temperature: null }], read: 0, write: 0 },
    network: { rx: 0, tx: 0, interfaces: [] }, processes: null, battery: null, unavailable: [],
  };
}

test('unavailable measurements remain distinct from a real zero reading', () => {
  assert.equal(measurement(0), 0);
  for (const value of [-1, NaN, Infinity, null, undefined, '30']) assert.equal(measurement(value), null);
  assert.equal(temperature(0), null);
  assert.equal(temperature(-1), null);
  assert.equal(temperature(55), 55);
  assert.equal(percent(300, 1000), 30);
  assert.equal(percent(10, 0), 0);
});

test('storage excludes ephemeral filesystems and counts repeated btrfs mounts once', () => {
  const volume: Volume = { fs: '/dev/nvme0n1p2', mount: '/', type: 'btrfs', size: 1000, used: 300, available: 700, use: 30 };
  const volumes = uniqueVolumes([
    { ...volume, fs: '/dev/nvme0n1p2[/home]', mount: '/home' },
    { ...volume, fs: 'tmpfs', type: 'tmpfs', mount: '/run' },
    { ...volume, fs: '/dev/loop0', type: 'squashfs', mount: '/snap/app' },
    { ...volume, fs: 'efivarfs', type: 'efivarfs', mount: '/sys/firmware/efi/efivars' },
    volume,
    { ...volume, fs: '/dev/sda1', mount: '/data', type: 'ext4' },
  ]);
  assert.equal(volumes.length, 2);
  assert.equal(volumes[0].mount, '/');
  assert.equal(volumes.reduce((sum, item) => sum + item.size, 0), 2000);
});

test('unknown S.M.A.R.T. status never becomes a passing hardware check', () => {
  const data = sample();
  const health = evaluateHealth(data);
  assert.equal(health.status, 'ok');
  assert.equal(health.checks.find(item => item.id === 'smart')?.status, 'unknown');
  data.storage.drives[0].smart = 'Ok';
  assert.equal(evaluateHealth(data).checks.find(item => item.id === 'smart')?.status, 'ok');
  data.storage.drives.push({ ...data.storage.drives[0], device: '/dev/other', smart: 'unknown' });
  assert.equal(evaluateHealth(data).checks.find(item => item.id === 'smart')?.status, 'unknown');
  data.storage.drives[0].smart = 'failed';
  assert.equal(evaluateHealth(data).status, 'critical');
});

test('thresholds include exact boundaries and a critical reading outranks warnings', () => {
  const data = sample();
  data.memory!.percent = 85;
  assert.equal(evaluateHealth(data).status, 'warning');
  data.storage.volumes[0].use = 95;
  assert.equal(evaluateHealth(data).status, 'critical');
  data.storage.volumes[0].use = 30;
  data.cpu.maxTemperature = 95;
  assert.equal(evaluateHealth(data).checks.find(item => item.id === 'temperature')?.status, 'critical');
});

test('an entirely unavailable system is unknown, not healthy', () => {
  const data = sample();
  data.cpu.load = null;
  data.cpu.temperature = null;
  data.cpu.maxTemperature = null;
  data.memory = null;
  data.storage.volumes = [];
  data.storage.drives = [];
  data.unavailable = ['CPU', 'memory'];
  const health = evaluateHealth(data);
  assert.equal(health.status, 'unknown');
  assert.ok(health.checks.every(item => item.status === 'unknown'));
});

test('a low battery triggers a warning only while running without AC power', () => {
  const data = sample();
  data.battery = { percent: 10, charging: false, acConnected: false, remaining: 15, health: 95 };
  assert.equal(evaluateHealth(data).status, 'critical');
  data.battery.acConnected = true;
  assert.equal(evaluateHealth(data).status, 'ok');
});
