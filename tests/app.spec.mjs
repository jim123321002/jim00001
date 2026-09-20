import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fixture, upload, diagnostics, mockTranslation, run, setManual, addManual } from './helpers.mjs';

test.beforeEach(async ({ page }) => { await page.goto('./'); await expect(page).toHaveTitle(/译图/); });

test('responsive empty state, help and no horizontal page overflow', async ({ page }, info) => {
  await expect(page.locator('#start')).toBeDisabled(); await expect(page.locator('#download')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('#help').click(); await expect(page.locator('#help-dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭说明' }).click();
  await info.attach('empty-workspace', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('rejects invalid files and oversized uploads without corrupting queue', async ({ page }) => {
  await page.locator('#files').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg><script>alert(1)</script></svg>') });
  await expect(page.locator('#notice')).toContainText('不支持'); await expect(page.locator('#queue-count')).toHaveText('0');
  await page.locator('#files').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(16 * 1024 * 1024) });
  await expect(page.locator('#notice')).toContainText('超过 15 MB'); await expect(page.locator('#queue-count')).toHaveText('0');
  await upload(page, []); await expect(page.locator('#queue-count')).toHaveText('1');
});

test('real Chinese OCR, mocked provider contract, batch PNG and ZIP exports', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await mockTranslation(page);
  const one = await fixture(page, ['安全第一', '请佩戴安全帽'], '一.png'), two = await fixture(page, ['安全第一'], '二.png');
  await page.locator('#files').setInputFiles([one, two]); await expect(page.locator('#queue-count')).toHaveText('2');
  await run(page);
  const data = await diagnostics(page); expect(data).toHaveLength(2);
  for (const item of data) {
    expect(item.exportable, JSON.stringify(item)).toBe(true); expect(item.regions.length).toBeGreaterThan(0);
    expect(item.regions.some(r => r.source.includes('安全'))).toBe(true);
    for (const r of item.regions) { expect(r.translation).toBeTruthy(); expect(r.size).toBeGreaterThanOrEqual(8); expect(r.box.x).toBeGreaterThanOrEqual(0); expect(r.box.y).toBeGreaterThanOrEqual(0); expect(r.box.x + r.box.w).toBeLessThanOrEqual(item.width + 0.01); expect(r.box.y + r.box.h).toBeLessThanOrEqual(item.height + 0.01); }
  }
  const pngEvent = page.waitForEvent('download'); await page.locator('#download').click(); const png = await pngEvent;
  const buffer = await readFile(await png.path()); expect(buffer.subarray(1, 4).toString()).toBe('PNG'); expect(buffer.readUInt32BE(16)).toBe(900); expect(buffer.readUInt32BE(20)).toBe(500);
  const zipEvent = page.waitForEvent('download'); await page.locator('#download-all').click(); const zip = await zipEvent;
  const names = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))', await zip.path()], { encoding: 'utf8' }));
  expect(names).toHaveLength(2); expect(names.every(n => n.endsWith('-en.png'))).toBe(true);
  expect(errors).toEqual([]);
  await info.attach('translated-workspace', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await info.attach('exported-image', { body: buffer, contentType: 'image/png' });
});

test('free-service quota error is visible and retry recovers without reupload', async ({ page }) => {
  await mockTranslation(page, () => ({ responseStatus: 429, quotaFinished: true })); await upload(page, ['安全第一']); await run(page);
  await expect(page.locator('#download')).toBeDisabled(); await expect(page.locator('#notice')).toContainText('额度');
  await page.unroute('https://api.mymemory.translated.net/get?**'); await mockTranslation(page); await run(page);
  await expect(page.locator('#download')).toBeEnabled(); expect((await diagnostics(page))[0].exportable).toBe(true);
});

test('manual correction, auto font sizing, bounds clamping and clean export', async ({ page }) => {
  await setManual(page); await upload(page, []); await addManual(page, 'Image translation keeps every word inside the box.');
  for (const [key, value] of [['x', '50'], ['y', '40'], ['w', '700'], ['h', '150']]) { await page.locator(`#box-${key}`).fill(value); await page.locator(`#box-${key}`).press('Tab'); }
  await page.locator('#font-size').fill('90'); await page.locator('#alignment').selectOption('center');
  await expect(page.locator('#download')).toBeEnabled();
  const before = (await diagnostics(page))[0].regions[0]; expect(before.size).toBeLessThanOrEqual(90);
  const pixels = await page.evaluate(() => {
    const c = document.querySelector('#result-wrap canvas'), ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, maxX = -1, minY = c.height, maxY = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] < 150 && d[i + 1] < 150 && d[i + 2] < 150) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
    return { minX, maxX, minY, maxY };
  });
  expect(pixels.minX).toBeGreaterThanOrEqual(50); expect(pixels.maxX).toBeLessThan(750); expect(pixels.minY).toBeGreaterThanOrEqual(40); expect(pixels.maxY).toBeLessThan(190);
  await page.locator('#box-x').fill('99999'); await page.locator('#box-x').press('Tab');
  expect((await diagnostics(page))[0].regions[0].box.x).toBe(899); await expect(page.locator('#download')).toBeDisabled();
});

