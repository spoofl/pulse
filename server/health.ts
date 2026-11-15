import type { HealthCheck, HealthStatus, Snapshot, Volume } from '../shared/types.js';

export const percent = (value: number, total: number) => total > 0 ? Math.min(100, Math.max(0, value / total * 100)) : 0;
export const measurement = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const temperature = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

// A device can be mounted more than once (notably btrfs subvolumes).
export function uniqueVolumes(volumes: Volume[]): Volume[] {
  const found = new Map<string, Volume>();
  for (const volume of volumes) {
    if (volume.size <= 0 || /^(tmpfs|devtmpfs|squashfs|overlay|proc|sysfs|ramfs|devfs|autofs|efivarfs|cgroup2?)$/.test(volume.type)) continue;
    const key = volume.fs.replace(/\[.*\]$/, '');
    const existing = found.get(key);
    if (!existing || volume.mount === '/' || (existing.mount !== '/' && volume.mount.length < existing.mount.length)) found.set(key, volume);
  }
  return [...found.values()].sort((a, b) => a.mount === '/' ? -1 : b.mount === '/' ? 1 : b.size - a.size);
}

export function overallStatus(checks: HealthCheck[]): HealthStatus {
  if (checks.some(check => check.status === 'critical')) return 'critical';
  if (checks.some(check => check.status === 'warning')) return 'warning';
  if (checks.some(check => check.status === 'ok')) return 'ok';
  return 'unknown';
}

export function evaluateHealth(data: Omit<Snapshot, 'health'>): Snapshot['health'] {
  const checks: HealthCheck[] = [];
  const threshold = (id: string, name: string, value: number | null, warn: number, critical: number, suffix: string, good: string, bad: string) => {
    const status = value === null ? 'unknown' : value >= critical ? 'critical' : value >= warn ? 'warning' : 'ok';
    checks.push({ id, name, status, value: value === null ? 'Unavailable' : `${value.toFixed(1)}${suffix}`, detail: value === null ? 'This reading is not available from the operating system.' : `${status === 'ok' ? good : bad} Warning at ${warn}${suffix}; critical at ${critical}${suffix}.` });
  };
  threshold('cpu', 'Processor load', data.cpu.load, 90, 98, '%', 'CPU has available capacity.', 'High CPU usage in the latest sample.');
  threshold('memory', 'Memory pressure', data.memory?.percent ?? null, 85, 95, '%', 'Memory has available capacity.', 'Available memory is running low.');
  threshold('temperature', 'CPU temperature', data.cpu.maxTemperature ?? data.cpu.temperature, 80, 95, '°C', 'Highest reported CPU temperature is within the configured range.', 'CPU temperature is elevated. Check ventilation and active workloads.');
  if (!data.storage.volumes.length) checks.push({ id: 'storage', name: 'Storage capacity', status: 'unknown', value: 'Unavailable', detail: 'No supported mounted volumes were reported.' });
  for (const volume of data.storage.volumes) threshold(`storage:${volume.mount}`, `Storage · ${volume.mount}`, volume.use, 85, 95, '%', 'This volume has available space.', 'This volume is running low on space.');
  const knownDrives = data.storage.drives.filter(drive => /^(ok|passed|verified|healthy|failing|failed|bad)$/i.test(drive.smart));
  const failedDrives = knownDrives.filter(drive => /^(failing|failed|bad)$/i.test(drive.smart));
  checks.push({
    id: 'smart', name: 'Drive health (S.M.A.R.T.)',
    status: failedDrives.length ? 'critical' : knownDrives.length && knownDrives.length === data.storage.drives.length ? 'ok' : 'unknown',
    value: failedDrives.length ? 'Failure reported' : knownDrives.length && knownDrives.length === data.storage.drives.length ? 'Passed' : 'Unavailable',
    detail: failedDrives.length ? 'A drive reported a S.M.A.R.T. failure. Back up its data and inspect the drive.' : knownDrives.length && knownDrives.length === data.storage.drives.length ? 'All detected physical drives report a passing S.M.A.R.T. status.' : 'S.M.A.R.T. is not readable for every drive. Hardware support, smartmontools, and device permissions may be required. Capacity alone does not establish drive health.',
  });
  if (data.battery && !data.battery.acConnected) {
    checks.push({ id: 'battery', name: 'Battery charge', status: data.battery.percent <= 10 ? 'critical' : data.battery.percent <= 20 ? 'warning' : 'ok', value: `${data.battery.percent}%`, detail: 'Running on battery power. Low-charge warning at 20%; critical at 10%.' });
  }
  if (data.unavailable.length) checks.push({ id: 'collection', name: 'Metric collection', status: 'unknown', value: 'Partial', detail: `Some readings could not be collected: ${data.unavailable.join(', ')}. Other readings remain available.` });
  return { status: overallStatus(checks), checks };
}
