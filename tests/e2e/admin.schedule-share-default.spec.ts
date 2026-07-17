// ============================================================
//  admin.schedule-share-default.spec.ts
//  方針C: 予定追加で「自分以外のユーザー」を対象にすると共有トグル(is_public)が既定ON。
//  admin の e2e ユーザーは workers 行を持たない(currentWorkerId=null)ため、
//  選択した作業員は常に「自分以外」＝既定ON になる（この性質を使って決定論的に検証）。
//  さらに、ユーザーが手動でトグルを操作したら以降は自動更新しない（尊重する）ことも確認する。
// ============================================================
import { test, expect } from '@playwright/test'

test.describe('予定管理(admin) 共有トグルの既定値（方針C）', () => {
  test('自分以外の作業員を選ぶと共有トグルが既定ON・手動操作後は尊重される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    // まっさらな追加モーダル（対象未選択）から開始
    await page.locator('.btn-add').click()
    await expect(page.locator('.worker-chips')).toBeVisible()

    const shareToggle = page.locator('label.checkbox-label', { hasText: '他のユーザーに共有' })
      .locator('input[type="checkbox"]')

    // 対象未選択（自分以外がいない）→ 既定OFF
    await expect(shareToggle).not.toBeChecked()

    // Worker 01（=自分以外）を選択 → 既定ONになる
    const chip01 = page.locator('.worker-chip', { hasText: 'Worker 01' })
    if (!((await chip01.getAttribute('class')) ?? '').includes('on')) await chip01.click()
    await expect(shareToggle).toBeChecked()

    // ユーザーが手動でOFFにする → 以降は自動更新しない（尊重）
    await shareToggle.uncheck()
    await expect(shareToggle).not.toBeChecked()
    // さらに別の作業員を追加しても、手動OFFが維持される
    const chip02 = page.locator('.worker-chip', { hasText: 'Worker 02' })
    if (!((await chip02.getAttribute('class')) ?? '').includes('on')) await chip02.click()
    await expect(shareToggle).not.toBeChecked()
  })
})
