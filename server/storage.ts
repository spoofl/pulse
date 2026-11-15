import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { StorageEntry, StorageUsage } from '../shared/types.js';

const MAX_ENTRIES = 200;
const MAX_CACHED_FOLDERS = 24;

export class StorageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export class StorageScanner {
  private cache = new Map<string, StorageUsage>();
  private active: ChildProcess | null = null;

  constructor(private timeoutMs = 120_000) {}

  async getUsage(mount: string, directory: string, mounts: string[], scan = false): Promise<StorageUsage> {
    if (!mounts.includes(mount)) throw new StorageError(400, 'Select a mounted volume reported by this machine.');
    if (!path.isAbsolute(directory) || directory.includes('\0') || directory.length > 4096 || !inside(mount, path.resolve(directory))) {
      throw new StorageError(400, 'The folder must be inside the selected volume.');
    }
    const target = path.resolve(directory);
    try {
      const [rootPath, targetPath, rootInfo, targetInfo] = await Promise.all([realpath(mount), realpath(target), stat(mount), stat(target)]);
      if (!inside(rootPath, targetPath) || targetPath !== target) throw new StorageError(400, 'Symbolic links cannot be opened in the storage breakdown.');
      if (!targetInfo.isDirectory()) throw new StorageError(400, 'Select a folder to scan.');
      if (targetInfo.dev !== rootInfo.dev) throw new StorageError(400, 'This folder belongs to another filesystem. Select its volume instead.');
      await access(target, constants.R_OK | constants.X_OK);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code || '')) throw new StorageError(403, 'Pulse does not have permission to read this folder.');
      throw new StorageError(404, 'This folder is no longer available.');
    }

    const key = JSON.stringify([mount, target]);
    const cached = this.cache.get(key);
    if (cached?.status === 'scanning' || (cached && !scan)) return cached;
    const result: StorageUsage = { mount, path: target, status: 'idle', startedAt: null, scannedAt: null, total: null, entries: [], otherBytes: 0, entryCount: 0, partial: false, message: null };
    if (!scan) return result;
    if (this.active) throw new StorageError(429, 'Another storage scan is running. Please retry when it finishes.');

    while (this.cache.size >= MAX_CACHED_FOLDERS) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, result);
    result.status = 'scanning';
    result.startedAt = Date.now();
    this.scan(result);
    return result;
  }

  stop() { this.active?.kill('SIGKILL'); }

  private scan(result: StorageUsage) {
    // No shell, no file contents, no symlink traversal, and no crossing into other filesystems.
    const child = spawn('du', ['--all', '--one-file-system', '--block-size=1', '--max-depth=1', '--null', '--', result.path], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' },
    });
    this.active = child;
    let buffer = '';
    let total: number | null = null;
    let measuredChildren = 0;
    let hadErrors = false;
    let timedOut = false;
    let commandError = false;
    const entries: StorageEntry[] = [];
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, this.timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let separator: number;
      while ((separator = buffer.indexOf('\0')) !== -1) {
        const record = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 1);
        const tab = record.indexOf('\t');
        const size = Number(record.slice(0, tab));
        const entryPath = record.slice(tab + 1);
        if (tab < 1 || !Number.isSafeInteger(size) || size < 0) { hadErrors = true; continue; }
        if (entryPath === result.path) { total = size; continue; }
        if (path.dirname(entryPath) !== result.path) { hadErrors = true; continue; }
        measuredChildren += size;
        result.entryCount++;
        // Keep the largest entries only, even for directories with millions of files.
        if (entries.length < MAX_ENTRIES || size > entries[entries.length - 1].bytes) {
          entries.push({ name: path.basename(entryPath), path: entryPath, bytes: size, kind: 'other' });
          entries.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
          if (entries.length > MAX_ENTRIES) entries.pop();
        }
      }
      if (buffer.length > 64 * 1024) { hadErrors = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', () => { hadErrors = true; });
    child.on('error', () => { commandError = true; });
    child.on('close', async code => {
      clearTimeout(timer);
      try {
        // Bound metadata work independently of the number of files scanned.
        for (let offset = 0; offset < entries.length; offset += 16) {
          await Promise.all(entries.slice(offset, offset + 16).map(async entry => {
            try {
              const info = await lstat(entry.path);
              entry.kind = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
            } catch { hadErrors = true; }
          }));
        }
        const incomplete = code !== 0 || hadErrors || total === null;
        result.partial = incomplete;
        result.scannedAt = Date.now();
        if (total === null && result.entryCount === 0) {
          result.status = 'error';
          result.message = commandError ? 'Storage scanning requires GNU du on the server.' : timedOut ? 'The scan reached its two-minute limit before a folder could be measured. Try a smaller folder.' : 'This folder could not be measured. Check its permissions and that GNU du is installed.';
          return;
        }
        result.entries = entries;
        result.total = Math.max(total ?? 0, measuredChildren);
        result.otherBytes = Math.max(0, result.total - entries.reduce((sum, entry) => sum + entry.bytes, 0));
        result.status = 'ready';
        result.message = timedOut ? 'The two-minute scan limit was reached. These are only the items measured before it stopped.' : incomplete ? 'Some locations could not be read or changed during the scan. These totals exclude any unreadable data.' : null;
      } finally {
        if (this.active === child) this.active = null;
      }
    });
  }
}
