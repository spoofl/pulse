export function bytes(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export const rate = (value: number | null | undefined) => value == null ? '—' : `${bytes(value)}/s`;
export const pct = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`;
export const temp = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(0)}°C`;
export const clockTime = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
export function uptime(value: number) {
  const days = Math.floor(value / 86400);
  const hours = Math.floor(value % 86400 / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function downloadJson(value: unknown, hostname: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `pulse-${hostname.replace(/[^a-z0-9_-]/gi, '-')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
