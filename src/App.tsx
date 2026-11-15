import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowDownUp, ArrowUp, Battery, Check, ChevronRight, Clock3, Cpu, Download, HardDrive, HeartPulse, Layers3, LayoutDashboard, LockKeyhole, Menu, MemoryStick, Monitor, Moon, Network, Pause, Play, RefreshCw, Search, Server, ShieldCheck, Sun, X } from 'lucide-react';
import type { HealthStatus, HistoryPoint, MetricsResponse, Snapshot } from '../shared/types';
import { Badge, Chart, Empty, Icon, Meter, MetricCard, Panel, RangeSelect, StatusIcon, ViewLink } from './components';
import { bytes, clockTime, downloadJson, pct, rate, temp, uptime } from './lib/format';
import { useMetrics } from './lib/useMetrics';

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'performance', label: 'Performance', icon: Activity },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'processes', label: 'Processes', icon: Layers3 },
  { id: 'health', label: 'System health', icon: HeartPulse },
] as const;
type Page = typeof navigation[number]['id'];
const titles: Record<Page, [string, string]> = {
  overview: ['System overview', 'A live look at your machine’s performance and health.'],
  performance: ['Performance', 'See where your resources are going, moment by moment.'],
  storage: ['Storage', 'Keep an eye on your drives, capacity, and disk activity.'],
  network: ['Network', 'Follow the traffic moving in and out of your machine.'],
  processes: ['Processes', 'Find out what’s running and what it’s using.'],
  health: ['System health', 'Practical checks for a well-running machine.'],
};
const statusLabels: Record<HealthStatus, string> = { ok: 'Normal', warning: 'Attention', critical: 'Critical', unknown: 'Unavailable' };

function currentPage(): Page {
  const hash = window.location.hash.slice(1);
  return navigation.some(item => item.id === hash) ? hash as Page : 'overview';
}

function initialTheme() {
  try { return localStorage.getItem('pulse-theme') === 'dark'; } catch { return false; }
}

function splitValue(value: string) {
  const [number, ...unit] = value.split(' ');
  return { value: number, unit: unit.join(' ') };
}

function metricsCards(snapshot: Snapshot, history: HistoryPoint[]) {
  const total = snapshot.storage.volumes.reduce((sum, volume) => sum + volume.size, 0);
  const used = snapshot.storage.volumes.reduce((sum, volume) => sum + volume.used, 0);
  return <div className="metrics-grid">
    <MetricCard icon={Cpu} title="CPU usage" value={snapshot.cpu.load?.toFixed(1) ?? '—'} unit={snapshot.cpu.load === null ? '' : '%'} note={`${snapshot.host.cores} logical cores · ${temp(snapshot.cpu.temperature)}`} history={history} series="cpu" to="performance" />
    <MetricCard icon={MemoryStick} title="Memory" value={snapshot.memory?.percent?.toFixed(1) ?? '—'} unit={snapshot.memory ? '%' : ''} note={snapshot.memory ? `${bytes(snapshot.memory.used)} of ${bytes(snapshot.memory.total)} in use` : 'Memory reading unavailable'} history={history} series="memory" color="purple" to="performance" />
    <MetricCard icon={HardDrive} title="Storage used" value={total ? (used / total * 100).toFixed(1) : '—'} unit={total ? '%' : ''} note={total ? `${bytes(used)} of ${bytes(total)} across ${snapshot.storage.volumes.length} volumes` : 'No mounted volumes available'} color="blue" to="storage" />
    <MetricCard icon={ArrowDownUp} title="Network" {...splitValue(rate(snapshot.network.rx))} note={`↑ ${rate(snapshot.network.tx)} upload · primary interface`} history={history} series="rx" color="amber" to="network" />
  </div>;
}

