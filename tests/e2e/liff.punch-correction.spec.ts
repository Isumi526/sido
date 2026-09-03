// ============================================================
//  liff.punch-correction.spec.ts
//  作業員が「押し間違えた打刻」の修正を申請する。
//
//  ★背景（2026-09-03 大須賀さん / LINE「出退勤の打刻間違え打った為修正できますか」）:
//   打刻の種別は「直近の最後の打刻」で決まるので、1回押し間違えると後続が全部ずれる。
//   直す手段が無いと、ずれたまま勤怠が積み上がる。
//
//  ★このspecが守るもの:
//   - 自分の直近の打刻が並び、選んで理由付きで申請できる
//   - 申請しただけでは打刻は変わらない（承認して初めて直る）
//   - 同じ打刻に二重申請できない
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, useDevWorker } from './helpers'

let workerId = ''
let logId = ''

test.describe('打刻の修正申請（作業員）', () => {
  test.afterAll(async () => {
    if (logId) await restSrv(`attendance_correction_requests?log_id=eq.${logId}`, { method: 'DELETE' }).catch(() => {})
    if (logId) await restSrv(`attendance_logs?id=eq.${logId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★押し間違えた打刻を選んで修正を申請できる（打刻はまだ変わらない）', async ({ page }) => {
    const worker = await useDevWorker(page, 'punch-fix')
    workerId = worker.workerId
    expect(workerId, 'dev作業員のworker_idが取れる').toBeTruthy()

    // 出勤のつもりで退勤を押してしまった打刻を1件用意する
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
    logId = (await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        worker_id: workerId, type: 'checkout',
        checked_at: new Date(`${day}T08:05:00+09:00`).toISOString(),
        agreed_rule_texts: [], backdated: false,
      }),
    }))[0].id

    await page.goto('/checkin', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="fix-open"]').scrollIntoViewIfNeeded()
    await page.locator('[data-testid="fix-open"]').click()
    await expect(page.locator('[data-testid="fix-panel"]'), '修正申請のパネルが開く').toBeVisible({ timeout: 10000 })

    // 自分の打刻が並ぶ
    const pick = page.locator(`[data-testid="fix-pick-${logId}"]`)
    await expect(pick, '★用意した打刻が一覧に出る').toBeVisible({ timeout: 10000 })
    await pick.check()

    await page.locator('[data-testid="fix-kind"]').selectOption('type')
    await page.locator('[data-testid="fix-type"]').selectOption('checkin')
    await page.locator('[data-testid="fix-reason"]').fill('E2E 出勤のつもりで退勤を押した')
    await page.locator('[data-testid="fix-submit"]').click()
    await expect(page.locator('[data-testid="fix-done"]'), '申請できたと分かる').toBeVisible({ timeout: 15000 })

    // ★申請しただけでは打刻は変わらない（画面の表示だけで完了と判断しない）
    const log = (await restSrv(`attendance_logs?id=eq.${logId}&select=type,original_type`))[0]
    expect(log.type, '★承認前は実際に押された記録のまま').toBe('checkout')
    expect(log.original_type, '元の値もまだ入らない').toBeNull()

    const reqs = await restSrv(`attendance_correction_requests?log_id=eq.${logId}&select=kind,requested_type,status,reason`)
    expect(reqs.length, '★申請が1件できている').toBe(1)
    expect(reqs[0].status).toBe('pending')
    expect(reqs[0].requested_type, '正しい種別が入っている').toBe('checkin')
    expect(reqs[0].reason, '理由が入っている').toContain('E2E')
  })

  test('★同じ打刻に二重申請できない', async ({ page }) => {
    await useDevWorker(page, 'punch-fix')
    await page.goto('/checkin', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="fix-open"]').scrollIntoViewIfNeeded()
    await page.locator('[data-testid="fix-open"]').click()
    await expect(page.locator(`[data-testid="fix-pending-${logId}"]`), '★申請中と表示される').toBeVisible({ timeout: 15000 })
    await expect(page.locator(`[data-testid="fix-pick-${logId}"]`), '★選べない（承認する側が困る二重申請を作らせない）').toBeDisabled()
  })
})
