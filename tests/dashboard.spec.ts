import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('shows real machine readings and every dashboard view works', async ({ page, request }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4311/')) externalRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resource activity' })).toBeVisible();
  const data = await (await request.get('/api/metrics')).json();
  expect(data.snapshot.host.cores).toBeGreaterThan(0);
  expect(data.snapshot.memory.total).toBeGreaterThan(0);
  expect(data.snapshot.storage.volumes.length).toBeGreaterThan(0);
  expect(data.snapshot.processes.all).toBeGreaterThan(0);
  await expect(page.locator('.machine-switch strong')).toHaveText(data.snapshot.host.hostname);
  await page.getByRole('button', { name: '15m', exact: true }).click();
  await expect(page.getByRole('button', { name: '15m', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const [link, heading] of [['Performance', 'Performance over time'], ['Storage', 'Mounted volumes'], ['Network', 'Network interfaces'], ['Processes', 'Running on your machine'], ['System health', 'Health checks']]) {
    await page.getByRole('navigation').getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('pause freezes displayed readings, resume recovers, and export contains real data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resource activity' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause updates' }).click();
  const frozen = await page.locator('.refresh-button').innerText();
  await page.waitForTimeout(2600);
  expect(await page.locator('.refresh-button').innerText()).toBe(frozen);
  await expect(page.getByText('You’re viewing a frozen snapshot.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh metrics' })).toBeEnabled();
  await page.getByRole('button', { name: 'Resume live' }).click();
  await expect(page.locator('.refresh-button')).not.toHaveText(frozen);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export snapshot' }).click();
  const download = await downloadEvent;
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(data.snapshot.host.hostname).toBeTruthy();
  expect(data.snapshot.timestamp).toBeGreaterThan(0);
  expect(data.history.length).toBeGreaterThan(0);
  expect(download.suggestedFilename()).toMatch(/^pulse-.*\.json$/);
});

test('process search, empty results, sorting, and theme persistence work', async ({ page }) => {
  await page.goto('/#processes');
  const search = page.getByRole('textbox', { name: 'Search processes' });
  await expect(search).toBeVisible();
  await search.fill('this-process-does-not-exist-38292');
  await expect(page.getByText('No processes match', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await search.fill('node');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  for (const name of await page.locator('.process-name').allTextContents()) expect(name.toLowerCase()).toContain('node');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Memory' })).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('collector outages are visible, stale readings remain, and retry recovers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resource activity' })).toBeVisible();
  await page.route('**/api/metrics**', route => route.abort('failed'));
  await expect(page.getByRole('alert')).toContainText('Cannot reach the local collector');
  await expect(page.getByRole('heading', { name: 'Resource activity' })).toBeVisible();
  await expect(page.locator('.monitor-status strong')).toHaveText('Connection issue');
  await page.unroute('**/api/metrics**');
  await page.getByRole('button', { name: 'Retry now' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.monitor-status strong')).toHaveText('Live monitoring');
});

test('mobile navigation and all pages fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resource activity' })).toBeVisible();
  for (const label of ['Overview', 'Performance', 'Storage', 'Network', 'Processes', 'System health']) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator('.nav-scrim')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
  }
});
