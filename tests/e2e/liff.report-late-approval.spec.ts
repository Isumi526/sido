// ============================================================
//  liff.report-late-approval.spec.ts
//  期限切れ（提出期限=過去3日を過ぎた）の新規日報も内容の承認制にする
//   - ★期限切れの日付で送信しても daily_reports には入らない（＝集計に出ない）
//   - 保留に kind='late_new' で入り、承認して初めて日報になる
//   - 期限内（当日）の送信は今までどおり即座に daily_reports に入る＝回帰なし
//  ★背景: 既存の「過去3日ロック＋許可申請」は"出す許可"の承認で中身を見ていない。
//    遅れて出てくる日報こそ金額を確認したいので、内容の承認を通す。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId, todayJST } from './helpers'

const TS = Date.now()
// LOCK_START_DATE(2026-07-01) 以降かつ 3日より前 ＝ 期限切れ扱いになる日付
const LATE_DATE = '2026-07-15'

test.describe('期限切れの新規日報の承認制（liff）', () => {
  let uid = ''
  let accountId = ''

  test.beforeEach(async () => {
    uid = (await getDevUserId())!
    accountId = await getAccountId()
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${LATE_DATE}`, { method: 'DELETE' }).catch(() => {})
    // ★日付は入力欄ではなく「最も古い未送信日」から自動決定される。
    //   対象日を開かせるため report_start_date をその日に寄せる（1ワーカー実行なので他specと競合しない）。
    const w = await rest(`users?id=eq.${uid}&select=worker_id`)
    const workerId = w?.[0]?.worker_id
    if (workerId) {
      await restSrv(`workers?id=eq.${workerId}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ report_start_date: LATE_DATE }),
      })
      // ★解錠の許可申請は廃止（2026-08-03）。許可を一切入れずに出せることを検証する。
      await restSrv(`report_edit_grants?worker_id=eq.${workerId}&date=eq.${LATE_DATE}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test.afterEach(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${LATE_DATE}`, { method: 'DELETE' }).catch(() => {})
    const w = await rest(`users?id=eq.${uid}&select=worker_id`)
    if (w?.[0]?.worker_id) {
      await restSrv(`report_edit_grants?worker_id=eq.${w[0].worker_id}&date=eq.${LATE_DATE}`, { method: 'DELETE' }).catch(() => {})
      // 他specが依存する既定（global-setup と同じ）へ戻す
      await restSrv(`workers?id=eq.${w[0].worker_id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ report_start_date: '2026-07-31' }),
      }).catch(() => {})
    }
  })

  test('★期限切れの日付は送信しても daily_reports に入らず、保留になる', async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report', { waitUntil: 'networkidle' })
    await expect(page.locator('.date-fixed'), '最も古い未送信日が開く').toContainText('2026-07-15', { timeout: 20000 })

    // 期限切れであることが送信前に伝わる（案内は日付のすぐ下に1つだけ）
    await expect(page.getByTestId('late-notice'), '承認制になると事前に分かる').toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('late-notice'), '同じ話を2回言わない').toHaveCount(1)
    await expect(page.locator('.past-date-notice'), '「過去の未送信日報です」と重ねない').toHaveCount(0)
    // ★解錠の許可申請は廃止＝ロック案内も依頼ボタンも出ない（許可なしでそのまま出せる）
    await expect(page.locator('.locked-notice'), 'ロック案内は出さない').toHaveCount(0)
    await expect(page.getByText('編集の許可を依頼'), '許可依頼の導線は無い').toHaveCount(0)

    // ★遅れた理由は必須。空のままでは送信できない
    await page.locator('select').first().selectOption({ index: 1 }).catch(() => {})
    await page.locator('input[type="checkbox"]').last().check().catch(() => {})
    await expect(page.locator('button[type="submit"].btn-submit'), '理由が空なら押せない').toBeDisabled()
    await page.getByTestId('late-reason').fill('   ')
    await expect(page.locator('button[type="submit"].btn-submit'), '空白だけでも押せない').toBeDisabled()
    await page.getByTestId('late-reason').fill(`E2E遅延理由_${TS}`)
    await expect(page.locator('button[type="submit"].btn-submit'), '理由を入れれば押せる').toBeEnabled()

    await page.locator('button[type="submit"].btn-submit').click()
    await page.waitForTimeout(6000)

    // ★集計・PDFが見る daily_reports には入っていない
    const reps = await rest(`daily_reports?user_id=eq.${uid}&date=eq.${LATE_DATE}&select=id`)
    expect(reps.length, '承認前は日報にならない').toBe(0)

    const pend = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${LATE_DATE}&select=kind,status,reason,report_id`)
    expect(pend.length, '保留に入る').toBe(1)
    expect(pend[0].kind, '期限切れの新規として区別される').toBe('late_new')
    expect(pend[0].status).toBe('pending')
    expect(pend[0].report_id, 'まだ日報が無いので report_id は空').toBeNull()
    expect(pend[0].reason).toContain('E2E遅延理由')
  })

  test('期限内（当日）の送信は今までどおり即座に日報になる（回帰なし）', async ({ page }) => {
    const today = todayJST()
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${today}`, { method: 'DELETE' }).catch(() => {})
    page.on('dialog', (d) => d.accept().catch(() => {}))
    // 当日が最も古い未送信日になるよう寄せる
    const w2 = await rest(`users?id=eq.${uid}&select=worker_id`)
    await restSrv(`workers?id=eq.${w2[0].worker_id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ report_start_date: today }),
    })
    await page.goto('/report', { waitUntil: 'networkidle' })
    await expect(page.locator('.date-fixed')).toContainText(today, { timeout: 20000 })

    await expect(page.getByTestId('late-notice'), '期限内では出さない').toHaveCount(0)
    await expect(page.getByTestId('late-reason')).toHaveCount(0)

    await page.locator('select').first().selectOption({ index: 1 }).catch(() => {})
    await page.locator('input[type="checkbox"]').last().check().catch(() => {})
    await page.locator('button[type="submit"].btn-submit').click()
    await page.waitForTimeout(6000)

    const reps = await rest(`daily_reports?user_id=eq.${uid}&date=eq.${today}&select=id`)
    expect(reps.length, '期限内は承認を挟まず即反映').toBe(1)
    const pend = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${today}&select=id`)
    expect(pend.length, '保留は作らない').toBe(0)

    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${today}`, { method: 'DELETE' }).catch(() => {})
  })
})
