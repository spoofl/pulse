import { expect, test, type Page } from '@playwright/test';
import type { StorageUsage } from '../shared/types';

const GiB = 1024 ** 3;
const root: StorageUsage = {
  mount: '/', path: '/', status: 'ready', startedAt: 1, scannedAt: Date.now(), total: 100 * GiB,
  entries: [
    { name: 'home', path: '/home', bytes: 70 * GiB, kind: 'directory' },
    { name: 'var', path: '/var', bytes: 20 * GiB, kind: 'directory' },
    { name: 'archive-with-a-very-long-name-that-must-remain-readable.tar', path: '/archive-with-a-very-long-name-that-must-remain-readable.tar', bytes: 5 * GiB, kind: 'file' },
    ...Array.from({ length: 10 }, (_, index) => ({ name: `folder-${index}`, path: `/folder-${index}`, bytes: GiB / 10, kind: 'directory' as const })),
  ], otherBytes: 4 * GiB, entryCount: 13, partial: true, message: 'Some locations could not be read. These totals exclude unreadable data.',
};
const child: StorageUsage = { ...root, path: '/home', total: 70 * GiB, entries: [{ name: '.cache', path: '/home/.cache', bytes: 70 * GiB, kind: 'directory' }], otherBytes: 0, entryCount: 1, partial: false, message: null };

async function mockScans(page: Page, options: { cached?: boolean; denyChild?: boolean } = {}) {
  const scans: string[] = [];
  const completed = new Set(options.cached ? ['/'] : []);
  const active = new Set<string>();
  await page.route('**/api/storage/usage?**', async route => {
    const query = new URL(route.request().url()).searchParams;
    const folder = query.get('path')!;
    if (folder === '/home' && options.denyChild) return route.fulfill({ status: 403, json: { error: 'Pulse does not have permission to read this folder.' } });
    const data = folder === '/home' ? child : root;
    if (query.get('scan') === '1') {
      scans.push(folder);
      active.add(folder);
      return route.fulfill({ status: 202, json: { ...data, status: 'scanning', entries: [], total: null, entryCount: 0, scannedAt: null } });
    }
    if (active.delete(folder)) completed.add(folder);
    return route.fulfill({ json: completed.has(folder) ? data : { ...data, mount: query.get('mount'), path: folder, status: 'idle', entries: [], total: null, scannedAt: null } });
  });
  return scans;
}

test('storage scans on request, charts measured space, opens folders, and reuses cached results', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const scans = await mockScans(page);
  await page.goto('/#storage');
  await expect(page.getByRole('button', { name: 'Analyze storage' })).toBeVisible();
  expect(scans).toEqual([]);
  await page.getByRole('button', { name: 'Analyze storage' }).click();
  await expect(page.getByText('Measuring folder sizes…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Largest items' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Storage breakdown of \// })).toBeVisible();
  await expect(page.getByText('Partial scan', { exact: true })).toBeVisible();
  await expect(page.locator('.storage-legend')).toContainText('70.0%');
  await expect(page.locator('.storage-items ol > li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(page.locator('.storage-items ol > li')).toHaveCount(13);
  await page.getByRole('button', { name: 'Open folder home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open folder .cache', exact: true })).toBeVisible();
  await expect(page.locator('.storage-current-path')).toHaveText('/home');
  await expect(page.getByText('Scan complete', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Folder path' }).getByRole('button', { name: 'System volume' }).click();
  await expect(page.getByRole('button', { name: 'Open folder home', exact: true })).toBeVisible();
  expect(scans).toEqual(['/', '/home']);
  await page.getByRole('button', { name: 'Rescan folder' }).click();
  await expect(page.getByRole('heading', { name: 'Largest items' })).toBeVisible();
  expect(scans).toEqual(['/', '/home', '/']);
  const select = page.getByRole('combobox', { name: 'Storage volume' });
  const alternative = await select.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).find(value => value !== '/'));
  if (alternative) {
    await select.selectOption(alternative);
    await expect(page.getByRole('button', { name: 'Analyze storage' })).toBeVisible();
    await expect(page.locator('.storage-current-path')).toHaveText(alternative);
    expect(scans).toHaveLength(3);
  }
  expect(errors).toEqual([]);
});

test('an unreadable folder has a recoverable error and working breadcrumbs', async ({ page }) => {
  await mockScans(page, { cached: true, denyChild: true });
  await page.goto('/#storage');
  await page.getByRole('button', { name: 'Open folder home', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('does not have permission');
  await expect(page.getByRole('button', { name: 'Retry scan' })).toBeVisible();
  await page.getByRole('group', { name: 'Folder path' }).getByRole('button', { name: 'System volume' }).click();
  await expect(page.getByRole('heading', { name: 'Largest items' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('storage results remain readable on mobile and at enlarged text sizes in both themes', async ({ page }) => {
  await mockScans(page, { cached: true });
  await page.goto('/#storage');
  await expect(page.getByRole('heading', { name: 'Largest items' })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const theme of ['light', 'dark']) {
      for (const fontSize of ['100%', '200%']) {
        await page.evaluate(({ theme, fontSize }) => { document.documentElement.dataset.theme = theme; document.documentElement.style.fontSize = fontSize; }, { theme, fontSize });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const problems = await page.locator('.storage-breakdown').evaluate(panel => [...panel.querySelectorAll('*')].filter(element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) && parseFloat(style.fontSize) < 14;
        }).map(element => element.textContent));
        expect(problems).toEqual([]);
        // Enlarging text must not push the total out of the doughnut's center.
        const labelFits = await page.locator('.storage-donut-label').evaluate(label => {
          const outer = label.getBoundingClientRect();
          const text = label.querySelector('strong')!.getBoundingClientRect();
          return text.height <= outer.height + 1 && text.width <= outer.width + 1;
        });
        expect(labelFits).toBe(true);
      }
    }
  }
});
