import { test, expect } from '@playwright/test';
import { upload, diagnostics, run } from './helpers.mjs';

test('LIVE real Chinese image → local OCR → real MyMemory → fitted PNG', async ({ page }, info) => {
  const errors = [], translationRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (request.url().startsWith('https://api.mymemory.translated.net/')) translationRequests.push(request.url()); });
  await page.goto('./'); await expect(page).toHaveTitle(/译图/);
  await upload(page, ['安全第一'], '真实联调-安全第一.png'); await run(page);
  const data = (await diagnostics(page))[0];
  expect(data.exportable, JSON.stringify(data)).toBe(true); expect(data.regions.length).toBeGreaterThan(0);
  expect(data.regions[0].source).toContain('安全'); expect(data.regions[0].translation).toMatch(/safety|safe|security/i);
  expect(translationRequests.length).toBeGreaterThan(0); expect(errors).toEqual([]);
  const version = await page.evaluate(async () => (await fetch('./version.json', { cache: 'no-store' })).json());
  if (process.env.GITHUB_SHA) expect(version.commit).toBe(process.env.GITHUB_SHA);
  const download = page.waitForEvent('download'); await page.locator('#download').click(); expect((await download).suggestedFilename()).toMatch(/-en\.png$/);
  await info.attach('live-public-result', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await info.attach('live-diagnostics', { body: Buffer.from(JSON.stringify({ version, result: data }, null, 2)), contentType: 'application/json' });
  console.log('LIVE_TRANSLATION_VERIFIED', JSON.stringify({ source: data.regions[0].source, translation: data.regions[0].translation, commit: version.commit, url: page.url() }));
});

test('LIVE real Arabic translation is not a mocked result', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const { translateText } = await import('./translate.mjs'); return translateText('你好', 'ar', { provider: 'mymemory' });
  });
  expect(result).toMatch(/[\u0600-\u06ff]/);
  console.log('LIVE_ARABIC_VERIFIED', result);
});
