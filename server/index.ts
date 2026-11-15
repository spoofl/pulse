import { createApp } from './app.js';
import { Collector } from './collector.js';
import { hostname, networkInterfaces } from 'node:os';

const port = Number(process.env.PORT || 4310);
const interval = Number(process.env.SAMPLE_INTERVAL_MS || 2000);
const lan = process.argv.includes('--lan');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
if (!Number.isInteger(interval) || interval < 1000 || interval > 30_000) throw new Error('SAMPLE_INTERVAL_MS must be between 1000 and 30000.');

const collector = new Collector(interval);
const addresses = lan ? [...new Set(Object.values(networkInterfaces()).flatMap(interfaces => interfaces || [])
  .filter(network => !network.internal && network.family === 'IPv4').map(network => network.address))] : [];
const machine = hostname();
const allowedHosts = lan ? [...addresses, machine, `${machine}.local`] : [];
const server = createApp(collector, { allowedHosts }).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Pulse is running at http://127.0.0.1:${port}`);
  if (lan) {
    for (const address of addresses) console.log(`Network: http://${address}:${port}`);
    console.log('LAN mode: devices on your network can view this machine’s statistics.');
    if (!addresses.length) console.log('No network address found. Connect to your network and run npm run lan again.');
  }
  void collector.start().catch(error => { console.error(error); shutdown(); });
});
server.on('error', error => { console.error(error.message); collector.stop(); process.exitCode = 1; });

function shutdown() {
  collector.stop();
  server.close(() => process.exit());
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