function HealthSummary({ snapshot }: { snapshot: Snapshot }) {
  const checks = snapshot.health.checks;
  const issues = checks.filter(check => check.status === 'warning' || check.status === 'critical');
  const unknown = checks.filter(check => check.status === 'unknown');
  return <Panel title="System health" action={<ViewLink to="health" children="Details" />} className="health-summary">
    <div className={`health-hero health-${snapshot.health.status}`}><span className="health-emblem"><Icon icon={ShieldCheck} size={30} /></span><div><h3>{snapshot.health.status === 'ok' ? 'Looking good' : snapshot.health.status === 'unknown' ? 'Checks unavailable' : 'Needs a little attention'}</h3><p>{issues.length ? `${issues.length} ${issues.length === 1 ? 'check needs' : 'checks need'} your attention` : snapshot.health.status === 'unknown' ? 'Waiting for supported readings' : 'Measured resources are within range'}</p></div></div>
    <div className="compact-checks">{checks.filter(check => check.id !== 'collection').slice(0, 5).map(check => <div className="compact-check" key={check.id}><StatusIcon status={check.status} /><span>{check.name}</span><strong className={`text-${check.status}`}>{check.value}</strong></div>)}</div>
    {unknown.length > 0 && <div className="health-footnote">{unknown.length} {unknown.length === 1 ? 'check is' : 'checks are'} unavailable. <a href="#health">See coverage <span aria-hidden="true">↗</span></a></div>}
  </Panel>;
}

function StorageVolumes({ snapshot, compact = false }: { snapshot: Snapshot; compact?: boolean }) {
  const volumes = compact ? snapshot.storage.volumes.slice(0, 3) : snapshot.storage.volumes;
  if (!volumes.length) return <Empty>No supported volumes were reported by this machine.</Empty>;
  return <div className={compact ? 'volume-list compact' : 'volume-list'}>{volumes.map(volume => <div className="volume-row" key={`${volume.fs}-${volume.mount}`}>
    <div className="volume-icon"><Icon icon={HardDrive} size={21} /></div>
    <div className="volume-content"><div className="volume-title"><div><h3>{volume.mount === '/' ? 'System volume' : volume.mount === '/home' ? 'Home volume' : volume.mount}<span className="mount-label">{volume.mount === '/' || volume.mount === '/home' ? volume.mount : volume.type}</span></h3><p>{volume.fs} <span>· {volume.type.toUpperCase()}</span></p></div><strong>{pct(volume.use)}</strong></div>
      <Meter value={volume.use} color={volume.use >= 95 ? 'red' : volume.use >= 85 ? 'amber' : 'green'} label={`${volume.mount} storage used`} />
      <div className="volume-caption"><span>{bytes(volume.used)} <span className="muted">of {bytes(volume.size)} used</span></span><span>{bytes(volume.available)} free</span></div>
    </div>
  </div>)}</div>;
}

