// ============================================================
//  admin.calendar-categories.spec.ts
//  予定管理カレンダー（admin）のカテゴリ管理モーダル（作成/編集/並び替え）。
//  カレンダーページから離脱せずカテゴリCRUDができることを検証する（#予定管理共通化）。
//  編集した既存カテゴリ名はテスト後に元へ戻す（マスタを汚さない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

test.describe('予定管理(admin) カテゴリ管理モーダル', () => {
  const SUFFIX = ` E2E${Date.now()}`
  let categoryId: string | null = null
  let originalLabel = ''

  test.afterAll(async () => {
    if (categoryId && originalLabel) {
      await rest(`schedule_categories?id=eq.${categoryId}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ label: originalLabel }),
      }).catch(() => {})
    }
  })

  test('カテゴリ名を編集するとカレンダーに反映され、リロード後も保持される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.btn-cat-settings').click()
    await expect(page.locator('.cat-manage-modal')).toBeVisible()

    const firstRow = page.locator('.cat-table tbody tr.cat-item').first()
    await expect(firstRow).toBeVisible()
    const originalName = (await firstRow.locator('.name').innerText()).trim()
    originalLabel = originalName
    const newName = originalName + SUFFIX

    await firstRow.locator('.btn-edit-sm').click()
    const nameInput = page.locator('.modal input.input').first()
    await expect(nameInput).toBeVisible()
    await nameInput.fill(newName)
    await page.locator('.btn-save').click()

    // サブモーダルが閉じ、一覧に反映される
    await expect(page.locator('.cat-table')).toContainText(newName, { timeout: 10000 })

    // afterAll で元に戻すため id を控える
    const rows = await rest(`schedule_categories?label=eq.${encodeURIComponent(newName)}&select=id`)
    categoryId = rows?.[0]?.id ?? null
    expect(categoryId, '編集したカテゴリがDBに反映されている').toBeTruthy()

    await page.locator('.cat-manage-modal .btn-cancel').click()
    await expect(page.locator('.cat-manage-modal')).toHaveCount(0)

    // リロード後も保持される（モーダルを開き直して確認）
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })
    await page.locator('.btn-cat-settings').click()
    await expect(page.locator('.cat-table')).toContainText(newName, { timeout: 10000 })
  })
})
