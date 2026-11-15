import { useId, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, Check, CircleAlert, CircleHelp, type LucideIcon } from 'lucide-react';
import type { HealthStatus, HistoryPoint } from '../shared/types';
import { clockTime, pct, rate, temp } from './lib/format';

export function Icon({ icon: Component, size = 18, ...props }: { icon: LucideIcon; size?: number; className?: string }) {
  return <Component size={size} strokeWidth={1.8} aria-hidden="true" {...props} />;
}

export function Badge({ status = 'ok', children }: { status?: HealthStatus | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${status}`}><span className="status-dot" />{children}</span>;
}

export function StatusIcon({ status }: { status: HealthStatus }) {
  return <span className={`check-icon status-${status}`}><Icon icon={status === 'ok' ? Check : status === 'unknown' ? CircleHelp : CircleAlert} size={15} /></span>;
}

export function Panel({ title, subtitle, action, children, className = '' }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{title && <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>}{children}</section>;
}

export function ViewLink({ to, children = 'View details' }: { to: string; children?: ReactNode }) {
  return <a className="view-link" href={`#${to}`}>{children}<Icon icon={ArrowUpRight} size={15} /></a>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state"><Icon icon={CircleHelp} size={24} /><p>{children}</p></div>;
}

export function Meter({ value, color = 'green', label }: { value: number; color?: string; label: string }) {
  return <div className={`meter meter-${color}`} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

type ChartKey = Exclude<keyof HistoryPoint, 'timestamp'>;
const colors = { cpu: '#179d7c', memory: '#7e6bd6', temperature: '#d48d35', rx: '#179d7c', tx: '#8b79d9', read: '#179d7c', write: '#6194df' };
const names = { cpu: 'CPU', memory: 'Memory', temperature: 'Temperature', rx: 'Download', tx: 'Upload', read: 'Read', write: 'Write' };

export function Chart({ history, series, minutes = 5, mini = false }: { history: HistoryPoint[]; series: ChartKey[]; minutes?: number; mini?: boolean }) {
  const id = useId().replace(/:/g, '');
  const now = history.at(-1)?.timestamp ?? Date.now();
  const points = history.filter(point => point.timestamp >= now - minutes * 60_000);
  // At most 3,600 samples are retained; keep them all so brief spikes remain visible.
  const data = points;
  const percent = series.every(key => key === 'cpu' || key === 'memory');
  const thermal = series[0] === 'temperature';
  const formatter = percent ? pct : thermal ? temp : rate;
  if (!data.length || !data.some(point => series.some(key => point[key] !== null))) return mini ? <div className="mini-empty" /> : <Empty>Waiting for readings. History appears as samples arrive.</Empty>;
  return <div className={mini ? 'mini-chart' : 'history-chart'} role="img" aria-label={`${series.map(key => names[key]).join(' and ')} history over the last ${minutes} minutes`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={mini ? { top: 4, right: 0, bottom: 0, left: 0 } : { top: 15, right: 8, bottom: 0, left: -15 }} accessibilityLayer={!mini}>
        <defs>{series.map(key => <linearGradient key={key} id={`${id}-${key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[key]} stopOpacity={mini ? 0.17 : 0.14} /><stop offset="100%" stopColor={colors[key]} stopOpacity={0.005} /></linearGradient>)}</defs>
        {!mini && <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 4" vertical={false} />}
        {!mini && <XAxis dataKey="timestamp" type="number" domain={[now - minutes * 60_000, now]} tickFormatter={clockTime} stroke="var(--muted)" tickLine={false} axisLine={false} minTickGap={60} tick={{ fontSize: 11 }} dy={10} />}
        {!mini && <YAxis domain={percent ? [0, 100] : [0, 'auto']} tickFormatter={value => percent ? `${value}%` : thermal ? `${value}°` : rate(value)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={percent ? 55 : 87} stroke="var(--muted)" />}
        {!mini && <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text)', boxShadow: '0 8px 24px #0000000c' }} labelFormatter={label => new Date(Number(label)).toLocaleTimeString()} formatter={(value, name) => [formatter(typeof value === 'number' ? value : null), name]} />}
        {series.map(key => <Area key={key} type="monotone" dataKey={key} name={names[key]} stroke={colors[key]} strokeWidth={mini ? 1.7 : 2} fill={`url(#${id}-${key})`} isAnimationActive={false} connectNulls={false} dot={data.length < 3 && !mini ? { r: 3 } : false} activeDot={mini ? false : { r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} />)}
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

export function MetricCard({ icon, title, value, unit, note, history, series, color = 'green', to }: { icon: LucideIcon; title: string; value: string; unit?: string; note: string; history?: HistoryPoint[]; series?: ChartKey; color?: string; to: string }) {
  return <a className={`metric-card accent-${color}`} href={`#${to}`}>
    <div className="metric-title"><span className="metric-icon"><Icon icon={icon} size={17} /></span><span>{title}</span><Icon icon={ArrowUpRight} size={15} className="metric-arrow" /></div>
    <div className="metric-middle"><div className="metric-value">{value}<span>{unit}</span></div>{history && series && <Chart history={history} series={[series]} mini minutes={5} />}</div>
    <div className="metric-note">{note}</div>
  </a>;
}

export function RangeSelect({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  return <div className="range-select" role="group" aria-label="History time range">{[1, 5, 15, 60].map(value => <button key={value} className={minutes === value ? 'selected' : ''} onClick={() => onChange(value)} aria-pressed={minutes === value}>{value === 60 ? '1h' : `${value}m`}</button>)}</div>;
}
