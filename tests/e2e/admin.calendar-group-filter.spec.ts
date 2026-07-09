// ============================================================
//  admin.calendar-group-filter.spec.ts
//  予定管理カレンダー（admin）をグループで絞り込む。
//  liff.calendar-group.spec.ts と同じ seed（Worker 01 のみのグループ）を使う。
//  #予定管理共通化（admin/LIFF）: admin にグループ絞り込みを移植した回帰spec。
// ============================================================
import { test, expect } from '@playwright/test'
import { SCHED_GROUP_NAME, SEED_WORKER } from './global-setup'

test.describe('予定管理(admin) グループ絞り込み', () => {
  test('グループ選択でメンバー列のみ／全員に戻せる／選択が記憶される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    const headers = page.locator('th.worker-header')
    const allCount = await headers.count()
    expect(allCount, '初期は全作業員列（複数）').toBeGreaterThan(1)

    // グループ選択ドロップダウンがあり初期は全員
    const select = page.locator('select.group-select')
    await expect(select).toBeVisible()

    // グループを選ぶとメンバー（Worker 01）の列だけ
    await select.selectOption({ label: SCHED_GROUP_NAME })
    await expect(headers).toHaveCount(1)
    await expect(headers.first()).toContainText(SEED_WORKER)

    // 全員に戻すと全列に戻る
    await select.selectOption({ label: '全員' })
    await expect(headers).toHaveCount(allCount)

    // グループ選択 → リロードで選択が復元される（localStorage）
    await select.selectOption({ label: SCHED_GROUP_NAME })
    await expect(headers).toHaveCount(1)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })
    await expect(page.locator('th.worker-header')).toHaveCount(1)
  })
})
