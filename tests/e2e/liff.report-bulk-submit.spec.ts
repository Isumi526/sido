// ============================================================
//  liff.report-bulk-submit.spec.ts
//  溜まった未提出日を「理由1回」でまとめて提出できる（2026-08-31・運用者B案）。
//
//  ★背景（2026-08-31 運用者）:
//   「今、ローカルのテストユーザーだと8月20日送信済みで、出退勤は当然今日の8月31日ってなった時に、
//     間の10日間ぐらいが浮く。従来のルールだと、1日ずつ確実にやらせていくっていうルールと矛盾する」
//   → 打刻フローが今日を埋めるので今後ギャップは増えない。残るのは既にある分を流すコストだけ。
//     1日ずつ理由を書いて承認を通すと10日分で理由10回・承認10回になるので、まとめられるようにした。
//
//  ★守ること:
//   ・まとめても承認を飛ばさない。期限（当日含む3日）より前は承認待ちに積む。
//     ここを崩すと「まとめて出せば承認不要」という抜け道になる。
//   ・期限内の日はその場で日報になる（従来と同じ）。
//   ・稼働なし／有給しか選べない（働いた日は現場・時間が要るのでまとめられない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const ymd = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
  .format(new Date(Date.now() - n * 86400000))

let accountId = ''
let userId = ''
let workerId = ''
let origStart: string | null = null

test.beforeAll(async () => {
  accountId = await getAccountId()
  const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
  userId = users[0].id
  workerId = users[0].worker_id
  // ★元の値を読んで戻す、はしない。他specが動かした後の値を「元」として焼き付けてしまう。
  //  global-setup が入れる値（今日-2）へ決め打ちで戻す。
  origStart = ymd(2)
})

test.beforeEach(async () => {
  // 起点を6日前に下げ、その範囲を空にする＝期限内(0-2日前)と期限切れ(3-6日前)が両方できる
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ report_start_date: ymd(6) }),
  })
  for (let n = 0; n <= 6; n++) {
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${ymd(n)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${ymd(n)}`, { method: 'DELETE' }).catch(() => {})
  }
})

test.afterAll(async () => {
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ report_start_date: origStart }),
  }).catch(() => {})
  for (let n = 0; n <= 6; n++) {
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${ymd(n)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${ymd(n)}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('★理由1回で複数日をまとめて提出できる。期限切れは承認待ちに積まれる', async ({ page }) => {
  await page.goto('/history', { waitUntil: 'networkidle' })
  // 起動時の割り込みは履歴では出ない（ホームだけ）。まとめて提出の入口が出る
  await expect(page.getByTestId('history-bulk')).toBeVisible({ timeout: 20000 })
  await page.getByTestId('bulk-open').click()
  await expect(page.getByTestId('bulk-panel')).toBeVisible()

  // 既定で全部選択されている（手数を最小にするため）
  const inWindow = ymd(1)   // 期限内（当日含む3日の中）
  const tooOld   = ymd(5)   // 期限切れ
  await expect(page.getByTestId(`bulk-check-${inWindow}`)).toBeChecked()
  await expect(page.getByTestId(`bulk-check-${tooOld}`)).toBeChecked()

  await page.getByTestId('bulk-reason').fill('E2E: 提出を失念していたため')
  await page.getByTestId('bulk-submit').click()
  await expect(page.getByTestId('bulk-result'), '結果を出す').toBeVisible({ timeout: 30000 })

  // ★期限内はその場で日報になる
  const near = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${inWindow}&select=is_working,leave_type`)
  expect(near.length, '★期限内はその場で日報になる').toBe(1)
  expect(near[0].is_working).toBe(false)

  // ★期限切れは日報にせず承認待ちに積む（まとめても承認を飛ばさない）
  const old = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${tooOld}&select=id`)
  expect(old.length, '★期限切れを勝手に日報にしない').toBe(0)
  const pend = await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${tooOld}&select=id,kind,reason`)
  expect(pend.length, '★期限切れは承認待ちに積む').toBe(1)
  expect(pend[0].kind).toBe('late_new')
  expect(pend[0].reason, '★理由が1回の入力で全日に付く').toContain('失念')
})

test('★有給を選んだ日は有給として残る', async ({ page }) => {
  await page.goto('/history', { waitUntil: 'networkidle' })
  await page.getByTestId('bulk-open').click()
  await expect(page.getByTestId('bulk-panel')).toBeVisible({ timeout: 20000 })

  const target = ymd(1)   // 期限内＝その場で日報になるので検証しやすい
  // この日以外のチェックを外して1日だけ出す
  const boxes = page.locator('.bulk-row input[type="checkbox"]')
  for (let i = 0, n = await boxes.count(); i < n; i++) {
    const b = boxes.nth(i)
    if (await b.getAttribute('data-testid') !== `bulk-check-${target}`) await b.uncheck()
  }
  await page.getByTestId(`bulk-kind-${target}`).selectOption('paid_leave')
  await page.getByTestId('bulk-reason').fill('E2E: 有給の後追い')
  await page.getByTestId('bulk-submit').click()
  await expect(page.getByTestId('bulk-result')).toBeVisible({ timeout: 30000 })

  const rows = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${target}&select=is_working,leave_type,leave_days`)
  expect(rows.length).toBe(1)
  expect(rows[0].leave_type, '★有給として残る（有給残数の計算に効く）').toBe('paid_leave')
  expect(Number(rows[0].leave_days)).toBe(1)
})

test('★期限切れを含むのに理由が空なら送信できない', async ({ page }) => {
  await page.goto('/history', { waitUntil: 'networkidle' })
  await page.getByTestId('bulk-open').click()
  await expect(page.getByTestId('bulk-panel')).toBeVisible({ timeout: 20000 })
  // 理由を入れない状態（既定で期限切れの日も選ばれている）
  await expect(page.getByTestId('bulk-submit'), '★理由なしで期限切れを通さない').toBeDisabled()
  await page.getByTestId('bulk-reason').fill('E2E: 理由')
  await expect(page.getByTestId('bulk-submit')).toBeEnabled()
})