function ProcessTable({ snapshot, compact = false }: { snapshot: Snapshot; compact?: boolean }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'cpu' | 'memoryBytes' | 'name' | 'pid'>('cpu');
  const [ascending, setAscending] = useState(false);
  const [limit, setLimit] = useState(25);
  const sorted = useMemo(() => {
    const list = (snapshot.processes?.list || []).filter(item => `${item.name} ${item.pid} ${item.user}`.toLowerCase().includes(query.toLowerCase()));
    return list.sort((a, b) => (typeof a[sort] === 'string' ? String(a[sort]).localeCompare(String(b[sort])) : Number(a[sort]) - Number(b[sort])) * (ascending ? 1 : -1));
  }, [snapshot.processes, query, sort, ascending]);
  const rows = sorted.slice(0, compact ? 5 : limit);
  function changeSort(value: typeof sort) {
    if (sort === value) setAscending(!ascending); else { setSort(value); setAscending(value === 'name'); }
  }
  const heading = (label: string, key: typeof sort) => <th aria-sort={sort === key ? ascending ? 'ascending' : 'descending' : 'none'}><button onClick={() => changeSort(key)}>{label}{sort === key && <Icon icon={ascending ? ArrowUp : ArrowDown} size={12} />}</button></th>;
  return <>
    {!compact && <div className="table-toolbar"><label className="search-field"><Icon icon={Search} size={17} /><input value={query} onChange={event => { setQuery(event.target.value); setLimit(25); }} placeholder="Search by name, PID, or user…" aria-label="Search processes" />{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="Clear search"><Icon icon={X} size={15} /></button>}</label><span className="muted">{sorted.length} processes</span></div>}
    {snapshot.processes ? <div className="table-scroll"><table className={`process-table ${compact ? 'compact-table' : ''}`}><thead><tr>{heading('Process', 'name')}{heading('PID', 'pid')}{heading('CPU', 'cpu')}{heading('Memory', 'memoryBytes')}{!compact && <><th>Status</th><th>User</th></>}</tr></thead><tbody>{rows.map(process => <tr key={process.pid}><td><div className="process-name"><span className="process-avatar"><Icon icon={process.name.toLowerCase().includes('chrome') ? Monitor : Layers3} size={14} /></span><span title={process.name}>{process.name || 'Unknown process'}</span></div></td><td className="mono muted">{process.pid}</td><td><span className={(process.cpu ?? 0) > 50 ? 'text-warning' : ''}>{pct(process.cpu)}</span></td><td>{bytes(process.memoryBytes)}</td>{!compact && <><td><span className={`process-state ${process.state === 'running' ? 'running' : ''}`}><span />{process.state || 'unknown'}</span></td><td className="muted">{process.user || '—'}</td></>}</tr>)}</tbody></table>{!rows.length && <Empty>No processes match “{query}”. Try a different name or PID.</Empty>}</div> : <Empty>Process information is unavailable.</Empty>}
    {!compact && <div className="table-bottom"><span>Showing {rows.length} of {sorted.length} · Click a column to sort</span>{sorted.length > limit && <button className="button secondary small" onClick={() => setLimit(limit + 50)}>Show more <Icon icon={ArrowDown} size={14} /></button>}</div>}
  </>;
}

function Overview({ data, minutes, setMinutes }: { data: MetricsResponse; minutes: number; setMinutes: (value: number) => void }) {
  const { snapshot: s, history } = data;
  return <>
    {metricsCards(s, history)}
    <div className="overview-middle">
      <Panel title="Resource activity" subtitle="CPU and memory utilization over time" action={<RangeSelect minutes={minutes} onChange={setMinutes} />} className="activity-panel">
        <div className="chart-legend"><span><i className="legend-dot green" />CPU <strong>{pct(s.cpu.load)}</strong></span><span><i className="legend-dot purple" />Memory <strong>{pct(s.memory?.percent)}</strong></span><span className="live-label">Latest sample</span></div>
        <Chart history={history} series={['cpu', 'memory']} minutes={minutes} />
        <div className="chart-footnote"><Icon icon={Clock3} size={12} />History since {clockTime(data.historyStartedAt)}<span>Up to 1 hour retained in memory</span></div>
      </Panel>
      <HealthSummary snapshot={s} />
    </div>
    <div className="overview-bottom">
      <Panel title="Storage overview" subtitle="A little room to keep things moving" action={<ViewLink to="storage" />}><StorageVolumes snapshot={s} compact /></Panel>
      <Panel title="Top processes" subtitle="The busiest processes right now" action={<ViewLink to="processes" children="View all" />} className="process-panel"><ProcessTable snapshot={s} compact /></Panel>
    </div>
    <div className="system-strip"><span><Icon icon={Monitor} size={16} /><span>{s.host.os}</span></span><span><Icon icon={Cpu} size={16} /><span>{s.host.physicalCores || s.host.cores} {s.host.physicalCores ? 'physical' : 'logical'} cores</span></span><span><Icon icon={Clock3} size={16} /><span>Uptime <strong>{uptime(s.uptime)}</strong></span></span><span><Icon icon={Server} size={16} /><span>{s.host.arch}</span></span></div>
  </>;
}

