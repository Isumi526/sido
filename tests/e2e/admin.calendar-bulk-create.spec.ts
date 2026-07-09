// ============================================================
//  admin.calendar-bulk-create.spec.ts
//  予定管理カレンダー（admin）で複数作業員を選んで一括作成する。
//  liff.calendar-multi.spec.ts の admin 版（#予定管理共通化）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

test.describe('予定管理(admin) 複数作業員に一括追加', () => {
  const TITLE = `E2E複数admin_${Date.now()}`

  test.afterAll(async () => {
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('複数の作業員を選んで保存すると、それぞれに予定が作成される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    // ヘッダーの「＋ 予定を追加」から開く（対象作業員は未選択の状態で始まる。
    // セルクリックだと共有ローカルDBに蓄積した他E2Eの作業員データ次第でどの列が
    // 最初に来るか一定しないため、意図的に「まっさら」なモーダルから始める）
    await page.locator('.btn-add').click()
    await expect(page.locator('.worker-chips')).toBeVisible()

    // Worker 01・Worker 02 を選択状態にする（チップはトグル）
    for (const name of ['Worker 01', 'Worker 02']) {
      const chip = page.locator('.worker-chip', { hasText: name })
      const cls = (await chip.getAttribute('class')) ?? ''
      if (!cls.includes('on')) await chip.click()
    }

    await page.getByPlaceholder('例：アルペン現場').fill(TITLE)

    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 }) // モーダル閉じる

    // DBに2件（別worker_id）作成されている
    const rows = await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}&select=worker_id`)
    const workerIds = new Set((rows ?? []).map((r: any) => r.worker_id))
    expect(rows.length, '2作業員分の予定が作成される').toBe(2)
    expect(workerIds.size, '別々の作業員').toBe(2)
  })
})
