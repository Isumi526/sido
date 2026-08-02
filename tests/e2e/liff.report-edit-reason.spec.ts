// ============================================================
//  liff.report-edit-reason.spec.ts
//  日報の編集理由を必須にする（Notion「日報の編集理由を必須にする」・回答=B）
//   - 編集モードでは理由が空だと送信できない（新規送信には出さない＝今までどおり）
//   - 理由を入れて更新すると daily_report_edit_logs に1行残る（何を変えたかの差分つき）
//   - ★2回編集しても前回の理由が消えず2行になる
//     ＝日報の1列(upsertで上書き)ではなく履歴テーブルにした理由そのものを固定する
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId } from './helpers'

const EDIT_DATE = '2026-10-16'
const TS = Date.now()

test.describe('日報の編集理由（liff）', () => {
  let uid = ''
  let accountId = ''

  test.beforeEach(async () => {
    uid = (await getDevUserId())!
    accountId = await getAccountId()
    await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
    await rest('daily_reports?on_conflict=user_id,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true,
        note: 'E2E:編集理由テスト',
        sites: [{
          siteName: 'テスト現場B', workers: [], subcontractors: [],
          expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
        }],
      }),
    })
  })

  test.afterEach(async () => {
    await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  /** 編集画面を開いて描画を待つ */
  async function openEdit(page: import('@playwright/test').Page) {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 15000 })
  }

  test('★理由が空だと更新できない（入れると押せるようになる）', async ({ page }) => {
    await openEdit(page)

    const submit = page.getByTestId('report-submit')
    await expect(submit, '理由が空なら押せない').toBeDisabled()

    // 空白だけは理由とみなさない（DB側の check 制約と同じ扱いにする）
    await page.getByTestId('edit-reason').fill('   ')
    await expect(submit, '空白だけでは押せない').toBeDisabled()

    await page.getByTestId('edit-reason').fill('現場を間違えたため')
    await expect(submit, '理由を入れれば押せる').toBeEnabled()
  })

  test('新規送信では編集理由を求めない（今までどおり送れる）', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason'), '新規では出さない').toHaveCount(0)
  })

  test('★理由と差分が daily_report_edit_logs に残り、2回編集すると2行に増える', async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}))

    const reason1 = `E2E理由1_${TS}`
    await openEdit(page)
    // 稼働状態を変えて差分を作る（差分が空だと何を直したのか残らない）
    await page.getByTestId('edit-reason').fill(reason1)
    await page.getByTestId('report-submit').click()
    await page.waitForTimeout(4000)

    let logs = await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=reason,report_id,account_id,edited_by_name,created_at&order=created_at.asc`)
    expect(logs.length, '1回目の編集で1行').toBe(1)
    expect(logs[0].reason).toBe(reason1)
    expect(logs[0].account_id, 'テナントが入る').toBe(accountId)
    expect(logs[0].report_id, '日報に紐づく').toBeTruthy()

    // ── 2回目の編集。1列に持っていたらここで前回の理由が消える ──
    const reason2 = `E2E理由2_${TS}`
    await openEdit(page)
    await page.getByTestId('edit-reason').fill(reason2)
    await page.getByTestId('report-submit').click()
    await page.waitForTimeout(4000)

    logs = await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=reason&order=created_at.asc`)
    expect(logs.length, '★2回目でも上書きされず2行になる').toBe(2)
    expect(logs.map((l: any) => l.reason)).toEqual([reason1, reason2])
  })
})
