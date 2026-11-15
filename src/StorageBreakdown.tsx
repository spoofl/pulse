import { Fragment, useEffect, useState } from 'react';
import { ChevronRight, CircleAlert, File, Folder, FolderSearch, HardDrive, Link, LoaderCircle, RefreshCw } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { StorageEntry, StorageUsage, Volume } from '../shared/types';
import { Badge, Empty, Icon, Panel } from './components';
import { bytes, pct } from './lib/format';

const colors = ['#179d7c', '#7e6bd6', '#6194df', '#d49a3b', '#d3768c'];
const otherColor = '#8b9d98';
type Selection = { mount: string; path: string; action: 'view' | 'open' | 'scan'; revision: number };

function useStorageUsage(selection: Selection) {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setUsage(null);
    setError(null);
    if (!selection.mount) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    async function load(scan = false) {
      try {
        const query = new URLSearchParams({ mount: selection.mount, path: selection.path });
        if (scan) query.set('scan', '1');
        const response = await fetch(`/api/storage/usage?${query}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The storage scan is unavailable.');
        if (controller.signal.aborted) return;
        if (result.status === 'idle' && selection.action === 'open') { await load(true); return; }
        setUsage(result as StorageUsage);
        setLoading(false);
        if (result.status === 'scanning') timer = setTimeout(() => { void load(); }, 1500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : 'Cannot reach the storage scanner. Check that Pulse is running and try again.');
          setLoading(false);
        }
      }
    }
    void load(selection.action === 'scan');
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selection]);
  return { usage, error, loading };
}

function UsageChart({ usage }: { usage: StorageUsage }) {
  const main = usage.entries.filter(entry => entry.bytes > 0).slice(0, 5);
  const remainder = Math.max(0, (usage.total || 0) - main.reduce((sum, entry) => sum + entry.bytes, 0));
  const slices = main.map((entry, index) => ({ name: entry.name, value: entry.bytes, color: colors[index] }));
  if (remainder > 0) slices.push({ name: 'Other items & folder metadata', value: remainder, color: otherColor });
  return <div className="storage-chart-column">
    <div className="storage-donut" role="img" aria-label={`Storage breakdown of ${usage.path}: ${bytes(usage.total)} measured. Shares are listed below.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <PieChart accessibilityLayer>
          <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="68%" outerRadius="92%" paddingAngle={slices.length > 1 ? 2 : 0} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
            {slices.map((slice, index) => <Cell key={index} fill={slice.color} />)}
          </Pie>
          <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="storage-tooltip"><strong>{String(payload[0].name)}</strong><span>{bytes(Number(payload[0].value))} · {pct(Number(payload[0].value) / (usage.total || 1) * 100)}</span></div> : null} />
        </PieChart>
      </ResponsiveContainer>
      <div className="storage-donut-label"><strong>{bytes(usage.total)}</strong></div>
    </div>
    <p className="storage-chart-caption">{usage.partial ? 'Measured so far' : 'Scanned size'}<span>Share of scanned space</span></p>
    <ul className="storage-legend">{slices.map((slice, index) => <li key={index}><i style={{ background: slice.color }} /><span>{slice.name}</span><strong>{pct(slice.value / (usage.total || 1) * 100)}</strong></li>)}</ul>
  </div>;
}

function UsageRow({ entry, total, index, onOpen }: { entry: StorageEntry; total: number; index: number; onOpen: (path: string) => void }) {
  const share = total ? entry.bytes / total * 100 : 0;
  const contents = <>
    <span className="storage-entry-icon"><Icon icon={entry.kind === 'directory' ? Folder : entry.kind === 'symlink' ? Link : File} size={19} /></span>
    <span className="storage-entry-name"><strong>{entry.name}</strong><span>{entry.kind === 'directory' ? 'Folder' : entry.kind === 'symlink' ? 'Symbolic link · not followed' : entry.kind === 'file' ? 'File' : 'Other item'}</span></span>
    <span className="storage-entry-size"><strong>{bytes(entry.bytes)}</strong><span>{pct(share)}</span></span>
    {entry.kind === 'directory' ? <Icon icon={ChevronRight} size={17} /> : <span className="storage-entry-spacer" />}
    <span className="storage-entry-bar" aria-hidden="true"><i style={{ width: `${share}%`, background: colors[index] || otherColor }} /></span>
  </>;
  return <li>{entry.kind === 'directory' ? <button className="storage-entry" onClick={() => onOpen(entry.path)} title={entry.path} aria-label={`Open folder ${entry.name}`}>{contents}</button> : <div className="storage-entry" title={entry.path}>{contents}</div>}</li>;
}

export function StorageBreakdown({ volumes }: { volumes: Volume[] }) {
  const preferred = volumes.find(volume => volume.mount === '/')?.mount || volumes[0]?.mount || '';
  const [selection, setSelection] = useState<Selection>({ mount: preferred, path: preferred, action: 'view', revision: 0 });
  const [limit, setLimit] = useState(10);
  const { usage, error, loading } = useStorageUsage(selection);
  const volume = volumes.find(item => item.mount === selection.mount);
  const scanning = usage?.status === 'scanning';
  const ready = usage?.status === 'ready';
  const total = usage?.total || 0;
  const root = selection.mount.replace(/\/$/, '');
  const parts = selection.path.slice(root.length).split('/').filter(Boolean);
  const crumbs = [{ name: selection.mount === '/' ? 'System volume' : selection.mount, path: selection.mount }, ...parts.map((name, index) => ({ name, path: `${root}/${parts.slice(0, index + 1).join('/')}` }))];

  useEffect(() => {
    if (!volume && preferred) setSelection({ mount: preferred, path: preferred, action: 'view', revision: 0 });
  }, [volume, preferred]);

  function openFolder(path: string) {
    setLimit(10);
    setSelection(previous => ({ ...previous, path, action: 'open', revision: previous.revision + 1 }));
  }
  function scanFolder() {
    setSelection(previous => ({ ...previous, action: 'scan', revision: previous.revision + 1 }));
  }

  return <Panel title="What’s using your storage?" subtitle="Find the largest folders and files, then open a folder to look closer." className="storage-breakdown" action={<button className="button secondary" onClick={scanFolder} disabled={!volume || loading || scanning}><Icon icon={scanning ? LoaderCircle : RefreshCw} size={16} className={scanning ? 'spinning' : ''} />{scanning ? 'Scanning…' : ready ? 'Rescan folder' : 'Scan folder'}</button>}>
    {!volumes.length ? <Empty>No mounted volumes are available to scan.</Empty> : <>
      <div className="storage-controls">
        <label className="storage-volume-label"><Icon icon={HardDrive} size={18} /><span>Volume</span><select aria-label="Storage volume" value={selection.mount} onChange={event => { const mount = event.target.value; setLimit(10); setSelection(previous => ({ mount, path: mount, action: 'view', revision: previous.revision + 1 })); }}>{volumes.map(item => <option key={item.mount} value={item.mount}>{item.mount === '/' ? 'System volume (/)' : item.mount} · {bytes(item.size)}</option>)}</select></label>
        {ready && <span className="storage-scan-time">Scanned {new Date(usage.scannedAt!).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}<Badge status={usage.partial ? 'warning' : 'neutral'}>{usage.partial ? 'Partial scan' : 'Scan complete'}</Badge></span>}
      </div>
      <div className="storage-breadcrumbs" role="group" aria-label="Folder path">{crumbs.map((crumb, index) => <Fragment key={crumb.path}>{index > 0 && <Icon icon={ChevronRight} size={14} />}{index === crumbs.length - 1 ? <span aria-current="location">{crumb.name}</span> : <button onClick={() => openFolder(crumb.path)}>{crumb.name}</button>}</Fragment>)}</div>
      <p className="storage-current-path mono">{selection.path}</p>
      {(error || usage?.status === 'error') && <div className="storage-notice" role="alert"><Icon icon={CircleAlert} size={19} /><span>{error || usage?.message}</span><button className="button secondary small" onClick={scanFolder}>Retry scan</button></div>}
      {loading || scanning ? <div className="storage-scan-state" role="status"><Icon icon={LoaderCircle} size={30} className="spinning" /><h3>{scanning ? 'Measuring folder sizes…' : 'Loading storage breakdown…'}</h3><p>{scanning ? 'Large folders can take a minute or two. You can keep using Pulse while this scan runs.' : 'Checking for an existing scan of this folder.'}</p>{scanning && <span>{usage.entryCount} items measured</span>}</div> : usage?.status === 'idle' && !error ? <div className="storage-scan-state"><span className="storage-scan-icon"><Icon icon={FolderSearch} size={32} /></span><h3>Find what’s taking up space</h3><p>Scan this volume to see its largest folders and files, including hidden folders. Results stay available until you rescan or restart Pulse.</p><button className="button resume-button" onClick={scanFolder}><Icon icon={FolderSearch} size={17} />Analyze storage</button></div> : null}
      {ready && !error && <>
        {usage.partial && <div className="storage-notice" role="status"><Icon icon={CircleAlert} size={19} /><span>{usage.message}</span></div>}
        {total > 0 ? <div className="storage-breakdown-grid">
          <UsageChart usage={usage} />
          <div className="storage-items"><div className="storage-items-heading"><h3>Largest items</h3><span>Size / share of scan</span></div>
            <ol>{usage.entries.slice(0, limit).map((entry, index) => <UsageRow key={entry.path} entry={entry} total={total} index={index} onOpen={openFolder} />)}</ol>
            {!usage.entries.length && <p className="storage-list-note">No files or subfolders found. The measured space belongs to the folder itself.</p>}
            {usage.otherBytes > 0 && <div className="storage-other"><span>Other items & folder metadata</span><strong>{bytes(usage.otherBytes)}</strong></div>}
            <div className="storage-list-footer"><span>{Math.min(limit, usage.entries.length)} of {usage.entryCount} measured items</span>{usage.entries.length > limit && <button className="button secondary small" onClick={() => setLimit(limit + 20)}>Show more</button>}</div>
            {usage.entryCount > usage.entries.length && <p className="storage-list-note">The largest 200 items are listed. Remaining space is included in “Other items & folder metadata”.</p>}
          </div>
        </div> : <Empty>{usage.partial ? 'No disk usage could be measured. Some locations were unreadable.' : 'No allocated file data was found in this folder.'}</Empty>}
      </>}
      <p className="panel-note">{ready && selection.path === selection.mount && volume && <>This volume reports <strong>{bytes(volume.used)} used</strong>; the scan measured <strong>{bytes(usage.total)}</strong>. </>}Sizes reflect space on disk, including hidden items. Other filesystems and symbolic-link targets are excluded. Permissions, filesystem metadata, and shared data can make scan totals differ from volume usage. Scans run only when requested; live metric updates do not repeat them.</p>
    </>}
  </Panel>;
}
