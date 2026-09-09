// ============================================================
//  liff.proxy-pending-dates.spec.ts （dev モード）
//  代理中は「代理先の」承認待ちで未送信日を判定する（2026-09-09）
//
//  ★背景（今井さんの報告）
//   「平床さんの6日送ったつもりが承認待ちが今井のになってる気がします。
//     平床さんの7日に進めない。」
//
//   本番データを見ると 9/5・9/6 とも **平床さん名義で正しく記録**されていた。
//   壊れていたのは判定の方で、EF の pending-dates が
//     .eq('report_user_id', caller.userId)
//   と **呼び出し本人の分だけ** を返していた。
//   代理中は「今井さんの承認待ち」しか返らないので、平床さんの 9/5・9/6 が
//   除外されず、最も古い未送信日が動かない＝7日に進めなかった。
//
//  ★このspecが固定すること
//   代理先の承認待ちが「出し済み」として飛ばされ、次の日へ進めること。
//   これが崩れると、代理入力が特定の日から先へ一切進めなくなる。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, getDevUserId } from './helpers'

const TS = Date.now()
const TARGET = 'E2E承認待ち代理_' + TS

/** 代理先の未送信の起点。ここから3日ぶんを対象にする。 */
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const START = daysAgo(3)   // 起点（この日を承認待ちにする）
const NEXT = daysAgo(2)    // 起点を飛ばせたら、次はここが出るはず

let ctx: { workerId: string; usersId: string; proxyId: string; pendingId: string } | null = null

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const devUserId = await getDevUserId()
  const me = await restSrv(`users?id=eq.${devUserId}&select=worker_id`)
  const myWorkerId = me[0]?.worker_id
  if (!myWorkerId) throw new Error('dev ユーザーに worker_id が無い')

  const [w] = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: TARGET, role: 'site', unit_price: 0, active: true }),
  })
  // 起点より前は未送信扱いにしない（登録日も遡らせる。effStart = max(サービス開始日, 登録日, 提出開始日)）
  await restSrv(`workers?id=eq.${w.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ report_start_date: START, created_at: `${START}T00:00:00+09:00` }),
  })
  const [u] = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: TARGET, worker_id: w.id, permission_role: 'worker' }),
  })
  const [pr] = await restSrv('worker_proxies', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: w.id, proxy_operator_id: myWorkerId }),
  })
  // ★代理先の「起点日」を承認待ちにする（日報にはまだ入らない＝pending のまま）
  const [pe] = await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, report_id: null, report_user_id: u.id, report_date: START,
      payload: {}, status: 'pending', kind: 'late_new',
      submitted_by_user_id: devUserId, submitted_by_name: 'E2E代理提出',
      reason: 'E2E: 代理の承認待ち判定',
    }),
  })
  // ★バッジ検証用に、起点より前の日で日報を1件作る（履歴にカードが出る状態にする）。
  //  起点(report_start_date)より前なので未送信の判定には影響しない。
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: u.id, date: daysAgo(4),
      is_working: false, sites: [], note: 'E2E代理カード',
    }),
  }).catch(() => {})

  ctx = { workerId: w.id, usersId: u.id, proxyId: pr.id, pendingId: pe.id }
})

test.afterAll(async () => {
  if (!ctx) return
  await restSrv(`daily_report_pending_edits?id=eq.${ctx.pendingId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`worker_proxies?id=eq.${ctx.proxyId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${ctx.usersId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${ctx.usersId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${ctx.workerId}`, { method: 'DELETE' }).catch(() => {})
})

test.describe('代理中の承認待ち判定', () => {
  test('★代理先の承認待ちの日は飛ばされ、次の日へ進める', async ({ page }) => {
    await page.goto('/history', { waitUntil: 'networkidle' })
    await page.getByTestId('nav-hamburger').click()
    const row = page.getByTestId(`proxy-row-${ctx!.workerId}`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.click()
    await page.waitForTimeout(3000)

    const card = page.getByTestId('history-unsubmitted')
    await expect(card, '代理先の未送信カードが出る').toBeVisible({ timeout: 20000 })
    // ★承認待ちの START は飛ばされ、NEXT を指しているはず。
    //  ここが START のままなら、相手の承認待ちを飛ばせていない＝7日に進めない状態。
    await expect(card, `承認待ちの ${START} は飛ばして ${NEXT} を指す`)
      .toHaveAttribute('href', new RegExp(NEXT))
  })

  test('★承認待ちカードに「誰の分か」が出る', async ({ page }) => {
    await page.goto('/history', { waitUntil: 'networkidle' })
    await page.getByTestId('nav-hamburger').click()
    await page.getByTestId(`proxy-row-${ctx!.workerId}`).click()
    await page.waitForTimeout(3000)
    await expect(page.getByTestId('history-proxy-owner').first(),
      '代理中は誰の分かを明記する').toContainText(TARGET)
  })
})
