# Pulse

A local machine monitor built with **React, TypeScript, Vite, Express, and Recharts**. It displays real statistics from the machine running the Node server, with a responsive interface and light/dark themes.

## Run locally

Requires Node.js **22.12 or newer** and npm.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Vite serves the UI and proxies `/api` to the local collector on port 4310.

For a production build:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4310**. One Node process serves the built UI and the metrics API. Stop either mode with Ctrl+C.

## Open on other devices on your network

```sh
npm run lan
```

This builds the app, starts it on all IPv4 interfaces, and prints a **Network** URL such as `http://192.168.1.25:4310`. Open that printed URL on a phone, tablet, or computer connected to the same network. Every device sees statistics for the machine running Pulse. LAN mode allows network access without a login; the regular `dev` and `start` commands continue to use loopback only.

Stop any existing Pulse server using port 4310 before starting LAN mode, or choose another port with `PORT=4400 npm run lan`. If another device cannot connect, allow inbound TCP traffic for that port through the host firewall and check that the Wi-Fi network permits devices to communicate (guest networks may isolate clients). Stop sharing with Ctrl+C. If the machine's network address changes, restart the command to print and allow its new address.

## What it monitors

- **Overview:** CPU and memory usage, storage capacity, primary-interface traffic, health checks, top processes, and uptime.
- **Performance:** Per-core utilization, CPU clock speed and temperature, system load averages, physical memory, buffers/cache, swap, and disk throughput.
- **Storage:** Folder/file size breakdown with a doughnut chart, largest items first, folder drill-down and breadcrumbs, unique persistent mounted filesystems, available space, physical drive inventory, temperatures, and reported S.M.A.R.T. status.
- **Network:** Download/upload rates, transfer counters, adapter addresses, link state, speed, and error counters.
- **Processes:** Search by name, PID, or user; sort by CPU, resident memory, name, or PID; load additional rows.
- **Health:** Explicit thresholds, unavailable checks, machine details, battery charge, and battery health when supported.

Charts offer 1-minute, 5-minute, 15-minute, and 1-hour windows. Pause freezes the displayed snapshot while collection continues. Export downloads the snapshot and the browser's collected history as JSON.

### Find what is using disk space

Open **Storage**, select a volume, and click **Analyze storage**. The doughnut chart shows the share of measured space used by its largest folders and files. Click a folder to scan inside it; use the breadcrumbs to return. **Rescan folder** refreshes an existing result. This is a separate, on-demand scan, independent of the live metrics and their pause button.

The scanner uses [GNU `du`](https://www.gnu.org/software/coreutils/manual/html_node/du-invocation.html) (normally included on Linux), counts allocated disk space including hidden files, counts hard-linked data once per scan, and skips symbolic-link targets and other filesystems. It reads names and sizes, never file contents, and requires no administrator privileges. The largest 200 immediate items are retained; remaining space appears under **Other items & folder metadata**. Directory sizes include their descendants. On unsupported systems the UI reports that scanning is unavailable.

Only one scan runs at a time, with a two-minute limit. Up to 24 folder results stay in memory until rescanned, evicted, or the server restarts; live updates never trigger another scan. Unreadable locations, files changing during a scan, and time limits produce visibly **partial** results. The chart's percentages refer to measured space, not full volume capacity. Permissions, filesystem metadata, snapshots/shared blocks, and deleted files still held open can make the scan differ from the volume's used-space reading. In LAN mode, connected devices can also view these folder and file names.

## Collection and interpretation

The collector samples every 2 seconds by default, keeps up to one hour of history in RAM, and refreshes physical drive metadata every minute. History begins when the server starts, and restarting clears it. Only observed samples are plotted. Multiple browser tabs share one collector.

Most metrics come from [systeminformation](https://systeminformation.io/). Linux processes are sampled directly from `/proc` with bounded filesystem concurrency, avoiding a shell command per process. CPU usage is the change in process ticks divided by the change in total machine ticks, so 100% represents all CPU capacity on Linux. New processes need two samples; PID reuse and exiting processes are handled. Process names may be truncated by the kernel. Other operating systems use the systeminformation process API and its native CPU conventions. Linux has been verified locally; other platforms depend on the library's support.

Memory usage is `total - available`, so reclaimable cache does not inflate usage. Filesystems mounted repeatedly are deduplicated by device, and temporary/virtual filesystems are excluded. Network summary rates use the default interface (or the first active physical interface) to avoid counting bridged traffic twice. Network transfer counters run from the last operating-system/interface reset. Link state does not establish internet connectivity.

Missing or unsupported measurements are shown as **Unavailable** or **—**, not healthy or zero. Temperature and S.M.A.R.T. depend on the OS, hardware, installed tools, and current device permissions. In particular, the drive on this machine did not expose S.M.A.R.T. status under the current account. No elevated privileges are requested. Collection failures preserve unrelated metrics; a stale or unreachable collector is explicitly indicated.

Health checks use fixed, visible thresholds. They are operational indicators, not a complete hardware diagnostic:

| Reading | Warning | Critical |
| --- | --- | --- |
| CPU usage, latest sample | ≥90% | ≥98% |
| Memory usage | ≥85% | ≥95% |
| Volume usage | ≥85% | ≥95% |
| Highest CPU temperature | ≥80°C | ≥95°C |
| Battery charge without AC power | ≤20% | ≤10% |
| S.M.A.R.T. | — | Drive reports failure |

“No issues detected” refers to available checks. Unavailable checks are counted separately. Temperature limits are generic defaults; manufacturer-specific limits may differ.

Development and normal production servers bind to **127.0.0.1**. The explicit `lan` command binds the production server to **0.0.0.0** and allows this machine's IPv4 addresses and hostname. The API validates Host and Origin in both modes, has no write operations or permissive CORS, and omits process arguments, environment variables, and disk serial numbers. Fonts and assets are bundled locally. There are no external runtime requests, accounts, or telemetry. Authentication is not included.

## Configuration

Environment variables are passed to the command directly; `.env` files are not automatically loaded by the server.

```sh
PORT=4400 SAMPLE_INTERVAL_MS=5000 npm run dev
```

`PORT` changes the API/production port (including LAN mode) and the development proxy target. `SAMPLE_INTERVAL_MS` must be between 1000 and 30000. Samples never overlap; slow system calls can extend the interval. A metric call has a bounded wait and is not duplicated while an earlier call is still pending.

## Verification

```sh
npm test          # HTTP protections, storage scans, health boundaries, process parsing
npm run build    # TypeScript checks and production client/server builds
npm run test:e2e # Builds, starts an isolated server, and runs browser checks
```

Browser tests cover live readings, navigation, search/sorting, pause/resume, JSON export, theme persistence, outage recovery, local-only asset requests, and mobile overflow. They use `/usr/bin/chromium-browser` when installed. Otherwise, install Playwright Chromium with `npx playwright install chromium`, or specify `CHROMIUM_PATH=/path/to/chromium`.

## Project layout

```text
src/                    React UI, charts, styles, polling, and formatting
server/collector.ts     Shared sampler, metric normalization, bounded history
server/linux-processes.ts  Linux process counters and process inventory
server/storage.ts       On-demand folder scans and bounded in-memory results
server/health.ts        Health thresholds and volume deduplication
server/app.ts          Local API and production static serving
shared/types.ts        Client/server response contracts
tests/                 Browser integration tests
```

Metric references: [memory fields](https://systeminformation.io/memory.html), [disk and S.M.A.R.T. fields](https://systeminformation.io/filesystem.html), [rate sampling](https://systeminformation.io/statsfunctions.html), and [Linux `/proc` documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html).
