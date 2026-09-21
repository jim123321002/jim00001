import { test, expect } from '@playwright/test';

test('renders seven numbered keys and responds to keyboard', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/number-music/');
  await expect(page.getByRole('heading', { name: '数字音乐键盘' })).toBeVisible();
  await expect(page.locator('.key')).toHaveCount(7);
  await page.keyboard.press('1');
  await expect(page.locator('#status')).toContainText('1');
});

test('mobile layout exposes tappable keys', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4173/number-music/');
  const first = page.locator('[data-note="1"]');
  await expect(first).toBeVisible();
  await first.tap();
  await expect(page.locator('#status')).toContainText('1');
});

test('frequency mapping is ascending', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/number-music/');
  const result = await page.evaluate(() => [1,2,3,4,5,6,7].map(n => window.__numberMusic.frequencyFor(n,4)));
  expect(result).toHaveLength(7);
  for (let i=1;i<result.length;i++) expect(result[i]).toBeGreaterThan(result[i-1]);
});
