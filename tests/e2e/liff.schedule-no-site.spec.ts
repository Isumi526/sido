// ============================================================
//  liff.schedule-no-site.spec.ts （dev モード）
//  予定を現場に紐づけず、自由タイトルで登録できる（緊急：プライベート予定対応）
//   - 「現場なし（タイトルを入力）」を選び、自由タイトルで保存できる
//   - site_id は紐付かない（現場別集計に混入しない）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

test.describe('予定 現場なし（自由タイトル）', () => {
  const TITLE = `E2E私用_${Date.now()}`

  test.afterAll(async () => {
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('現場なしを選び自由タイトルで保存 → site_id 無しで作成される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.cell-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()

    // 現場なしを選択 → 自由タイトル入力欄が出る
    // de77561で「現場なし」はプルダウンの__none__選択肢から独立トグル(.no-site-toggle)に変更済み
    await page.locator('.no-site-toggle input[type="checkbox"]').check()
    const titleInput = page.locator('input[placeholder="例：休暇 / 出張 / 私用"]')
    await expect(titleInput).toBeVisible()
    await titleInput.fill(TITLE)

    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

    // DB: 自由タイトルで作成され、site_id は紐付かない
    const rows = await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}&select=worker_id,site_id,title`)
    expect(rows.length, '予定が作成される').toBeGreaterThanOrEqual(1)
    expect(rows[0].title).toBe(TITLE)
    expect(rows[0].site_id, '現場紐付けなし').toBeNull()
  })
})
