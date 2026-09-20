import { defineConfig, devices } from '@playwright/test';
const stage = process.env.TEST_STAGE || 'browser';
export default defineConfig({
  testDir: './tests', timeout: 120000, expect: { timeout: 15000 }, fullyParallel: false, workers: 1, retries: 0,
  reporter: [['list'], ['html', { outputFolder: `_reports/${stage}/html`, open: 'never' }], ['json', { outputFile: `_reports/${stage}/results.json` }]],
  outputDir: `_reports/${stage}/results`,
  use: { baseURL: process.env.LIVE_BASE_URL || 'http://127.0.0.1:8080/image-translator/', trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1080 } } },
    { name: 'android-chromium', testIgnore: /live\.spec\.mjs/, use: { ...devices['Pixel 7'] } }
  ],
  webServer: process.env.LIVE_BASE_URL ? undefined : { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:8080/image-translator/', reuseExistingServer: !process.env.CI, timeout: 20000 }
});
