// 本番スモーク専用（demoテナントのアカウントで本番URLを叩く）
import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/prod',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'https://sido-liff.vercel.app',
    // iPhone SE 相当（一番狭い端末で崩れないことも同時に見る）
    viewport: { width: 375, height: 667 },
    geolocation: { latitude: 35.6812, longitude: 139.7671 },
    permissions: ['geolocation'],
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'prod', use: { ...devices['Desktop Chrome'] } }],
})
