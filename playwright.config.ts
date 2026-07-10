import { defineConfig, devices } from '@playwright/test'

// ============================================================
//  Playwright E2E（ローカルスタック向け）
//  前提: supabase ローカルスタック稼働、.env.local がローカル向き、
//        admin dev / liff dev(devモード) が起動済み。
//  既定ポート: admin=3002, liff=3000（env で上書き可）。
//  admin は auth.setup.ts で実ログイン → storageState 再利用。
//  liff は dev モード（dev-user-id）で認証不要。
// ============================================================
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3001'
const LIFF_URL  = process.env.LIFF_URL  || 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,   // 直列・共有DBの一過性フレーク対策
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/.report' }]],
  outputDir: 'tests/e2e/.artifacts',
  timeout: 40_000,
  expect: { timeout: 10_000 },

  projects: [
    {
      name: 'admin-setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: ADMIN_URL },
    },
    {
      name: 'admin',
      testMatch: /admin\..*\.spec\.ts/,
      dependencies: ['admin-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN_URL,
        storageState: 'tests/e2e/.auth/admin-local.json',
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'liff',
      testMatch: /liff\..*\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],       // chromium ベースのモバイル端末
        baseURL: LIFF_URL,
        screenshot: 'only-on-failure',
        // ReportOnboarding.vue（apps/liff/components）は初回訪問で全画面オーバーレイ(.ob-overlay・z-index:1000)
        // を出し、Playwrightは毎テスト新規contextのため localStorage が空＝全testで初回表示になる。
        // オーバーレイは.click()の対象(ボタン等)を覆ってpointer eventsを奪うため、配下のボタンクリックが
        // 40秒タイムアウトするまで気づかれない「visible/enabledなのにclick未完了」の主因になっていた
        // （2026-06-27導入・7/1から報告されていたliff 13スペック分の送信/操作クリック不全の根本原因）。
        // 通常のE2Eは「初見済み」を既定にし、liff.report-onboarding.spec.ts だけが自分でフラグを消して
        // 初回状態を明示的に再現する（このstorageStateとは独立して動作＝非破壊）。
        storageState: {
          cookies: [],
          origins: [{ origin: LIFF_URL, localStorage: [{ name: 'sido_report_onboarded_v1', value: '1' }] }],
        },
      },
    },
  ],
})
