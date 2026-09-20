import { expect } from '@playwright/test';
export async function fixture(page, texts = ['安全第一', '请佩戴安全帽'], name = '测试图片.png') {
  const base64 = await page.evaluate(async texts => {
    await document.fonts.ready;
    const c = document.createElement('canvas'); c.width = 900; c.height = 500;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 900, 500);
    ctx.fillStyle = '#111111'; ctx.font = '500 52px "Noto Sans CJK SC", sans-serif';
    texts.forEach((t, i) => ctx.fillText(t, 50, 120 + 130 * i));
    return c.toDataURL('image/png').split(',')[1];
  }, texts);
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}
export async function upload(page, texts, name) {
  const file = await fixture(page, texts, name); await page.locator('#files').setInputFiles(file);
  await expect(page.locator('#preview-content')).toBeVisible(); return file;
}
export async function diagnostics(page) { return page.evaluate(async () => (await import('./app.mjs')).inspect()); }
export async function mockTranslation(page, handler) {
  await page.route('https://api.mymemory.translated.net/get?**', async route => {
    const url = new URL(route.request().url());
    const text = url.searchParams.get('q'), target = url.searchParams.get('langpair').split('|')[1];
    const result = handler ? handler(text, target) : target === 'ar' ? 'السلامة أولا' : target === 'vi' ? 'An toàn là trên hết' : /帽/.test(text) ? 'Please wear a safety helmet' : 'Safety first';
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(typeof result === 'object' ? result : { responseStatus: 200, responseData: { translatedText: result } }) });
  });
}
export async function run(page) {
  await page.locator('#start').click(); await expect(page.locator('#start')).toBeEnabled({ timeout: 120000 });
}
export async function setManual(page) {
  await page.locator('#settings').click(); await page.locator('#provider').selectOption('manual'); await page.locator('#save-settings').click();
}
export async function addManual(page, text = 'Safety first') {
  await page.locator('#add-region').click(); await page.locator('#translated-text').fill(text);
  await expect.poll(async () => (await diagnostics(page))[0].regions.at(-1)?.translation).toBe(text);
  await page.waitForTimeout(200);
}
