import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',
  timeout:30000,
  workers:1,
  use:{trace:'retain-on-failure'},
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome']}},
    {name:'mobile',use:{...devices['Pixel 7']}}
  ],
  webServer:{command:'python3 -m http.server 4173 --directory ..',url:'http://127.0.0.1:4173/number-music/',reuseExistingServer:false,timeout:15000}
});