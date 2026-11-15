import os from 'node:os';
import si from 'systeminformation';
import type { Drive, HistoryPoint, MetricsResponse, Snapshot, Volume } from '../shared/types.js';
import { evaluateHealth, measurement, percent, temperature, uniqueVolumes } from './health.js';
import { LinuxProcesses } from './linux-processes.js';

const HOUR = 60 * 60 * 1000;
const TIMEOUT = 4500;

export class Collector {
  private snapshot: Snapshot | null = null;
  private history: HistoryPoint[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private pending = new Map<string, Promise<unknown>>();
  private host!: Snapshot['host'];
  private drives: Drive[] = [];
  private lastDriveCheck = 0;
  private driveReadFailed = false;
  private linuxProcesses = new LinuxProcesses();
  readonly startedAt = Date.now();

  constructor(readonly interval = 2000) {}

  private async read<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    let operation = this.pending.get(name) as Promise<T> | undefined;
    if (!operation) {
      operation = Promise.resolve().then(fn);
      this.pending.set(name, operation);
      void operation.then(() => this.pending.delete(name), () => this.pending.delete(name));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT); })]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async start() {
    const [cpu, info, system] = await Promise.all([
      this.read('cpuInfo', () => si.cpu()), this.read('osInfo', () => si.osInfo()), this.read('system', () => si.system()),
    ]);
    this.host = {
      hostname: os.hostname(), os: info ? `${info.distro} ${info.release}`.trim() : `${os.type()} ${os.release()}`,
      platform: os.platform(), kernel: os.release(), arch: os.arch(),
      cpu: cpu ? `${cpu.manufacturer} ${cpu.brand}`.trim() : os.cpus()[0]?.model || 'Unknown processor',
      cores: cpu?.cores || os.cpus().length, physicalCores: cpu?.physicalCores || 0,
      model: [system?.manufacturer, system?.model].filter(Boolean).join(' ') || 'Local machine',
    };
    await this.sample();
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }

  getMetrics(since = 0): MetricsResponse | null {
    if (!this.snapshot) return null;
    return {
      snapshot: this.snapshot,
      history: this.history.filter(point => point.timestamp > since),
      historyStartedAt: this.startedAt,
    };
  }

  private async sample() {
    if (this.stopped) return;
    const started = Date.now();
    try {
      const refreshDrives = started - this.lastDriveCheck >= 60_000;
      const [load, memory, temp, speed, filesystems, fsStats, network, interfaces, processes, battery, drives] = await Promise.all([
        this.read('cpu', () => si.currentLoad()), this.read('memory', () => si.mem()),
        this.read('temperature', () => si.cpuTemperature()), this.read('speed', () => si.cpuCurrentSpeed()),
        this.read('storage', () => si.fsSize()), this.read('disk I/O', () => si.fsStats()),
        this.read('network', () => si.networkStats('*')), this.read('interfaces', () => si.networkInterfaces()),
        this.read('processes', () => this.readProcesses()), this.read('battery', () => si.battery()),
        refreshDrives ? this.read('drives', () => si.diskLayout()) : Promise.resolve(null),
      ]);
      if (refreshDrives) {
        this.lastDriveCheck = started;
        this.driveReadFailed = drives === null;
        this.drives = (drives || []).map(drive => ({
          device: drive.device, name: drive.name || drive.vendor || drive.device, type: drive.type,
          size: drive.size, interface: drive.interfaceType, smart: drive.smartStatus || 'unknown', temperature: temperature(drive.temperature),
        }));
      }
      const unavailable = [
        ['CPU', load], ['memory', memory], ['temperature', temp], ['CPU speed', speed], ['storage', filesystems],
        ['disk I/O', fsStats], ['network', network], ['interfaces', interfaces], ['processes', processes], ['battery', battery],
      ].filter(([, value]) => value === null).map(([name]) => String(name));
      if (this.driveReadFailed) unavailable.push('physical drives');
      const stats = new Map((network || []).map(item => [item.iface, item]));
      const networkInterfaces = (Array.isArray(interfaces) ? interfaces : []).filter(item => !item.internal).map(item => {
        const stat = stats.get(item.iface);
        return {
          name: item.iface, address: item.ip4 || item.ip6 || '', state: item.operstate, type: item.type,
          speed: measurement(item.speed), default: item.default, virtual: item.virtual,
          rx: this.history.length ? measurement(stat?.rx_sec) : null, tx: this.history.length ? measurement(stat?.tx_sec) : null,
          received: measurement(stat?.rx_bytes), sent: measurement(stat?.tx_bytes),
          errors: stat ? stat.rx_errors + stat.tx_errors : null,
        };
      });
      // Count the default interface, avoiding double-counting VPN/bridge traffic.
      const primary = networkInterfaces.find(item => item.default) || networkInterfaces.find(item => !item.virtual && item.state === 'up');
      const volumes: Volume[] = (filesystems || []).map(volume => ({
        fs: volume.fs, type: volume.type, mount: volume.mount, size: volume.size,
        used: volume.used, available: volume.available, use: percent(volume.used, volume.size),
      }));
      const timestamp = Date.now();
      const measured = {
        timestamp, interval: this.interval, host: this.host, uptime: os.uptime(),
        cpu: {
          load: measurement(load?.currentLoad), user: measurement(load?.currentLoadUser), system: measurement(load?.currentLoadSystem),
          cores: (load?.cpus || []).map(core => core.load), speed: speed?.avg && speed.avg > 0 ? speed.avg : null,
          temperature: temperature(temp?.main), maxTemperature: temperature(temp?.max), loadAverage: os.loadavg(),
        },
        memory: memory ? {
          total: memory.total, used: Math.max(0, memory.total - memory.available), available: memory.available,
          cached: memory.buffcache, free: memory.free, percent: percent(memory.total - memory.available, memory.total),
          swapTotal: memory.swaptotal, swapUsed: memory.swapused,
        } : null,
        storage: { volumes: uniqueVolumes(volumes), drives: this.drives, read: this.history.length ? measurement(fsStats?.rx_sec) : null, write: this.history.length ? measurement(fsStats?.wx_sec) : null },
        network: { interfaces: networkInterfaces, rx: primary?.rx ?? null, tx: primary?.tx ?? null },
        processes,
        battery: battery?.hasBattery ? {
          percent: battery.percent, charging: battery.isCharging, acConnected: battery.acConnected,
          remaining: battery.timeRemaining > 0 ? battery.timeRemaining : null,
          health: battery.maxCapacity > 0 && battery.designedCapacity > 0 ? percent(battery.maxCapacity, battery.designedCapacity) : null,
        } : null,
        unavailable,
      } satisfies Omit<Snapshot, 'health'>;
      this.snapshot = { ...measured, health: evaluateHealth(measured) };
      this.history.push({ timestamp, cpu: measured.cpu.load, memory: measured.memory?.percent ?? null, temperature: measured.cpu.temperature, rx: measured.network.rx, tx: measured.network.tx, read: measured.storage.read, write: measured.storage.write });
      this.history = this.history.filter(point => point.timestamp >= timestamp - HOUR);
    } catch (error) {
      console.error('Could not collect a metrics sample:', error instanceof Error ? error.message : 'unknown error');
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => void this.sample(), Math.max(100, this.interval - (Date.now() - started)));
    }
  }

  private async readProcesses(): Promise<NonNullable<Snapshot['processes']>> {
    if (os.platform() === 'linux') return this.linuxProcesses.read();
    const processes = await si.processes();
    return {
      all: processes.all, running: processes.running, sleeping: processes.sleeping, blocked: processes.blocked,
      list: processes.list.map(item => ({ pid: item.pid, name: item.name, cpu: measurement(item.cpu), memory: measurement(item.mem) || 0, memoryBytes: Math.max(0, item.memRss * 1024), state: item.state, user: item.user })).sort((a, b) => (b.cpu ?? -1) - (a.cpu ?? -1)),
    };
  }
}
