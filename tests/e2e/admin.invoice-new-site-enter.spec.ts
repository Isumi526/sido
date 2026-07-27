// ============================================================
//  admin.invoice-new-site-enter.spec.ts
//  下請け請求書の「＋新規現場…」入力で、Enterで途中確定されないこと。
//
//  背景（2026-07-22 打ち合わせ）:
//   `@keyup.enter="addSite(it)"` だったため、日本語入力の**変換確定Enter**でも発火し、
//   「西尾張デポ」と打っている途中の「西尾張」が現場マスタに登録されてしまっていた。
//   確定は「追加」ボタンのみに変更。
//  Notion: 3a50ff81c56b817e9392c078242d5806
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const PARTIAL = 'E2E西尾張'          // 変換途中で確定してしまっていた文字列
const FULL    = 'E2E西尾張デポ'      // 本当に登録したい文字列

async function cleanup() {
  const accountId = await getAccountId()
  for (const name of [PARTIAL, FULL]) {
    const rows = await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id`)
    for (const r of (rows ?? [])) await restSrv(`sites?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
  }
}
test.beforeAll(cleanup)
test.afterAll(cleanup)

test('AC: 入力途中のEnterでは現場が登録されず、「追加」ボタンで確定できる', async ({ page }) => {
  const accountId = await getAccountId()
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })

  // 請求書の新規登録フォームを開く
  await page.getByRole('button', { name: /＋ 新規請求/ }).first().click()
  await page.waitForTimeout(1200)

  // 明細は初期状態では0行なので1行追加する
  await page.getByRole('button', { name: /行を追加/ }).first().click()
  await page.waitForTimeout(800)

  // 明細の現場セレクトで「＋ 新規現場…」を選ぶ
  const siteSelect = page.locator('select.inp-site').first()
  await expect(siteSelect).toBeVisible({ timeout: 15000 })
  await siteSelect.selectOption('__new__')

  const input = page.getByTestId('new-site-name').first()
  await expect(input).toBeVisible({ timeout: 10000 })

  // ★ 変換途中まで入力してEnter（IMEの変換確定Enter相当）→ 登録されてはいけない
  await input.fill(PARTIAL)
  await input.press('Enter')
  await page.waitForTimeout(1500)
  const leaked = await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PARTIAL)}&select=id`)
  expect(leaked?.length ?? 0, `Enterで途中の「${PARTIAL}」が登録されてはいけない`).toBe(0)
  // 入力欄は開いたまま（確定されずに続けて入力できる）
  await expect(input).toBeVisible()

  // 続きを入力して「追加」ボタンで確定 → 登録される
  await input.fill(FULL)
  await page.getByTestId('new-site-add').first().click()
  await expect.poll(
    async () => (await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(FULL)}&select=id`))?.length ?? 0,
    { timeout: 15000 },
  ).toBe(1)
})
