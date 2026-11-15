export type HealthStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export interface HealthCheck {
  id: string;
  name: string;
  status: HealthStatus;
  detail: string;
  value: string;
}

export interface Volume {
  fs: string;
  type: string;
  mount: string;
  size: number;
  used: number;
  available: number;
  use: number;
}

export interface Drive {
  device: string;
  name: string;
  type: string;
  size: number;
  interface: string;
  smart: string;
  temperature: number | null;
}

export interface NetworkInterface {
  name: string;
  address: string;
  state: string;
  type: string;
  speed: number | null;
  default: boolean;
  virtual: boolean;
  rx: number | null;
  tx: number | null;
  received: number | null;
  sent: number | null;
  errors: number | null;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number | null;
  memory: number;
  memoryBytes: number;
  state: string;
  user: string;
}

export interface Snapshot {
  timestamp: number;
  interval: number;
  uptime: number;
  host: { hostname: string; os: string; platform: string; kernel: string; arch: string; cpu: string; cores: number; physicalCores: number; model: string };
  cpu: { load: number | null; user: number | null; system: number | null; cores: number[]; speed: number | null; temperature: number | null; maxTemperature: number | null; loadAverage: number[] };
  memory: { total: number; used: number; available: number; cached: number; free: number; percent: number | null; swapTotal: number; swapUsed: number } | null;
  storage: { volumes: Volume[]; drives: Drive[]; read: number | null; write: number | null };
  network: { rx: number | null; tx: number | null; interfaces: NetworkInterface[] };
  processes: { all: number; running: number; sleeping: number; blocked: number; list: ProcessInfo[] } | null;
  battery: { percent: number; charging: boolean; acConnected: boolean; remaining: number | null; health: number | null } | null;
  health: { status: HealthStatus; checks: HealthCheck[] };
  unavailable: string[];
}

export interface HistoryPoint {
  timestamp: number;
  cpu: number | null;
  memory: number | null;
  temperature: number | null;
  rx: number | null;
  tx: number | null;
  read: number | null;
  write: number | null;
}

export interface MetricsResponse {
  snapshot: Snapshot;
  history: HistoryPoint[];
  historyStartedAt: number;
}
