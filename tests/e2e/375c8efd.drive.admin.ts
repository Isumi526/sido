// ============================================================
//  375c8efd.drive.admin.ts — /review の「到達」用 駆動スクリプト
//  チケット: [AI候補] 日報・経費の承認をダブル承認（管理者→経営陣の二段）にする #375c8efd
//
//  ★これは spec ではない。**合否 assert を書かない**（判定は人）。
//    各ステップの状態まで到達し、目印要素を waitFor してからスクショを撮るだけ。
//    設計: cc-pipeline plans/20260806-review-drive.md / run.md §駆動スクリプト
//
//  ★ロール別の見え方も駆動する。
//    admin.expense-double-approval.spec.ts は「ロードごとの見え方はE2Eのログイン主体を
//    替えられないため人力チェックに回す」としているが、実際には**シードの問題**だった。
//    apps/admin/src/lib/auth.ts:82 resolveRole は workers.permission_role を
//    auth_user_id 紐付けで**ページ読み込み時に**解決する。よって e2e ログインユーザーに
//    worker 行を作り permission_role を差し替えて reload すれば、各ロールの画面に到達できる。
//    （到達するだけ。「一次承認はできるが支払い確定はできない」の判定は人が見て言う）
//
//  データは接頭辞 drive-375c8efd- を持たせ、冒頭で残骸を回収してから始める（冪等）。
// ============================================================
import { test } from '@playwright/test'
import { restSrv, getAccountId, ADMIN_LOGIN_EMAIL, DB_URL } from './helpers'
import { execSync } from 'node:child_process'

const PREFIX = 'drive-375c8efd-'
const WORKER = `${PREFIX}申請者`
const APPROVER = `${PREFIX}承認者`
const PERIOD = '2026-05-first'
const SHOT = (n: string) => ({ path: `tests/e2e/.artifacts/${PREFIX}${n}.png`, fullPage: true })

let accountId = ''
let workerId = ''
let userId = ''
let approverWorkerId = ''
let authUserId = ''

/** 接頭辞つきの残骸を全部消す（前回が異常終了していても次が自分で回収する）。
 *  ★順序が要る: users.worker_id の FK があるので users → personal_expenses → workers の順。
 *  ★失敗を握りつぶさない。消し残しがあれば throw して駆動を止める
 *    （共有DBなので残すと 234本の spec と後続のレビュー全部の前提を侵す）。 */
async function purge() {
  const us = await restSrv(`users?real_name=like.${PREFIX}*&select=id`)
  for (const u of us ?? []) {
    await restSrv(`expense_settlements?user_id=eq.${u.id}`, { method: 'DELETE' })
    await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' })
  }
  const ws = await restSrv(`workers?name=like.${PREFIX}*&select=id`)
  for (const w of ws ?? []) {
    await restSrv(`personal_expenses?worker_id=eq.${w.id}`, { method: 'DELETE' })
    await restSrv(`workers?id=eq.${w.id}`, { method: 'DELETE' })
  }
  // 消えたことを確認する（第22条: 消したつもりで残っていたのを 2026-08-06 に踏んだ）
  const left = {
    workers: (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0,
    users: (await restSrv(`users?real_name=like.${PREFIX}*&select=id`))?.length ?? 0,
  }
  if (left.workers || left.users) {
    throw new Error(`cleanup 未完了: workers=${left.workers} users=${left.users} が残っている（接頭辞 ${PREFIX}）`)
  }
}

/** ログイン中の e2e ユーザーの権限ロールを差し替える（null = 純オーナー扱い） */
async function setApproverRole(role: string | null) {
  await restSrv(`workers?id=eq.${approverWorkerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ permission_role: role }),
  })
}

/** DB の精算ステータスが期待値になるまで待つ。★合否の assert ではなく「到達の待ち」 */
async function waitStatus(uid: string, expected: string) {
  for (let i = 0; i < 50; i++) {
    const rows = await restSrv(`expense_settlements?user_id=eq.${uid}&period_key=eq.${PERIOD}&select=status`)
    if (rows?.[0]?.status === expected) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`到達できず: expense_settlements.status が ${expected} にならない`)
}

async function setStatus(status: string) {
  await restSrv(`expense_settlements?user_id=eq.${userId}&period_key=eq.${PERIOD}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status, first_approved_at: null, first_approved_by: null, first_approved_name: null,
      final_approved_by: null, final_approved_name: null, paid_on: null, payment_method: null,
    }),
  })
}

/** 対象の精算行を開く。★モーダルが出たことを目印にしてから返す */
async function open(page: import('@playwright/test').Page, who = WORKER) {
  await page.goto('/expenses?ym=2026-05', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: who }).first()
  await row.waitFor({ state: 'visible', timeout: 15000 })
  await row.click()
  await page.locator('.settle-row').first().waitFor({ state: 'visible', timeout: 15000 })
}

