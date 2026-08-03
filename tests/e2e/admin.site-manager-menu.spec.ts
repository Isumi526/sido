// ============================================================
//  admin.site-manager-menu.spec.ts
//  現場管理者(site_manager)のメニュー制限（2026-07-30 確定 → 2026-07-31 レビューで範囲拡大）:
//   - サイドバーは現場運営系（日次 ＋ 現場/協力業者マスタ）のみ表示。
//     非表示＝見積・発注 / 経費・請求 / 元請け業者 / 見積マスタ・単価表 / 管理・設定 に加えて、
//     勤怠3画面(出面勤怠・出退勤ログ・有給管理) / 作業員マスタ / 車両、ダッシュボードの月次集計。
//   - URL直打ちも router guard (meta.management) で / へリダイレクト。
//   - admin/office は従来どおり全メニュー表示（挙動不変）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY } from './helpers'

const SM_EMAIL = 'worker01.login.e2e@example.com'  // site_manager の作業員（liff.worker-loginで用意）
const SM_PASS  = 'worker-login-1234'

// 経営系メニューの代表（href で特定。「設定」等のテキストは他メニューと部分一致するため使わない）
const MANAGEMENT_LINKS = [
  '/estimate-list', '/purchase-orders', '/expenses', '/subcontractor-invoices',
  '/contractors', '/estimate-masters', '/operation-logs', '/settings', '/company-profile',
  // 2026-07-31 追加分（勤怠・作業員・車両）
  '/worker-reports', '/attendance', '/paid-leave', '/workers', '/vehicles',
]
// ★/report-edit-approvals（解錠の許可申請）はメニューから撤去した（2026-08-03・承認の一本化）。
//   代わりに /report-edit-review（内容の承認）が現場運営系に入る。
const SITE_OPS_LINKS   = ['/reports', '/report-edit-review', '/overtime-approvals', '/site-reports', '/calendar', '/process', '/sites', '/subcontractors']

test.describe('site_manager は経営系メニュー非表示＋URL直打ち不可', () => {
  // 作業員アカウントでログインするため、保存済みadmin認証は使わない
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    }).catch(() => {})
  })

  test('サイドバーは現場運営系のみ・経営系ページは / へ戻される', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    for (const href of SITE_OPS_LINKS) {
      await expect(page.locator(`.nav-list a[href="${href}"]`), `${href} は表示されるべき`).toBeVisible()
    }
    for (const href of MANAGEMENT_LINKS) {
      await expect(page.locator(`.nav-list a[href="${href}"]`), `${href} は非表示のはず`).toHaveCount(0)
    }

    // URL直打ちはダッシュボードへリダイレクト（勤怠・作業員・車両も含む）
    for (const path of ['/expenses', '/estimate-list', '/settings', '/workers', '/worker-reports', '/attendance', '/paid-leave', '/vehicles']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page, `${path} は / へ戻されるべき`).toHaveURL(/\/\/[^/]+\/$/)
    }

    // ダッシュボードの月次集計（会社全体の売上/原価）は出さない
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.section-title'), '月次集計セクションは無い').toHaveCount(0)
  })

  // ★2026-07-31 レビュー指摘の回帰防止:
  //  見積系の画面を隠しても、現場管理者が到達できる画面から見積書PDF・金額に
  //  辿り着ける抜け道が3つ残っていた（現場別集計のZIP出力に見積書PDFを同梱／
  //  現場マスタ編集モーダルの「この現場の見積書」／現場詳細の見積件数カード）。
  test('現場管理者は到達できる画面から見積書に辿り着けない', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    // 1) 現場別集計の出力ボタンは「CSVを出力」＝見積書PDFを同梱しない
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    const exportBtn = page.getByTestId('export-site')
    if (await exportBtn.count()) {
      await expect(exportBtn, '見積書PDFは同梱しない').toHaveText(/CSVを出力/)
      await expect(exportBtn).not.toHaveText(/見積書PDF/)
    }

    // 2) 現場マスタの編集モーダルに「この現場の見積書」を出さない
    await page.goto('/sites', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 10000 })
    await page.locator('.btn-edit').first().click()
    await expect(page.getByTestId('site-estimates'), '見積書セクションは無い').toHaveCount(0)
    await expect(page.getByText('この現場の見積書'), '見積書の見出しも無い').toHaveCount(0)
  })
})

test.describe('admin は従来どおり全メニュー表示', () => {
  test('経営系メニューが見え、経費管理も開ける', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })
    for (const href of [...SITE_OPS_LINKS, ...MANAGEMENT_LINKS]) {
      await expect(page.locator(`.nav-list a[href="${href}"]`), `${href} は表示されるべき`).toBeVisible()
    }
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/expenses$/)
    // ダッシュボードの月次集計は従来どおり見える
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.section-title')).toContainText('月次集計')
  })
})
