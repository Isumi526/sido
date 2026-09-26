// ============================================================
//  liff.history-unsubmitted-proxy.spec.ts （dev モード）
//  代理中でも「未送信の日」を出す（2026-09-08）
//
//  ★背景（今井さんの報告）
//   「平床さんです。日曜日からの日報を打ちたいけどできない。
//     日報履歴の画面で未報告の日報が出てくる認識ですが出てこない。
//     代理でなく自分のは出てくる。」
//
//   history.vue の loadUnsubmitted に `if (proxy.proxyTarget.value) return` があり、
//   代理中は未送信を一切出さない仕様だった（「誰の分を書くのか分からなくなる」ため）。
//   しかし LINE もログインも持たない作業員は **代理でしか日報を出せない** ので、
//   未送信が見えないと出し忘れに気づく手段が無い。
//   実際 平床さんは auth_user_id なし・LINE未紐付で、今井さんの代理が唯一の経路。
//
//  ★「誰の分か分からない」への対処
//   カードに相手の名前を出す（unsub-proxy-name）。消すのではなく名乗らせる。
// ============================================================
import { test, expect } from './liff-test'
import { getAccountId, restSrv, getDevUserId } from './helpers'

const TS = Date.now()
const TARGET = 'E2E代理先_' + TS
/** 代理先の未送信の起点。日報を1件も作らないので、ここが最も古い未送信日になる。 */
const EXPECTED_DATE = (() => {
  const d = new Date(); d.setDate(d.getDate() - 3)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

let ctx: { workerId: string; usersId: string; myWorkerId: string; proxyId: string } | null = null

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const devUserId = await getDevUserId()
  const me = await restSrv(`users?id=eq.${devUserId}&select=worker_id`)
  const myWorkerId = me[0]?.worker_id
  if (!myWorkerId) throw new Error('dev ユーザーに worker_id が無い')

  // 代理先の作業員（LINEもログインも持たない＝代理でしか日報を出せない人）
  const [w] = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: TARGET, role: 'site', unit_price: 0, active: true }),
  })
  const [u] = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: TARGET, worker_id: w.id, permission_role: 'worker' }),
  })
  // ★未送信の起点を固定する。こうしないと「出ているのが自分の分か相手の分か」を
  //  テストが区別できず、代理の再計算が壊れていても通ってしまう（変異テストで検出）。
  //  未送信の起点は max(サービス開始日, 作業員の登録日, 日報提出開始日)。
  //  今作った作業員は created_at が今日なので、登録日も遡らせないと起点が今日になる。
  await restSrv(`workers?id=eq.${w.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ report_start_date: EXPECTED_DATE, created_at: `${EXPECTED_DATE}T00:00:00+09:00` }),
  })
  const [pr] = await restSrv('worker_proxies', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: w.id, proxy_operator_id: myWorkerId }),
  })
  ctx = { workerId: w.id, usersId: u.id, myWorkerId, proxyId: pr.id }
})

test.afterAll(async () => {
  if (!ctx) return
  await restSrv(`worker_proxies?id=eq.${ctx.proxyId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${ctx.usersId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${ctx.usersId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${ctx.usersId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${ctx.workerId}`, { method: 'DELETE' }).catch(() => {})
})

test.describe('代理中の未送信表示', () => {
  test('★代理先を選ぶと、その人の未送信の日が出る（誰の分かも分かる）', async ({ page }) => {
    await page.goto('/history', { waitUntil: 'networkidle' })

    // 代理先の切替はドロワー内。ハンバーガー→該当行をクリック。
    await page.getByTestId('nav-hamburger').click()
    const row = page.getByTestId(`proxy-row-${ctx!.workerId}`)
    await expect(row, '代理先の一覧に出る（active なので出るはず）').toBeVisible({ timeout: 15000 })
    await row.click()
    await page.waitForTimeout(3000)

    await expect(page.getByTestId('history-unsubmitted'),
      '代理中でも未送信カードが出る（これが無いと出し忘れに気づけない）').toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('unsub-proxy-name'),
      '誰の分かが分かる').toContainText(TARGET)
    // ★出ているのが「相手の」未送信日であることまで見る。
    //  カードのリンク先が代理先の起点日になっていなければ、自分の分を出しているだけ。
    await expect(page.getByTestId('history-unsubmitted'),
      '相手の未送信日を指している').toHaveAttribute('href', new RegExp(EXPECTED_DATE))
  })

  // ★2026-09-19 実害: 今井さんが平床さんの代理で3日を「まとめて稼働なし」で出したら、
  //  今井さん本人の日報3件が「休み」に上書きされた（元データは復元不能）。
  //  未送信リストは代理先の日付なのに、保存先だけ selfUser のままだったため。
  //  「誰の未送信を出しているか」と「誰に書くか」は必ず同じ人でなければならない。
  test('★代理中に「まとめて提出」すると、代理先に書かれ、自分の日報は触られない', async ({ page }) => {
    const devUserId = await getDevUserId()
    // 自分の日報の状態を焼き付けておく（後で「1件も変わっていない」を見る）
    const mineBefore = await restSrv(`daily_reports?user_id=eq.${devUserId}&select=id,date,is_working,updated_at&order=date`)

    await page.goto('/history', { waitUntil: 'networkidle' })
    await page.getByTestId('nav-hamburger').click()
    await page.getByTestId(`proxy-row-${ctx!.workerId}`).click({ timeout: 15000 })
    await page.waitForTimeout(3000)

    await expect(page.getByTestId('history-bulk'), '代理先の未送信が2件以上あるのでまとめて提出が出る')
      .toBeVisible({ timeout: 20000 })
    await page.getByTestId('bulk-open').click()
    await expect(page.getByTestId('bulk-panel')).toBeVisible()
    await page.getByTestId('bulk-reason').fill('E2E: 代理でまとめて稼働なし')
    await page.getByTestId('bulk-submit').click()
    await expect(page.getByTestId('bulk-result')).toBeVisible({ timeout: 30000 })

    // 代理先に書かれている（期限内の日は daily_reports、期限切れは承認待ち）
    const target = await restSrv(`daily_reports?user_id=eq.${ctx!.usersId}&select=date,is_working`)
    const pending = await restSrv(`daily_report_pending_edits?report_user_id=eq.${ctx!.usersId}&kind=eq.late_new&select=report_date`)
    expect(target.length + pending.length, '代理先の分として保存される').toBeGreaterThanOrEqual(2)
    for (const r of target) expect(r.is_working, '稼働なしで入る').toBe(false)

    // ★自分の日報は1件も増えても変わってもいない
    const mineAfter = await restSrv(`daily_reports?user_id=eq.${devUserId}&select=id,date,is_working,updated_at&order=date`)
    expect(mineAfter, '自分の日報が上書き・追加されていない').toEqual(mineBefore)
    // 承認待ちも自分名義で積まれていない
    const minePending = await restSrv(`daily_report_pending_edits?report_user_id=eq.${devUserId}&kind=eq.late_new&reason=eq.${encodeURIComponent('E2E: 代理でまとめて稼働なし')}&select=id`)
    expect(minePending.length, '自分名義の承認待ちが積まれていない').toBe(0)
  })
})
