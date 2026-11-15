import { readFile, readdir } from 'node:fs/promises';
import { totalmem } from 'node:os';
import type { ProcessInfo, Snapshot } from '../shared/types.js';

interface ProcessCounter { pid: number; name: string; state: string; ticks: number; started: number }
const states: Record<string, string> = { R: 'running', S: 'sleeping', I: 'sleeping', D: 'blocked', Z: 'zombie', T: 'stopped', t: 'stopped', X: 'dead', P: 'parked' };

// /proc/PID/stat fields 14/15 are CPU ticks and field 22 is the start time.
// The command is parenthesized and can itself contain spaces or parentheses.
export function parseProcessStat(raw: string): ProcessCounter | null {
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open < 1 || close < open) return null;
  const fields = raw.slice(close + 1).trim().split(/\s+/);
  const pid = Number(raw.slice(0, open).trim());
  const ticks = Number(fields[11]) + Number(fields[12]);
  const started = Number(fields[19]);
  if (!Number.isFinite(pid) || !Number.isFinite(ticks) || !Number.isFinite(started)) return null;
  return { pid, name: raw.slice(open + 1, close), state: states[fields[0]] || 'unknown', ticks, started };
}

export function processCpu(current: ProcessCounter, previous: ProcessCounter | undefined, elapsedTicks: number): number | null {
  if (!previous || current.started !== previous.started || elapsedTicks <= 0 || current.ticks < previous.ticks) return null;
  return Math.min(100, Math.max(0, (current.ticks - previous.ticks) / elapsedTicks * 100));
}

export class LinuxProcesses {
  private previous = new Map<number, ProcessCounter>();
  private previousTotal = 0;
  private users: Map<string, string> | null = null;

  async read(): Promise<NonNullable<Snapshot['processes']>> {
    if (!this.users) {
      const passwd = await readFile('/etc/passwd', 'utf8').catch(() => '');
      this.users = new Map(passwd.split('\n').filter(Boolean).map(line => { const parts = line.split(':'); return [parts[2], parts[0]]; }));
    }
    const [names, systemStat] = await Promise.all([readdir('/proc'), readFile('/proc/stat', 'utf8')]);
    // Exclude guest counters, which are already included in user/nice time.
    const total = systemStat.split('\n')[0].trim().split(/\s+/).slice(1, 9).reduce((sum, value) => sum + Number(value), 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error('CPU counters are unavailable.');
    const pids = names.filter(name => /^\d+$/.test(name));
    const next = new Map<number, ProcessCounter>();
    const list: ProcessInfo[] = [];
    const memory = totalmem();
    let cursor = 0;
    // Bound filesystem concurrency; no shell commands or process argument inspection.
    await Promise.all(Array.from({ length: Math.min(16, pids.length) }, async () => {
      while (cursor < pids.length) {
        const pid = pids[cursor++];
        try {
          const [raw, status] = await Promise.all([readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/status`, 'utf8')]);
          const counter = parseProcessStat(raw);
          if (!counter) continue;
          const uid = /^Uid:\s+(\d+)/m.exec(status)?.[1] || '';
          const memoryBytes = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] || 0) * 1024;
          next.set(counter.pid, counter);
          list.push({ pid: counter.pid, name: counter.name, state: counter.state, cpu: processCpu(counter, this.previous.get(counter.pid), total - this.previousTotal), memory: memoryBytes / memory * 100, memoryBytes, user: this.users?.get(uid) || uid });
        } catch {
          // Processes can exit during a sample; protected processes may not be readable.
        }
      }
    }));
    if (pids.length && !list.length) throw new Error('Process entries could not be read.');
    this.previous = next;
    this.previousTotal = total;
    return { all: list.length, running: list.filter(item => item.state === 'running').length, sleeping: list.filter(item => item.state === 'sleeping').length, blocked: list.filter(item => item.state === 'blocked').length, list: list.sort((a, b) => (b.cpu ?? -1) - (a.cpu ?? -1)) };
  }
}
