// ============================================================
//  liff.checkin-one-tap.spec.ts
//  出退勤をボタン1つにする（2026-10-02 シード要望17・設計「入力の手間を減らす」I-2）。
//
//  ★守ること:
//   1. 「現在地を取得」ボタンは無い。「出勤を記録する」を1回押すと、位置を取ってそのまま記録する
//   2. 位置が取れない時は理由の欄が出る。理由を書くまで押せない。書けば記録でき、理由が残る（承認はなし＝確認事項4=A）
//   3. 位置が取れた打刻には理由を残さない
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, passWorkStatusGate } from './helpers'

let workerId = ''

test.beforeAll(async () => {
  workerId = (await rest('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
})

async function clearRecentPunches() {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(since)}`,
    { method: 'DELETE' }).catch(() => {})
}
test.afterEach(clearRecentPunches)

const latestCheckin = async () => (await restSrv(
  `attendance_logs?worker_id=eq.${workerId}&type=eq.checkin&order=checked_at.desc&limit=1` +
  `&select=location_lat,location_lng,location_missing_reason,checked_at`))[0]

/** 打刻画面を開いて確認事項（あれば）を全部チェックする */
async function openAndCheckRules(page: import('@playwright/test').Page) {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  await page.waitForSelector('.rule-row, [data-testid="punch-submit"]', { timeout: 20000 })
  const rows = page.locator('.rule-row')
  for (let i = 0, n = await rows.count(); i < n; i++) await rows.nth(i).click()
}

test.describe('位置が取れる端末', () => {
  test.use({ geolocation: { latitude: 35.6812, longitude: 139.7671 }, permissions: ['geolocation'] })

  test('★「出勤を記録する」を1回押すだけで、位置ごと記録される', async ({ page }) => {
    await clearRecentPunches()
    const since = new Date().toISOString()
    await openAndCheckRules(page)
    await expect(page.locator('.loc-get'), '「現在地を取得」ボタンは無い').toHaveCount(0)
    await expect(page.getByTestId('location-step')).toHaveCount(0)

    await page.getByTestId('punch-submit').click()
    await expect.poll(async () => (await latestCheckin())?.checked_at >= since, { timeout: 20000 }).toBe(true)
    const log = await latestCheckin()
    expect(Math.round(log.location_lat * 1000), '位置が残る').toBe(35681)
    expect(Math.round(log.location_lng * 1000)).toBe(139767)
    expect(log.location_missing_reason, '位置が取れた打刻に理由は残さない').toBeNull()
    await expect(page.getByTestId('loc-reason')).toHaveCount(0)
  })
})

test.describe('位置が取れない端末（許可していない）', () => {
  test('★理由の欄が出て、書くまで押せない。書けば記録でき、理由が残る', async ({ page }) => {
    await clearRecentPunches()
    const since = new Date().toISOString()
    await openAndCheckRules(page)
    await page.getByTestId('punch-submit').click()

    await expect(page.getByTestId('loc-reason'), '位置が取れないと理由の欄が出る').toBeVisible({ timeout: 15000 })
    const btn = page.getByTestId('punch-submit')
    await expect(btn).toHaveText('理由を書いて出勤を記録する')
    await expect(btn, '理由が空のうちは押せない').toBeDisabled()
    expect((await latestCheckin())?.checked_at >= since, 'まだ記録されていない').toBeFalsy()

    await page.getByTestId('loc-reason-input').fill('電波が悪い')
    await expect(btn).toBeEnabled()
    await btn.click()
    await expect.poll(async () => (await latestCheckin())?.checked_at >= since, { timeout: 20000 }).toBe(true)
    const log = await latestCheckin()
    expect(log.location_lat).toBeNull()
    expect(log.location_missing_reason, '書いた理由が残る').toBe('電波が悪い')
  })
})
