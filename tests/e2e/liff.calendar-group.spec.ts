// ============================================================
//  liff.calendar-group.spec.ts （dev モード）
//  予定管理カレンダーをグループで絞り込む
//  seed: Worker 01 のみのグループ（global-setup: SCHED_GROUP_NAME）
// ============================================================
import { test, expect } from '@playwright/test'
import { SCHED_GROUP_NAME, SEED_WORKER } from './global-setup'

test.describe('予定管理 グループ絞り込み', () => {
  test('AC: グループ選択でメンバー列のみ／全員に戻せる／選択が記憶される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    const headers = page.locator('th.worker-header')
    const allCount = await headers.count()
    expect(allCount, '初期は全作業員列（複数）').toBeGreaterThan(1)

    // AC1: グループ選択ドロップダウンがあり初期は全員
    const select = page.locator('select.group-select')
    await expect(select).toBeVisible()

    // AC2: グループを選ぶとメンバー（Worker 01）の列だけ
    await select.selectOption({ label: SCHED_GROUP_NAME })
    await expect(headers).toHaveCount(1)
    await expect(headers.first()).toContainText(SEED_WORKER)

    // AC3: 全員に戻すと全列に戻る
    await select.selectOption({ label: '全員' })
    await expect(headers).toHaveCount(allCount)

    // AC4: グループ選択 → リロードで選択が復元される（localStorage）
    await select.selectOption({ label: SCHED_GROUP_NAME })
    await expect(headers).toHaveCount(1)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })
    await expect(page.locator('th.worker-header')).toHaveCount(1)
  })
})
