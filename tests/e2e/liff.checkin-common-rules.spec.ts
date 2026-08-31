// ============================================================
//  liff.checkin-common-rules.spec.ts
//  打刻画面に出る確認ルールがアカウント共通になった（2026-08-27 出退勤モデル変更）。
//   - 現場を選ばずに /checkin を開いても共通ルールが出る
//   - 出勤時・退勤時それぞれの timing 分だけ出る
//   - 同意した文面が打刻に記録される（証跡のスナップショット）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, passWorkStatusGate } from './helpers'

const TS = Date.now()
const RULE_BOTH = `E2E共通_両方_${TS}`
const RULE_IN   = `E2E共通_出勤のみ_${TS}`
const RULE_OUT  = `E2E共通_退勤のみ_${TS}`

let accountId = ''
let workerId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = (await rest('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
  await restSrv('account_attendance_rules', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([
    { account_id: accountId, content: RULE_BOTH, timing: 'both',     sort_order: 0 },
    { account_id: accountId, content: RULE_IN,   timing: 'checkin',  sort_order: 1 },
    { account_id: accountId, content: RULE_OUT,  timing: 'checkout', sort_order: 2 },
  ]) })
})

test.afterAll(async () => {
  for (const c of [RULE_BOTH, RULE_IN, RULE_OUT]) {
    await restSrv(`account_attendance_rules?content=eq.${encodeURIComponent(c)}`, { method: 'DELETE' }).catch(() => {})
  }
  // ★全期間を消さない。global-setup が積んだ当月のFEAT_ATT打刻まで巻き込み、
  //  admin.attendance-on-card 等が一括実行時だけ落ちる（2026-08-27 に踏んだ）。
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(
    new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())}`, { method: 'DELETE' }).catch(() => {})
})

async function clearRecentPunches() {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(since)}`,
    { method: 'DELETE' }).catch(() => {})
}

test('出勤時は「両方」と「出勤のみ」が出て、「退勤のみ」は出ない', async ({ page }) => {
  await clearRecentPunches()
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  const list = page.locator('.rules-list')
  await expect(list).toContainText(RULE_BOTH, { timeout: 15000 })
  await expect(list).toContainText(RULE_IN)
  await expect(list).not.toContainText(RULE_OUT)
})

test('退勤時は「両方」と「退勤のみ」が出て、「出勤のみ」は出ない', async ({ page }) => {
  await clearRecentPunches()
  await restSrv('attendance_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    worker_id: workerId, type: 'checkin', agreed_rule_texts: [],
  }) })
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  const list = page.locator('.rules-list')
  await expect(list).toContainText(RULE_BOTH, { timeout: 15000 })
  await expect(list).toContainText(RULE_OUT)
  await expect(list).not.toContainText(RULE_IN)
})

test('★同意した文面が打刻に記録される（あとから証跡として読める）', async ({ page }) => {
  await clearRecentPunches()
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  await expect(page.locator('.rules-list')).toContainText(RULE_BOTH, { timeout: 15000 })

  // 全ルールにチェック → 位置情報を試行 → 送信
  const rows = page.locator('.rule-row')
  const n = await rows.count()
  for (let i = 0; i < n; i++) await rows.nth(i).click()
  await page.locator('.loc-get').first().click()
  const submit = page.getByRole('button', { name: '出勤を記録する' }).last()
  await expect(submit).toBeEnabled({ timeout: 20000 })
  await submit.click()

  // ★「1件でもあるか」ではなく「同意した文面が入った行が現れるか」をポーリングする。
  //  前者だと送信完了前に別テストが残した agreed_rule_texts:[] の行を拾って落ちる。
  const query = `attendance_logs?worker_id=eq.${workerId}&type=eq.checkin` +
    `&order=checked_at.desc&limit=1&select=agreed_rule_texts,site_id`
  await expect.poll(async () => {
    const log = (await restSrv(query))[0]
    return (log?.agreed_rule_texts ?? []) as string[]
  }, { timeout: 20000, message: '同意した共通ルールの文面が残る' }).toContain(RULE_BOTH)

  const log = (await restSrv(query))[0]
  expect(log.agreed_rule_texts).toContain(RULE_IN)
  expect(log.site_id, '★現場には紐づかない（1日=出勤/退勤の2回）').toBeNull()
})
