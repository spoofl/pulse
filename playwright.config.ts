import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4311', headless: true, viewport: { width: 1440, height: 1100 }, launchOptions: { executablePath }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build && npm run start', url: 'http://127.0.0.1:4311/api/metrics', env: { PORT: '4311' }, timeout: 90_000, reuseExistingServer: false, stdout: 'pipe', stderr: 'pipe' },
});
