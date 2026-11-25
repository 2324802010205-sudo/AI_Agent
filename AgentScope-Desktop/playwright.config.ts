import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  use: {
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1480, height: 960 },
    screenshot: 'only-on-failure',
  },
  reporter: 'list',
  webServer: {
    command: 'npm.cmd run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