function Performance({ data, minutes, setMinutes }: { data: MetricsResponse; minutes: number; setMinutes: (value: number) => void }) {
  const { snapshot: s, history } = data;
  const [metric, setMetric] = useState<'cpu' | 'memory' | 'temperature' | 'read'>('cpu');
  return <>
    {metricsCards(s, history)}
    <Panel title="Performance over time" subtitle="Real samples, collected while Pulse is running" action={<RangeSelect minutes={minutes} onChange={setMinutes} />}>
      <div className="chart-tabs" role="group" aria-label="Performance metric">{([['cpu', 'CPU'], ['memory', 'Memory'], ['temperature', 'Temperature'], ['read', 'Disk I/O']] as const).map(([key, label]) => <button key={key} onClick={() => setMetric(key)} aria-pressed={metric === key} className={metric === key ? 'active' : ''}>{label}</button>)}</div>
      {metric === 'read' && <div className="chart-legend"><span><i className="legend-dot green" />Read</span><span><i className="legend-dot blue" />Write</span></div>}
      <Chart history={history} series={metric === 'read' ? ['read', 'write'] : [metric]} minutes={minutes} />
    </Panel>
    <div className="two-column">
      <Panel title="Processor" subtitle={s.host.cpu} action={<span className="subtle-icon"><Icon icon={Cpu} size={20} /></span>}>
        <div className="stat-row"><div><span>Clock speed</span><strong>{s.cpu.speed ? `${s.cpu.speed.toFixed(2)} GHz` : '—'}</strong></div><div><span>Temperature</span><strong>{temp(s.cpu.temperature)}</strong></div><div><span>1 min load</span><strong>{s.cpu.loadAverage[0].toFixed(2)}</strong></div></div>
        <div className="section-label">LOGICAL CORE USAGE <span>{s.cpu.cores.length} cores</span></div>
        <div className="cores-grid">{s.cpu.cores.map((value, index) => <div className="core" key={index}><div><span>Core {index + 1}</span><strong>{value.toFixed(0)}%</strong></div><Meter value={value} label={`Core ${index + 1} usage`} color={value > 90 ? 'amber' : 'green'} /></div>)}</div>
        {!s.cpu.cores.length && <Empty>Per-core usage is unavailable.</Empty>}
        <div className="panel-note">Load averages (1 / 5 / 15 min): <span className="mono">{s.cpu.loadAverage.map(value => value.toFixed(2)).join(' / ')}</span></div>
      </Panel>
      <Panel title="Memory allocation" subtitle="Physical memory and swap" action={<span className="subtle-icon purple"><Icon icon={MemoryStick} size={20} /></span>}>
        {s.memory ? <><div className="memory-total"><strong>{bytes(s.memory.used)}<span> / {bytes(s.memory.total)}</span></strong><Badge status={s.memory.percent! >= 85 ? 'warning' : 'ok'}>{pct(s.memory.percent)} used</Badge></div><Meter value={s.memory.percent || 0} color="purple" label="Physical memory usage" />
          <dl className="detail-list"><div><dt>Available to applications</dt><dd>{bytes(s.memory.available)}</dd></div><div><dt>Buffers & cache</dt><dd>{bytes(s.memory.cached)}</dd></div><div><dt>Completely free</dt><dd>{bytes(s.memory.free)}</dd></div></dl>
          <div className="section-label">SWAP MEMORY<span>{s.memory.swapTotal ? pct(s.memory.swapUsed / s.memory.swapTotal * 100) : 'Not configured'}</span></div><Meter value={s.memory.swapTotal ? s.memory.swapUsed / s.memory.swapTotal * 100 : 0} color="blue" label="Swap usage" /><div className="volume-caption"><span>{bytes(s.memory.swapUsed)} used</span><span>{bytes(s.memory.swapTotal)} total</span></div>
          <p className="panel-note">Usage is total minus available memory. Reclaimable cache is available for applications; a cache is not a memory leak.</p></> : <Empty>Memory readings are unavailable.</Empty>}
      </Panel>
    </div>
  </>;
}

