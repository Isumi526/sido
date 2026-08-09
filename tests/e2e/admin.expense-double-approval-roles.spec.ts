// ============================================================
//  admin.expense-double-approval-roles.spec.ts
//  ダブル承認の【ロール別の見え方】— 誰が一次承認でき、誰が支払い確定できるか
//   申請中 →(一次承認: office以上)→ 一次承認済み →(最終承認: admin)→ 支払い済み
//
//  ★2026-08-06 の駆動スクリプト 375c8efd.drive.admin.ts を assert つき spec に昇格させたもの
//   （cc-pipeline plans/20260807-test-and-contact-split.md「到達できるなら spec にする」）。
//   駆動は到達だけして人がスクショを見る形だったが、スクショは検証としてE2Eに劣るため廃止。
//   到達コード（ロール差し替え）はそのまま活きるので、待つだけだった箇所を assert に変えた。
//
//  ★「ロールごとの見え方はE2Eのログイン主体を替えられないから人力」は誤りだった。
//   apps/admin/src/lib/auth.ts resolveRole は workers.permission_role を auth_user_id 紐付けで
//   ページ読み込み時に解決するので、e2eユーザーに worker 行を作って role を差し替え reload すれば到達できる。
//   ＝これは原理的制約ではなく**シードの問題**だった。
//
//  ★ただし spec にできることと、人が見なくてよいことは別。認可は第9条で人も見る（🔴 認証・権限・RLS）。
//
//  データは接頭辞 role-dbl- を持たせ、冒頭で残骸を回収してから始める（冪等・共有DB）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, ADMIN_LOGIN_EMAIL, DB_URL } from './helpers'
import { execSync } from 'node:child_process'

const PREFIX = 'role-dbl-'
const WORKER = `${PREFIX}申請者`
const APPROVER = `${PREFIX}承認者`
const PERIOD = '2026-05-first'

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

test.describe('ダブル承認のロール別の見え方', () => {
  test('★オーナー(admin): 申請中では一次承認だけが出て、支払い確定は出ない', async ({ page }) => {
    await setApproverRole('admin')
    await setStatus('申請中')
    await open(page)
    await expect(page.getByTestId('exp-first-approve'), '一次承認は出る').toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('exp-final-approve'), '★段を飛ばす導線は出ない').toHaveCount(0)
  })

  test('★オーナー(admin): 一次承認すると承認者が記録され、続けて支払い確定できる', async ({ page }) => {
    await setApproverRole('admin')
    await setStatus('申請中')
    await open(page)
    await page.getByTestId('exp-first-approve').click()
    await waitStatus(userId, '一次承認済み')
    await open(page)
    await expect(page.getByTestId('exp-first-approver'), '誰が通したかが残る').toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('exp-first-approver'), '承認者名が空でない').not.toHaveText(/^\s*$/)
    await expect(page.getByTestId('exp-final-approve'), '一次承認済みで初めて支払い確定が出る').toBeVisible()
  })

  test('★役員・経理(office): 一次承認はできるが、支払い確定はできず理由が出る', async ({ page }) => {
    await setApproverRole('office')
    await setStatus('申請中')
    await open(page)
    await expect(page.getByTestId('exp-first-approve'), 'office は一次承認できる').toBeVisible({ timeout: 15000 })

    await page.getByTestId('exp-first-approve').click()
    await waitStatus(userId, '一次承認済み')
    await open(page)
    await expect(page.getByTestId('exp-final-approve'), '★office に支払い確定はさせない').toHaveCount(0)
    const blocked = page.getByTestId('exp-final-blocked')
    await expect(blocked, '理由が出る').toBeVisible({ timeout: 15000 })
    await expect(blocked, '理由が空文字でない').not.toHaveText(/^\s*$/)
  })

  test('★現場管理者(site_manager): 経費画面そのものに入れない（ルートガード）', async ({ page }) => {
    await setApproverRole('site_manager')
    await setStatus('申請中')
    // 🧪手順は「どちらもできず理由が出る」と書いていたが、実際はもっと手前で止まる
    //  ＝経費は経営系ページなので site_manager はルートガードで弾かれる（2026-08-06 駆動で判明）。
    await page.goto('/expenses?ym=2026-05', { waitUntil: 'networkidle' })
    await expect(page, '★ダッシュボードへ戻される').toHaveURL(/\/\/[^/]+\/$/)
    await expect(page.locator('.settle-row'), '精算行に到達できない').toHaveCount(0)
  })

  test('★自分の精算は承認できない（承認者本人が申請者のケース）', async ({ page }) => {
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
    await expect(page.getByTestId('exp-first-approve'), '★自分の精算に承認ボタンを出さない').toHaveCount(0)
    const blocked = page.getByTestId('exp-first-blocked')
    await expect(blocked, '理由が出る').toBeVisible({ timeout: 15000 })
    await expect(blocked, '理由が空文字でない').not.toHaveText(/^\s*$/)
  })
})
