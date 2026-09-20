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
  expect(data.regions[0].translation).not.toMatch(/&#(?:x[\da-f]+|\d+);/i);
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

test('LIVE multi-region product poster retains graphics and exports complete translations', async ({ page }, info) => {
  await page.goto('./'); await page.locator('#sample').click();
  await expect(page.locator('#queue-count')).toHaveText('1'); await run(page);
  const item = (await diagnostics(page))[0];
  expect(item.regions.length, JSON.stringify(item)).toBeGreaterThanOrEqual(5);
  expect(item.exportable, JSON.stringify(item)).toBe(true);
  expect(item.regions.every(r => r.translation.trim() && r.size >= 8)).toBe(true);
  expect(item.width).toBe(1200); expect(item.height).toBe(800);
  const image = await page.evaluate(() => {
    const source = document.querySelector('#original-wrap canvas'), result = document.querySelector('#result-wrap canvas');
    const a = source.getContext('2d').getImageData(790, 300, 320, 280).data;
    const b = result.getContext('2d').getImageData(790, 300, 320, 280).data;
    return { graphicsUnchanged: a.every((v, i) => v === b[i]), png: result.toDataURL('image/png').split(',')[1] };
  });
  expect(image.graphicsUnchanged).toBe(true);
  await info.attach('live-product-poster', { body: Buffer.from(image.png, 'base64'), contentType: 'image/png' });
  await info.attach('live-product-diagnostics', { body: Buffer.from(JSON.stringify(item, null, 2)), contentType: 'application/json' });
  console.log('LIVE_PRODUCT_POSTER_VERIFIED', JSON.stringify(item.regions.map(r => ({ source: r.source, translation: r.translation, size: r.size }))));
});

test('LIVE all 14 advertised target languages return actual translations', async ({ page }, info) => {
  test.setTimeout(240000);
  await page.goto('./');
  const results = await page.evaluate(async () => {
    const { LANGUAGES } = await import('./core.mjs');
    const { translateText } = await import('./translate.mjs');
    const results = [];
    for (const [language] of LANGUAGES) results.push({ language, text: await translateText('安全第一', language, { provider: 'mymemory' }) });
    return results;
  });
  expect(results).toHaveLength(14);
  for (const result of results) { expect(result.text.trim().length).toBeGreaterThan(0); expect(result.text).not.toMatch(/&#(?:x[\da-f]+|\d+);/i); }
  expect(results.find(r => r.language === 'ar').text).toMatch(/[\u0600-\u06ff]/);
  await info.attach('live-target-languages', { body: Buffer.from(JSON.stringify(results, null, 2)), contentType: 'application/json' });
  console.log('LIVE_14_LANGUAGES_VERIFIED', JSON.stringify(results));
});