test('too-small type is blocked, shortening translation restores export', async ({ page }) => {
  await setManual(page); await upload(page, []); await addManual(page, 'long text '.repeat(800));
  await expect(page.locator('#download')).toBeDisabled(); await expect(page.locator('#region-warning')).toBeVisible();
  await page.locator('#translated-text').fill('Hello'); await expect(page.locator('#download')).toBeEnabled();
});

test('overlapping text boxes are blocked and can be repaired', async ({ page }) => {
  await setManual(page); await upload(page, []); await addManual(page, 'First'); await addManual(page, 'Second');
  await expect(page.locator('#download')).toBeDisabled(); await expect(page.locator('#region-warning')).toContainText('重叠');
  await page.locator('#box-y').fill('20'); await page.locator('#box-y').press('Tab'); await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#delete-region').click(); expect((await diagnostics(page))[0].regions).toHaveLength(1);
});

test('Arabic uses RTL rendering and stays in bounds', async ({ page }, info) => {
  await setManual(page); await page.locator('#language').selectOption('ar'); await upload(page, []); await addManual(page, 'مرحبا بالعالم');
  await expect(page.locator('#translated-text')).toHaveAttribute('dir', 'rtl'); await expect(page.locator('#download')).toBeEnabled();
  expect((await diagnostics(page))[0].language).toBe('ar');
  await info.attach('arabic-layout', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});

test('custom API routes only text to chosen host and never stores credentials', async ({ page }) => {
  const requests = [];
  await page.route('https://translator.example.test/v1/chat/completions', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    requests.push(route.request().postDataJSON()); await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'Safety first' } }] }) });
  });
  await page.locator('#settings').click(); await page.locator('#provider').selectOption('custom'); await page.locator('#endpoint').fill('https://translator.example.test/v1'); await page.locator('#model').fill('test-model'); await page.locator('#api-key').fill('test-only-not-a-real-secret'); await page.locator('#save-settings').click();
  await upload(page, []); await page.locator('#add-region').click(); await page.locator('#source-text').fill('安全第一'); await page.locator('#translate-region').click();
  await expect(page.locator('#download')).toBeEnabled(); expect(requests).toHaveLength(1); expect(requests[0].messages[1].content).toBe('安全第一'); expect(JSON.stringify(requests[0])).not.toContain('base64');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('test-only-not-a-real-secret');
});

test('translation text is inert, not injected HTML', async ({ page }) => {
  await setManual(page); await upload(page, []); await addManual(page, '<img src=x onerror="window.compromised=true">');
  expect(await page.locator('img[src="x"]').count()).toBe(0); expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  await page.locator('#clear').click(); await expect(page.locator('#empty')).toBeVisible(); await expect(page.locator('#queue-count')).toHaveText('0'); await expect(page.locator('#download')).toBeDisabled();
});

test('cancel during translation retains work and permits continued editing', async ({ page }) => {
  await page.route('https://api.mymemory.translated.net/get?**', async route => { await new Promise(resolve => setTimeout(resolve, 5000)); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'Safety first' } }) }).catch(() => {}); });
  await upload(page, ['安全第一']); await page.locator('#start').click(); await expect(page.locator('#progress-label')).toContainText('翻译区域', { timeout: 90000 }); await page.locator('#cancel').click();
  await expect(page.locator('#start')).toBeEnabled(); await expect(page.locator('#notice')).toContainText('已停止'); await expect(page.locator('#queue-count')).toHaveText('1');
});

test('changing language regenerates translations and labels output correctly', async ({ page }) => {
  await mockTranslation(page); await upload(page, ['安全第一']); await run(page); await expect(page.locator('#result-language')).toHaveText('英语');
  await page.locator('#language').selectOption('vi'); await run(page); await expect(page.locator('#result-language')).toHaveText('越南语');
  const d = (await diagnostics(page))[0]; expect(d.language).toBe('vi'); expect(d.regions[0].translation).toBe('An toàn là trên hết'); expect(d.exportable).toBe(true);
});
