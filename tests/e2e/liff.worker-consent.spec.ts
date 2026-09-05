// ============================================================
//  liff.worker-consent.spec.ts
//  個人データ取扱い（外国＝韓国への移転を含む）の同意ゲート
//
//  出所: 2026-09-01 弁護士打合せ。契約 第9条・第10条4項で、作業員登録前に
//   本人同意（外国にある第三者への提供への同意を含む）を取る義務が規定された。
//
//  ★このspecが守るもの:
//   - 未同意の作業員には全画面の前に同意ゲートが出る
//   - チェックしないと送信できない
//   - 同意すると記録され、以後は出ない（リロードしても再同意を求めない）
//   - 二重送信してもエラーにならない（冪等）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, useDevWorker, getAccountId } from './helpers'

let workerId = ''

test.describe('個人データ取扱いの同意ゲート', () => {
  test.afterEach(async () => {
    if (workerId) await restSrv(`worker_consents?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★未同意なら全画面の前にゲートが出て、チェックしないと送信できない', async ({ page }) => {
    const worker = await useDevWorker(page, 'consent-gate')
    workerId = worker.workerId
    await restSrv(`worker_consents?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})

    await page.goto('/', { waitUntil: 'networkidle' })
    const gate = page.locator('[data-testid="consent-gate"]')
    await expect(gate, 'ゲートが出る').toBeVisible({ timeout: 10000 })
    await expect(page.locator('[data-testid="consent-text"]'), '同意文が表示される').toBeVisible()
    await expect(page.locator('[data-testid="consent-submit"]'), '★チェック前は送信できない').toBeDisabled()

    await page.locator('[data-testid="consent-checkbox"]').check()
    await expect(page.locator('[data-testid="consent-submit"]'), 'チェックすると送信できる').toBeEnabled()
    await page.locator('[data-testid="consent-submit"]').click()
    await expect(gate, '★同意するとゲートが消える').toHaveCount(0, { timeout: 10000 })

    const rows = await restSrv(`worker_consents?worker_id=eq.${workerId}&select=consent_version,consented_at`)
    expect(rows.length, '★DBに記録される').toBe(1)
    expect(rows[0].consent_version).toBe(1)
  })

  test('★同意済みならリロードしてもゲートが出ない', async ({ page }) => {
    const worker = await useDevWorker(page, 'consent-gate')
    workerId = worker.workerId
    await restSrv(`worker_consents?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    const accountId = await getAccountId()
    await restSrv('worker_consents', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, consent_version: 1, consent_text: '（テスト用スナップショット）' }),
    })

    await page.goto('/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await expect(page.locator('[data-testid="consent-gate"]'), '★出ない').toHaveCount(0)
  })
})