test.beforeAll(async () => {
  await purge()
  accountId = await getAccountId()

  // 申請者（他人）
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
  })
  workerId = w[0].id
  const u = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: workerId }),
  })
  userId = u[0].id
  await restSrv('expense_settlements', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, period_key: PERIOD,
      status: '申請中', applied_at: new Date().toISOString(),
    }),
  })
  // 精算行だけだと画面に出ない（spec と同じ）。個人経費を1件付ける
  await restSrv('personal_expenses', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: '2026-05-10',
      account_category: '消耗品費', amount: 12345, payee: `${PREFIX}店`, tategae: true,
    }),
  })

  // 承認者＝ログイン中の e2e ユーザーに worker 行を作り、ロールを差し替えられるようにする
  // auth.users は REST に出ないので psql で引く（global-setup.ts と同じ経路）
  authUserId = execSync(
    `psql "${DB_URL}" -tAc "select id from auth.users where email='${ADMIN_LOGIN_EMAIL}'"`,
    { encoding: 'utf8' },
  ).trim()
  const aw = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: APPROVER, role: 'site', active: true,
      auth_user_id: authUserId, permission_role: 'admin',
    }),
  })
  approverWorkerId = aw[0].id
})

test.afterAll(async () => { await purge() })

test('#375c8efd ダブル承認 — 👁ステップの到達', async ({ page }) => {
  // ── 1. オーナー(admin): 申請中では「一次承認する」だけが出る
  await setApproverRole('admin')
  await setStatus('申請中')
  await test.step('1. オーナーで申請中の精算を開く', async () => {
    await open(page)
    await page.getByTestId('exp-first-approve').waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('01-owner-shinseichu'))
  })

  // ── 2. 一次承認する → 一次承認済みになり、要対応から消えない
  await test.step('2. 一次承認する', async () => {
    await page.getByTestId('exp-first-approve').click()
    await waitStatus(userId, '一次承認済み')
    await open(page)   // モーダルは自動更新されないので開き直す（spec と同じ作法）
    await page.getByTestId('exp-first-approver').waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('02-after-first-approve'))
  })

  // ── 3. 続けて「支払い済みにする」が出る
  await test.step('3. 最終承認の導線が出る', async () => {
    await page.getByTestId('exp-final-approve').waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('03-final-approve-available'))
  })

  // ── 4. 役員・経理(office): 一次承認はできる／支払い確定はできず理由が出る
  await test.step('4. 役員・経理(office) の見え方', async () => {
    await setApproverRole('office')
    await setStatus('申請中')
    await open(page)
    await page.getByTestId('exp-first-approve').waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('04a-office-first-ok'))
    // 一次承認まで進めてから、最終承認がブロックされることを見せる
    await page.getByTestId('exp-first-approve').click()
    await waitStatus(userId, '一次承認済み')
    await open(page)
    await page.getByTestId('exp-final-blocked').waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('04b-office-final-blocked'))
  })

  // ── 5. 現場管理者(site_manager): どちらもできず理由が出る
  await test.step('5. 現場管理者(site_manager) の見え方', async () => {
    await setApproverRole('site_manager')
    await setStatus('申請中')
    // ★site_manager は経費画面そのものがルートガードで弾かれる（2026-08-06 駆動で判明）。
    //   🧪手順は「どちらもできず理由が出る」と書いているが、実際はもっと手前で止まる。
    //   行を探しに行くと必ずタイムアウトするので、画面を開いた状態をそのまま撮って人に見せる。
    await page.goto('/expenses?ym=2026-05', { waitUntil: 'networkidle' })
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('05-site-manager-blocked'))
  })

  // ── 6. 承認者本人が申請者のケース: 承認ボタンが出ない
  await test.step('6. 自分の精算は承認できない', async () => {
    await setApproverRole('admin')
    // 承認者自身の精算を作る
    const su = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: APPROVER, worker_id: approverWorkerId }),
    })
    await restSrv('expense_settlements', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: su[0].id, period_key: PERIOD,
        status: '申請中', applied_at: new Date().toISOString(),
      }),
    })
    await restSrv('personal_expenses', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: approverWorkerId, date: '2026-05-10',
        account_category: '消耗品費', amount: 5000, payee: `${PREFIX}店`, tategae: true,
      }),
    })
    await open(page, APPROVER)
    await page.getByTestId('exp-first-blocked').waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('06-self-approval-blocked'))
  })

  // ── 7. 金額の目視（段を足しただけで金額計算は変えていない）
  await test.step('7. 金額の目視', async () => {
    await setStatus('申請中')
    await open(page)
    await page.locator('.settle-row').first().waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot(SHOT('07-amounts'))
  })
})
