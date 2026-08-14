// ============================================================
//  liff.report-edit-rejected.spec.ts （dev モード）
//  ★日報編集を差し戻された時、作業員がそれに気づけること。
//
//  2026-08-14 まで、管理者が差し戻しても作業員側は「承認待ちバッジが黙って消える」
//  だけで、承認と差し戻しの区別すらつかなかった（LIFF に表示なし・通知なし）。
//  ＝「コメントを入れて差し戻す」という運用がそもそも成立していなかった。
//  ここで「理由が本人に見える」「確認したら消える」を固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getDevUserId, getAccountId } from './helpers'

const TS = Date.now()
const DATE = '2026-11-18'
const REASON = `E2E差戻理由_${TS}_領収書の写真を付けてください`

let accountId = ''
let userId = ''
let reportId = ''

/** 「差し戻された編集申請」が未確認で1件ある状態を作る */
async function seedRejected(): Promise<string> {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${DATE}`,
    { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})

  const rep = await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true,
      note: 'E2E差戻対象',
      sites: [{ siteName: 'テスト現場R', workers: [], subcontractors: [], expenses: {
        vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] } }],
    }),
  })
  reportId = rep[0].id

  const pend = await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, report_id: reportId, report_user_id: userId, report_date: DATE,
      kind: 'edit', reason: `E2E申請理由_${TS}`,
      payload: { is_working: true, leave_type: null, is_business_trip: false,
                 sites: [], note: 'E2E差戻対象', gasoline_items: [] },
      status: 'rejected', reject_reason: REASON,
      reviewed_by_name: '大塚', reviewed_at: new Date().toISOString(), acknowledged_at: null,
    }),
  })
  return pend[0].id
}

test.describe('日報編集の差し戻し（作業員側）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    userId = (await getDevUserId()) as string
  })

  test.afterAll(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${DATE}`,
      { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★差し戻されたことと理由が履歴に出る', async ({ page }) => {
    await seedRejected()
    await page.goto('/history', { waitUntil: 'networkidle' })

    const card = page.getByTestId('history-rejected').filter({ hasText: REASON })
    await expect(card, '★差し戻しが作業員に見える（無音で消えない）').toBeVisible({ timeout: 20000 })
    await expect(card, '差し戻しだと分かる').toContainText('差し戻されました')
    await expect(card.getByTestId('history-rejected-reason'), '★何を直せばいいか分かる').toContainText(REASON)
    await expect(card, '差し戻した人が分かる').toContainText('大塚')
    await expect(card.getByTestId('history-rejected-fix'), '直して出し直す導線がある')
      .toHaveAttribute('href', new RegExp(`edit=${DATE}`))
  })

  test('★「確認しました」を押すと消え、次に開いても出ない', async ({ page }) => {
    const pendingId = await seedRejected()
    await page.goto('/history', { waitUntil: 'networkidle' })

    const card = page.getByTestId('history-rejected').filter({ hasText: REASON })
    await expect(card).toBeVisible({ timeout: 20000 })
    await card.getByTestId('history-rejected-ack').click()
    await expect(card, '押したら消える').toHaveCount(0, { timeout: 15000 })

    // ★画面からは即消える（楽観更新）ので、DBへの書き込みは待って確かめる。
    //  一発 select だと EF の応答より先に読んでしまい落ちる。
    await expect
      .poll(async () => (await restSrv(
        `daily_report_pending_edits?id=eq.${pendingId}&select=acknowledged_at`))[0].acknowledged_at,
      { message: '★既読がDBに残る（見た目だけ消すのでは再訪で復活する）', timeout: 15000 })
      .not.toBeNull()

    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByTestId('history-rejected').filter({ hasText: REASON }),
      '開き直しても出ない').toHaveCount(0, { timeout: 15000 })
  })
})
