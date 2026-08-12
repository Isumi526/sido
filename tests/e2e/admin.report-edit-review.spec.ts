// ============================================================
//  admin.report-edit-review.spec.ts
//  日報編集の承認（保留方式）— 管理者側
//   - 承認待ち一覧に 理由 と 変更内容(差分) が出る
//   - ★承認すると daily_reports に反映される（＝ここで初めて集計・PDF・請求に出る）
//   - ★差し戻すと daily_reports は変わらず、保留が承認待ちから消える
//   - 承認/差戻し済みのものを二重に処理できない
//  ★金額系なので「承認前=旧値 / 承認後=新値」を数値で固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E承認_${TS}`
const DATE = '2026-10-22'
const ORIG_YEN = 1100
const NEW_YEN = 7700

let accountId = ''
let userId = ''
let reportId = ''

/** 編集前の日報と、編集後を保留に入れた状態を作る */
async function seed(): Promise<string> {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})

  const site = (yen: number) => ([{
    siteName: 'テスト現場B', workers: [], subcontractors: [],
    expenses: {
      vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
      others: [{ label: `E2E資材_${TS}`, yen, tategae: false, fileUrls: [] }], entertainments: [],
    },
  }])

  const rep = await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true,
      note: 'E2E承認前', sites: site(ORIG_YEN),
    }),
  })
  reportId = rep[0].id

  const pend = await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, report_id: reportId, report_user_id: userId, report_date: DATE,
      payload: {
        is_working: true, leave_type: null, is_business_trip: false,
        sites: site(NEW_YEN), note: 'E2E承認後', gasoline_items: [],
      },
      reason: `E2E理由_${TS}`,
      diffs: [`その他: ¥${ORIG_YEN.toLocaleString()} → ¥${NEW_YEN.toLocaleString()}`],
      submitted_by_name: WORKER, status: 'pending',
    }),
  })
  return pend[0].id
}

/** daily_reports に入っている金額（＝集計・PDFが見る値） */
async function savedYen(): Promise<number> {
  const rows = await restSrv(`daily_reports?id=eq.${reportId}&select=sites`)
  return Number(rows?.[0]?.sites?.[0]?.expenses?.others?.[0]?.yen ?? 0)
}