function Storage({ data, minutes, setMinutes }: { data: MetricsResponse; minutes: number; setMinutes: (value: number) => void }) {
  const s = data.snapshot;
  const total = s.storage.volumes.reduce((sum, volume) => sum + volume.size, 0);
  const available = s.storage.volumes.reduce((sum, volume) => sum + volume.available, 0);
  return <>
    <div className="metrics-grid"><MetricCard icon={HardDrive} title="Total capacity" {...splitValue(bytes(total || null))} note={`${s.storage.volumes.length} unique mounted volumes`} color="blue" to="storage" /><MetricCard icon={Layers3} title="Available space" {...splitValue(bytes(total ? available : null))} note="Ready for applications and files" to="storage" /><MetricCard icon={ArrowDown} title="Disk read" {...splitValue(rate(s.storage.read))} note="Across mounted drives" history={data.history} series="read" to="storage" /><MetricCard icon={ArrowUp} title="Disk write" {...splitValue(rate(s.storage.write))} note="Across mounted drives" history={data.history} series="write" color="blue" to="storage" /></div>
    <div className="two-column storage-columns"><Panel title="Mounted volumes" subtitle="Persistent filesystems · duplicate mounts excluded"><StorageVolumes snapshot={s} /></Panel><Panel title="Disk activity" subtitle="Read and write throughput" action={<RangeSelect minutes={minutes} onChange={setMinutes} />}><div className="chart-legend"><span><i className="legend-dot green" />Read <strong>{rate(s.storage.read)}</strong></span><span><i className="legend-dot blue" />Write <strong>{rate(s.storage.write)}</strong></span></div><Chart history={data.history} series={['read', 'write']} minutes={minutes} /></Panel></div>
    <Panel title="Physical drives" subtitle="Hardware inventory and reported drive health · refreshed every minute">
      <div className="drive-grid">{s.storage.drives.map(drive => <div className="drive-card" key={drive.device}><span className="drive-icon"><Icon icon={HardDrive} size={26} /></span><div><h3>{drive.name}</h3><p className="muted mono">{drive.device}</p><div className="drive-tags"><span>{drive.type || 'Drive'}</span><span>{bytes(drive.size)}</span><span>{drive.interface || 'Unknown interface'}</span></div><div className="drive-health"><span>S.M.A.R.T.</span><Badge status={/^(ok|passed|verified|healthy)$/i.test(drive.smart) ? 'ok' : /^(failing|failed|bad)$/i.test(drive.smart) ? 'critical' : 'unknown'}>{/^(unknown|)$/i.test(drive.smart) ? 'Unavailable' : drive.smart}</Badge>{drive.temperature !== null && <span>{temp(drive.temperature)}</span>}</div></div></div>)}</div>
      {!s.storage.drives.length && <Empty>Physical drive details are not available from this system.</Empty>}
      <p className="panel-note">S.M.A.R.T. depends on drive support, smartmontools, and device permissions. An unavailable status does not mean a drive has passed a health check.</p>
    </Panel>
  </>;
}

