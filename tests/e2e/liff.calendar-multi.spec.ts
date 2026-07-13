// ============================================================
//  liff.calendar-multi.spec.ts （dev モード）
//  予定追加を複数作業員に同時作成（個人複数選択）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

test.describe('予定 複数作業員に一括追加', () => {
  const TITLE = `E2E複数_${Date.now()}`

  test.afterAll(async () => {
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('複数の作業員を選んで保存すると、それぞれに予定が作成される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    // セルの＋から追加モーダルを開く
    await page.locator('.cell-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()

    // Worker 01・Worker 02 を選択状態にする（チップはトグル）
    for (const name of ['Worker 01', 'Worker 02']) {
      const chip = page.locator('.worker-chip', { hasText: name })
      const cls = (await chip.getAttribute('class')) ?? ''
      if (!cls.includes('on')) await chip.click()
    }

    // 現場は新規(__other__)でユニークタイトルを入れる（検証・後始末を容易に）
    // .site-select は元請け/現場/カテゴリの3つのselectで共有されるスタイル用classのため
    // data-testid で現場selectを明示的に指定する
    await page.locator('select[data-testid="site-select"]').selectOption('__other__')
    await page.locator('input[placeholder="現場名を入力"]').fill(TITLE)

    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 }) // モーダル閉じる

    // DBに2件（別worker_id）作成されている
    const rows = await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}&select=worker_id`)
    const workerIds = new Set((rows ?? []).map((r: any) => r.worker_id))
    expect(rows.length, '2作業員分の予定が作成される').toBe(2)
    expect(workerIds.size, '別々の作業員').toBe(2)
  })
})
