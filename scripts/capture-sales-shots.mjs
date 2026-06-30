// 営業スライド用スクショ取得（ローカル管理画面・保存済みauth再利用）
// 使い方: node scripts/capture-sales-shots.mjs
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'url'
import path from 'path'

const BASE = process.env.ADMIN_URL || 'http://localhost:3001'
const AUTH = 'tests/e2e/.auth/admin-local.json'
const OUT  = 'docs/sales/screenshots'

const SHOTS = [
  { route: '/',                    name: '01-dashboard',      label: 'ダッシュボード' },
  { route: '/process',             name: '02-process',        label: '工程管理（ガント）' },
  { route: '/estimate-list',       name: '03-estimate-list',  label: '見積もり一覧' },
  { route: '/estimate-builder',    name: '04-estimate-builder', label: '見積ビルダー' },
  { route: '/purchase-orders',     name: '05-purchase-orders', label: '注文書発行' },
  { route: '/subcontractor-invoices', name: '06-subcontractor-invoices', label: '協力業者請求' },
  { route: '/site-reports',        name: '07-site-reports',   label: '現場別集計' },
  { route: '/reports',             name: '08-reports',        label: '日報一覧' },
  { route: '/gasoline-allocation', name: '09-gasoline',       label: 'ガソリン按分' },
  { route: '/worker-reports',      name: '10-worker-reports', label: '出面・勤怠' },
  { route: '/workers',             name: '11-workers',        label: '作業員マスタ' },
  { route: '/paid-leave',          name: '12-paid-leave',     label: '有給管理' },
]

const ok = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: AUTH, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
for (const s of SHOTS) {
  try {
    await page.goto(BASE + s.route, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1200) // データ描画待ち
    const file = path.join(OUT, s.name + '.png')
    await page.screenshot({ path: file, fullPage: false })
    ok.push({ ...s, file })
    console.log('✓', s.name, '←', s.route)
  } catch (e) {
    console.log('✗', s.name, '←', s.route, String(e).slice(0, 80))
  }
}
await browser.close()
console.log('\nDONE', ok.length, '/', SHOTS.length)