function NetworkPage({ data, minutes, setMinutes }: { data: MetricsResponse; minutes: number; setMinutes: (value: number) => void }) {
  const s = data.snapshot;
  const primary = s.network.interfaces.find(item => item.default) || s.network.interfaces.find(item => !item.virtual && item.state === 'up');
  return <>
    <div className="metrics-grid"><MetricCard icon={ArrowDown} title="Download" {...splitValue(rate(s.network.rx))} note={primary?.name || 'No primary interface'} history={data.history} series="rx" to="network" /><MetricCard icon={ArrowUp} title="Upload" {...splitValue(rate(s.network.tx))} note={primary?.name || 'No primary interface'} history={data.history} series="tx" color="purple" to="network" /><MetricCard icon={Download} title="Total received" {...splitValue(bytes(primary?.received))} note="Primary interface · counter since reset" color="blue" to="network" /><MetricCard icon={ArrowUp} title="Total sent" {...splitValue(bytes(primary?.sent))} note="Primary interface · counter since reset" color="amber" to="network" /></div>
    <Panel title="Network traffic" subtitle="Primary interface throughput · avoids counting bridged traffic twice" action={<RangeSelect minutes={minutes} onChange={setMinutes} />}><div className="chart-legend"><span><i className="legend-dot green" />Download <strong>{rate(s.network.rx)}</strong></span><span><i className="legend-dot purple" />Upload <strong>{rate(s.network.tx)}</strong></span></div><Chart history={data.history} series={['rx', 'tx']} minutes={minutes} /></Panel>
    <Panel title="Network interfaces" subtitle="Connection state, addresses, and individual interface traffic"><div className="table-scroll"><table className="network-table"><thead><tr><th>Interface</th><th>Address</th><th>Link</th><th>Download</th><th>Upload</th><th>Errors</th><th>Status</th></tr></thead><tbody>{s.network.interfaces.map(item => <tr key={item.name}><td><div className="interface-name"><Icon icon={Network} size={18} /><div><strong>{item.name}</strong><small>{item.default ? 'Primary' : item.virtual ? 'Virtual' : item.type || 'Interface'}</small></div></div></td><td className="mono">{item.address || 'Not assigned'}</td><td>{item.speed ? `${item.speed} Mbps` : '—'}</td><td>{rate(item.rx)}</td><td>{rate(item.tx)}</td><td>{item.errors ?? '—'}</td><td><Badge status={item.state === 'up' ? 'ok' : 'neutral'}>{item.state || 'Unknown'}</Badge></td></tr>)}</tbody></table></div>{!s.network.interfaces.length && <Empty>No network interfaces are available.</Empty>}<div className="panel-note">Link state describes the local adapter and does not verify internet access. Loopback interfaces are excluded.</div></Panel>
  </>;
}

function Processes({ snapshot: s }: { snapshot: Snapshot }) {
  return <><div className="process-stats">{[['Total processes', s.processes?.all, Layers3], ['Running', s.processes?.running, Activity], ['Sleeping', s.processes?.sleeping, Moon], ['Blocked', s.processes?.blocked, Pause]].map(([label, value, icon]) => <div className="process-stat" key={String(label)}><span className="subtle-icon"><Icon icon={icon as typeof Activity} size={21} /></span><div><span>{String(label)}</span><strong>{value == null ? '—' : String(value)}</strong></div></div>)}</div><Panel title="Running on your machine" subtitle="Live process usage · CPU is a share of total capacity on Linux; new processes need two samples" className="all-processes"><ProcessTable snapshot={s} /></Panel></>;
}