test.describe('日報編集の承認（admin）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const w = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
    })
    const u = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: w[0].id }),
    })
    userId = u[0].id
  })

  test.afterAll(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★承認すると daily_reports に反映される（ここで初めて集計に出る）', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
    await expect(card, '承認待ちに出る').toBeVisible({ timeout: 15000 })
    await expect(card, '理由が出る').toContainText(`E2E理由_${TS}`)
    await expect(card, '★理由だけでなく何を変えたかも出る').toContainText('¥1,100 → ¥7,700')

    expect(await savedYen(), '承認前は旧値').toBe(ORIG_YEN)

    await card.getByTestId('pending-approve').click()
    await expect(page.getByTestId('review-msg')).toContainText('承認しました', { timeout: 30000 })

    expect(await savedYen(), '★承認後は新値が daily_reports に入る').toBe(NEW_YEN)
    const rep = await restSrv(`daily_reports?id=eq.${reportId}&select=note`)
    expect(rep[0].note, '備考も適用される').toBe('E2E承認後')

    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=status`)
    expect(pend[0].status).toBe('approved')
  })

  test('承認すると左メニューのバッジも消える（承認済みなのに件数が残らない）', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const badge = page.locator('a[href="#/report-edit-review"] .nav-badge, .nav-link .nav-badge').first()
    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
    await expect(card).toBeVisible({ timeout: 15000 })

    await card.getByTestId('pending-approve').click()
    await expect(page.getByTestId('review-msg')).toContainText('承認しました', { timeout: 30000 })
    // ★リロードせずにバッジが消えること（load() だけでは消えなかった＝レビュー指摘）
    await expect(page.locator('.nav-link', { hasText: '日報編集の承認' }).locator('.nav-badge'),
      'バッジが残らない').toHaveCount(0, { timeout: 15000 })
    void badge
  })

  test('★差し戻すと daily_reports は変わらない', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.getByTestId('pending-reject').click()
    await expect(page.getByTestId('review-msg')).toContainText('差し戻しました', { timeout: 30000 })

    expect(await savedYen(), '差戻しでは日報は変わらない').toBe(ORIG_YEN)
    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=status`)
    expect(pend[0].status).toBe('rejected')

    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` }),
      '承認待ちから消える').toHaveCount(0)
  })

  test('★期限切れの新規提出は、承認すると日報が新しく作られる（editはupdate/late_newはupsert）', async ({ page }) => {
    const LATE = '2026-09-15'
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${LATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv('daily_report_pending_edits', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, report_id: null, report_user_id: userId, report_date: LATE,
        kind: 'late_new', status: 'pending', reason: `E2E遅延_${TS}`,
        payload: {
          is_working: true, leave_type: null, is_business_trip: false, note: 'E2E期限切れ',
          sites: [{ siteName: 'テスト現場B', workers: [], subcontractors: [], expenses: {
            vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
            others: [{ label: `E2E資材_${TS}`, yen: NEW_YEN, tategae: false, fileUrls: [] }], entertainments: [] } }],
          gasoline_items: [],
        },
      }),
    })
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E遅延_${TS}` })
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card.getByTestId('pending-kind'), '編集と区別して出る').toContainText('期限切れの新規提出')

    expect((await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${LATE}&select=id`)).length,
      '承認前は日報が存在しない').toBe(0)

    await card.getByTestId('pending-approve').click()
    await expect(page.getByTestId('review-msg')).toContainText('承認しました', { timeout: 30000 })

    const reps = await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${LATE}&select=id,sites,note`)
    expect(reps.length, '★承認で日報が新しく作られる').toBe(1)
    expect(Number(reps[0].sites?.[0]?.expenses?.others?.[0]?.yen)).toBe(NEW_YEN)

    // ★2026-08-10 レビューで発見: late_new は承認時に日報が生まれるのに、その id を
    //  pending.report_id へ書き戻していなかった。report_id が NULL のままだと
    //  日報詳細の「この日報の承認履歴を見る」（report_id で数える）が永久に0件になり、
    //  後出しで出てきた日報だけ履歴から切り離される。
    const pend = await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${LATE}&select=report_id,status`)
    expect(pend[0].status).toBe('approved')
    expect(pend[0].report_id, '★作られた日報と紐づく（履歴から辿れる）').toBe(reps[0].id)

    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${LATE}`, { method: 'DELETE' }).catch(() => {})
  })

  // ────────────────────────────────────────────
  //  承認履歴（誰がいつ承認/差戻ししたか）
  //  ★承認/差戻しの記録自体は前から保存されていたが、画面が status=pending しか
  //    出しておらず後から確認する手段が無かった。履歴として見えることを固定する。
  // ────────────────────────────────────────────
  test('★承認すると承認履歴に「承認」と承認者・日時が残る', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    await page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
      .getByTestId('pending-approve').click()
    await expect(page.getByTestId('review-msg')).toContainText('承認しました', { timeout: 30000 })

    await page.getByTestId('history-toggle').click()
    const row = page.locator('[data-testid="history-row"]', { hasText: `E2E理由_${TS}` }).first()
    await expect(row, '★承認したものが履歴に出る').toBeVisible({ timeout: 15000 })
    await expect(row.getByTestId('history-status'), '結果が承認と分かる').toContainText('承認')
    await expect(row, '対象日が出る').toContainText(DATE)
    await expect(row, '申請者が出る').toContainText(WORKER)
    await expect(row, '変更内容も履歴から追える').toContainText('¥1,100 → ¥7,700')

    const saved = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=reviewed_by_name,reviewed_at`)
    expect(saved[0].reviewed_at, '承認日時が残る').toBeTruthy()
    expect(saved[0].reviewed_by_name, '承認者が記録される').toBeTruthy()
    await expect(row.getByTestId('history-reviewer'), '画面にも承認者が出る')
      .toContainText(String(saved[0].reviewed_by_name))
    // ★「承認者が email ではなく氏名で出る」(AC2) はここでは固定できない:
    //   E2Eのadminログイン(e2e@email.com)は accounts.owner_auth_user_id で
    //   オーナー扱いにしている合成ユーザーで、workers 行を持たない（持たせると
    //   permission_role の解決が変わり他specの権限前提が崩れる）。
    //   worker行が無い承認者は仕様どおり email に倒れるため、氏名表示の確認は
    //   実アカウント（worker行あり）での人力チェックに回す。
    //   ここでは「承認者が必ず記録され、画面に出る」ことまでを固定する。
  })

  test('★差し戻すと履歴に「差し戻し」と差戻し理由が出る', async ({ page }) => {
    await seed()
    const REJECT = `E2E差戻理由_${TS}`
    // 差戻しは window.prompt で理由を取るので、prompt に理由を入れて返す
    await page.addInitScript((r) => { window.prompt = () => r }, REJECT)
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    await page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
      .getByTestId('pending-reject').click()
    await expect(page.getByTestId('review-msg')).toContainText('差し戻しました', { timeout: 30000 })

    await page.getByTestId('history-toggle').click()
    const row = page.locator('[data-testid="history-row"]', { hasText: `E2E理由_${TS}` }).first()
    await expect(row, '差し戻したものが履歴に出る').toBeVisible({ timeout: 15000 })
    await expect(row.getByTestId('history-status')).toContainText('差し戻し')
    await expect(row.getByTestId('history-reject-reason'), '★差戻し理由が履歴に出る').toContainText(REJECT)

    expect(await savedYen(), '差戻しでは daily_reports は変わらない').toBe(ORIG_YEN)
  })

  test('★日報詳細から、その日報の承認履歴だけに絞って辿れる', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
      .getByTestId('pending-approve').click()
    await expect(page.getByTestId('review-msg')).toContainText('承認しました', { timeout: 30000 })

    // 日報詳細を開く → 承認履歴への導線が出る。
    // 日報一覧は「今月」で開くので、seedした対象月まで月ナビを進めてから探す。
    await page.goto('/reports', { waitUntil: 'networkidle' })
    const [y, m] = DATE.split('-')
    const wantLabel = `${Number(y)}年${Number(m)}月`
    for (let i = 0; i < 24 && !(await page.locator('.month-label').innerText()).includes(wantLabel); i++) {
      await page.locator('.month-nav .month-btn').last().click()
      await page.waitForTimeout(150)
    }
    await expect(page.locator('.month-label')).toContainText(wantLabel)
    const card = page.locator('.report-card', { hasText: WORKER }).first()
    await expect(card, '対象月に seed した日報が出る').toBeVisible({ timeout: 15000 })
    await card.locator('.report-header').click()
    const link = page.getByTestId('review-history-link')
    await expect(link, '★日報詳細から承認履歴へ辿れる').toBeVisible({ timeout: 15000 })
    await link.click()

    // 絞り込み状態で開き、その日報の履歴だけが出る
    await expect(page).toHaveURL(new RegExp(`reportId=${reportId}`))
    await expect(page.getByTestId('history-filter-note'), 'この日報に絞っていると分かる').toBeVisible()
    const rows = page.locator('[data-testid="history-row"]')
    await expect(rows, 'この日報の履歴だけ').toHaveCount(1)
    await expect(rows.first()).toContainText(DATE)
  })

  // ★2026-08-07 レビューで発見: 差戻しの理由入力(prompt)でキャンセルを押しても差し戻されていた。
  //  window.prompt の null を「理由なし」として続行していたため（承認側の confirm は正しく中断する）。
  //  誤クリック→キャンセルで作業員の編集が差し戻される事故になる。
  test('★差戻しの理由入力でキャンセルすると、差し戻されない', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.dismiss().catch(() => {}))  // ＝ prompt のキャンセル

    // ★「差し戻しました が出ない」を not.toBeVisible で見てはいけない。初回ポーリングで即成立し、
    //  EFの応答を待たずに通ってしまう＝修正前のコードでも通る空振りテストになる（2026-08-07 に実際に踏んだ）。
    //  EF を1回も叩いていないことをリクエストで直接見る。
    const efCalls: string[] = []
    page.on('request', (r) => { if (r.url().includes('report-edit-log')) efCalls.push(r.method()) })

    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.getByTestId('pending-reject').click()
    await page.waitForTimeout(2000)  // 叩くならこの間に飛ぶ

    expect(efCalls, '★report-edit-log を1回も叩かない').toHaveLength(0)
    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=status`)
    expect(pend[0].status, 'pending のまま').toBe('pending')
    await expect(card, '承認待ちに残ったまま').toBeVisible()
    expect(await savedYen(), '日報も変わらない').toBe(ORIG_YEN)
  })

  test('理由を空欄のままOKなら、従来どおり理由なしで差し戻せる（任意の仕様は変えない）', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept('').catch(() => {}))  // 空欄でOK
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.getByTestId('pending-reject').click()
    await expect(page.getByTestId('review-msg')).toContainText('差し戻しました', { timeout: 30000 })
    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=status`)
    expect(pend[0].status).toBe('rejected')
  })

  test('承認済みのものは二重に承認できない（金額が二度適用されない）', async ({ page }) => {
    const pendingId = await seed()
    // 1度承認しておく
    await restSrv(`daily_report_pending_edits?id=eq.${pendingId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'approved' }),
    })
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` }),
      '承認済みは一覧に出ない').toHaveCount(0)
    expect(await savedYen(), '一覧経由で再適用されない').toBe(ORIG_YEN)
  })
})