function Health({ snapshot: s }: { snapshot: Snapshot }) {
  const counts = { ok: 0, warning: 0, critical: 0, unknown: 0 };
  s.health.checks.forEach(check => counts[check.status]++);
  return <>
    <div className={`health-banner health-${s.health.status}`}><div className="health-emblem"><Icon icon={ShieldCheck} size={32} /></div><div><h2>{s.health.status === 'ok' ? 'Your measured resources look healthy.' : s.health.status === 'unknown' ? 'Health readings are not available yet.' : 'Some readings need your attention.'}</h2><p>{counts.ok} normal · {counts.warning + counts.critical} need attention · {counts.unknown} unavailable. Checks use the latest readings and fixed thresholds.</p></div><Badge status={s.health.status}>{s.health.status === 'ok' ? 'No issues detected' : statusLabels[s.health.status]}</Badge></div>
    <div className="two-column health-columns"><Panel title="Health checks" subtitle="A transparent view of what we can measure"><div className="health-check-list">{s.health.checks.map(check => <div className="health-check-detail" key={check.id}><StatusIcon status={check.status} /><div><h3>{check.name}</h3><p>{check.detail}</p></div><Badge status={check.status}>{check.value}</Badge></div>)}</div></Panel>
      <div className="stack"><Panel title="About this machine" action={<Icon icon={Monitor} size={20} />}><dl className="detail-list system-details">{[['Hostname', s.host.hostname], ['Operating system', s.host.os], ['Kernel', s.host.kernel], ['Architecture', s.host.arch], ['Hardware', s.host.model], ['Processor', s.host.cpu], ['Logical / physical cores', `${s.host.cores} / ${s.host.physicalCores || '—'}`], ['Uptime', uptime(s.uptime)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></Panel>
        {s.battery && <Panel title="Battery" action={<Icon icon={Battery} size={22} />}><div className="memory-total"><strong>{s.battery.percent}<span>%</span></strong><Badge status={s.battery.percent < 20 && !s.battery.acConnected ? 'warning' : 'ok'}>{s.battery.charging ? 'Charging' : s.battery.acConnected ? 'Plugged in' : 'On battery'}</Badge></div><Meter value={s.battery.percent} label="Battery charge" /><dl className="detail-list"><div><dt>Battery health</dt><dd>{s.battery.health === null ? 'Unavailable' : pct(s.battery.health)}</dd></div><div><dt>Estimated time remaining</dt><dd>{s.battery.remaining ? uptime(s.battery.remaining * 60) : 'Unavailable'}</dd></div></dl></Panel>}
        <div className="local-note"><Icon icon={LockKeyhole} size={20} /><div><h3>Your machine. Your data.</h3><p>Readings stay on this machine. Pulse reads system statistics and keeps up to one hour of history in memory.</p></div></div>
      </div></div>
  </>;
}

export default function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [paused, setPaused] = useState(false);
  const [dark, setDark] = useState(initialTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [minutes, setMinutes] = useState(5);
  const [exported, setExported] = useState(false);
  const { data, error, refresh, refreshing } = useMetrics(paused);
  const s = data?.snapshot;
  useEffect(() => { const update = () => { setPage(currentPage()); setMenuOpen(false); window.scrollTo({ top: 0 }); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; try { localStorage.setItem('pulse-theme', dark ? 'dark' : 'light'); } catch { /* Settings still work when browser storage is disabled. */ } }, [dark]);
  useEffect(() => { document.title = `${titles[page][0]} — Pulse`; }, [page]);
  useEffect(() => { if (!exported) return; const timer = setTimeout(() => setExported(false), 2500); return () => clearTimeout(timer); }, [exported]);
  useEffect(() => { if (!menuOpen) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [menuOpen]);
  const live = Boolean(s && !error && !paused);
  const exportSnapshot = () => { if (data) { downloadJson({ ...data, exportedAt: new Date().toISOString() }, data.snapshot.host.hostname); setExported(true); } };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {menuOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <a className="brand" href="#overview" aria-label="Pulse overview"><span className="brand-mark"><Activity size={24} strokeWidth={2.2} /></span><span>pulse<span className="brand-period">.</span></span><span className="brand-edition">LOCAL</span></a>
      <div className="machine-switch"><span className="machine-icon"><Icon icon={Monitor} size={19} /></span><div><strong>{s?.host.hostname || 'This machine'}</strong><span><i className={`connection-dot ${live ? '' : 'inactive'}`} />{error ? 'Reconnecting' : paused ? 'View paused' : s ? 'Connected locally' : 'Connecting'}</span></div><span className="machine-key">01</span></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(item => <a href={`#${item.id}`} onClick={() => setMenuOpen(false)} key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined}><Icon icon={item.icon} size={19} /><span>{item.label}</span>{item.id === 'health' && s && s.health.checks.some(check => check.status === 'warning' || check.status === 'critical') && <span className="nav-alert" />}{page === item.id && <span className="active-mark" />}</a>)}</nav>
      <div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><Icon icon={ShieldCheck} size={19} /></span><strong>A closer look. All local.</strong><p>Your system stats stay<br />right here on your machine.</p><div><span className="status-dot" />Read-only monitoring</div></div><div className="sidebar-footer"><span className="tiny-brand"><Activity size={15} /> PULSE</span><span>v1.0</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon icon={Menu} /></button><Icon icon={Monitor} size={16} /><span>Local machine</span><Icon icon={ChevronRight} size={13} /><strong>{navigation.find(item => item.id === page)?.label}</strong></div><div className="topbar-actions"><span className="local-connection"><span className={`connection-dot ${live ? '' : 'inactive'}`} />{paused ? 'Updates paused' : error ? 'Connection interrupted' : s ? 'Local connection' : 'Connecting'}</span><span className="topbar-divider" /><button className="icon-button" onClick={() => setDark(!dark)} title={dark ? 'Use light theme' : 'Use dark theme'} aria-label={dark ? 'Use light theme' : 'Use dark theme'}><Icon icon={dark ? Sun : Moon} size={18} /></button><span className="user-avatar" title="Local machine"><Monitor size={16} /></span></div></header>
      <main id="main-content" tabIndex={-1}>
        <div className="page-heading"><div><div className="eyebrow">{page === 'overview' ? 'THE BIG PICTURE' : 'A CLOSER LOOK'}</div><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div><div className="page-actions"><button className="button secondary" onClick={exportSnapshot} disabled={!data}><Icon icon={exported ? Check : Download} size={15} />{exported ? 'Exported' : 'Export snapshot'}</button><button className={`button ${paused ? 'resume-button' : 'secondary'}`} onClick={() => setPaused(!paused)} disabled={!data}><Icon icon={paused ? Play : Pause} size={14} />{paused ? 'Resume live' : 'Pause updates'}</button></div></div>
        <div className="monitor-status"><div><span className={`connection-dot ${live ? 'pulsing' : 'inactive'}`} /><strong>{error ? 'Connection issue' : paused ? 'Paused' : s ? 'Live monitoring' : 'Starting collector'}</strong><span className="status-separator">/</span><span>{paused ? 'Showing a frozen snapshot' : `Refreshes every ${(s?.interval || 2000) / 1000} seconds`}</span></div><button className="refresh-button" onClick={refresh} aria-label="Refresh metrics" disabled={refreshing}><span>{s ? `Updated ${new Date(s.timestamp).toLocaleTimeString([], { hour12: false })}` : 'Waiting for first sample'}</span><Icon icon={RefreshCw} size={13} className={refreshing ? 'spinning' : ''} /></button></div>
        {error && <div className="error-banner" role="alert"><Icon icon={Activity} size={18} /><span>{error}{s && ' Last received readings remain visible.'}</span><button onClick={refresh}>Retry now <Icon icon={RefreshCw} size={13} /></button></div>}
        {paused && <div className="pause-banner"><Icon icon={Pause} size={15} />You’re viewing a frozen snapshot. Collection continues in the background.</div>}
        {data ? <div className="page-content" key={page}>{page === 'overview' && <Overview data={data} minutes={minutes} setMinutes={setMinutes} />}{page === 'performance' && <Performance data={data} minutes={minutes} setMinutes={setMinutes} />}{page === 'storage' && <Storage data={data} minutes={minutes} setMinutes={setMinutes} />}{page === 'network' && <NetworkPage data={data} minutes={minutes} setMinutes={setMinutes} />}{page === 'processes' && <Processes snapshot={data.snapshot} />}{page === 'health' && <Health snapshot={data.snapshot} />}</div> : <div className="loading-state"><span className="loading-pulse"><Activity size={32} /></span><h2>Getting to know your machine</h2><p>{error ? 'The local API will reconnect automatically when it is available.' : 'Collecting the first CPU, memory, and storage readings…'}</p><div className="loading-dots"><i /><i /><i /></div></div>}
        <footer className="main-footer"><span><Icon icon={LockKeyhole} size={12} />Local data. No cloud. Just your machine.</span><span>Made for a little peace of mind <Activity size={13} /></span></footer>
      </main>
    </div>
  </div>;
}
