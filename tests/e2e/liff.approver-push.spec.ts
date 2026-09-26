// ============================================================
//  liff.approver-push.spec.ts
//  承認者が「承認待ち」をこの端末へプッシュで受け取る購読（A-3・2026-09-24）。
//
//  ★実際に端末へ届くかはローカルでは見られない（VAPID鍵・プッシュサービスが無い）。実機レビューで見る。
//   ここでは「誰が・どの会社の宛先として登録されるか」と、画面の出し分けを固定する。
//  ★守ること:
//   1. 登録先の作業員・会社は**検証済みの身元**で決まる（body で他人・他社を名乗っても無視）
//   2. 承認者でない人は登録できない（403）＝作業員に承認通知が届かない
//   3. 他人の購読は消せない
//   4. カードは承認者にだけ出る（作業員のホーム・通知ページには出ない）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const EP = `https://push.example.test/e2e-${TS}`
let accountId = ''
let workerId = ''
let otherWorkerId = ''
let otherAccountId = ''

test.describe.configure({ mode: 'serial' })

async function ef(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/attendance-log`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, dev_line_user_id: 'dev-user-id', ...payload }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
async function setRole(role: string) {
  await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: role }) })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
  workerId = u[0].worker_id
  const others = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&id=neq.${workerId}&select=id&limit=1`)
  otherWorkerId = others[0].id
  otherAccountId = (await restSrv('accounts?slug=eq.sample-construction&select=id'))[0].id
})
test.afterAll(async () => {
  await setRole('site_manager')
  await restSrv(`approver_push_subscriptions?endpoint=like.${encodeURIComponent('https://push.example.test/')}*`, { method: 'DELETE' }).catch(() => {})
})

test('承認者（現場責任者）は対象と判定される', async () => {
  const r = await ef('approver-push-status', { endpoint: EP })
  expect(r.body.ok).toBe(true)
  expect(r.body.eligible).toBe(true)
  expect(r.body.subscribed).toBe(false)
})

test('★登録先は身元で決まる（body で他人・他社を名乗っても無視される）', async () => {
  const r = await ef('approver-push-subscribe', {
    endpoint: EP, p256dh: 'p256dh-e2e', auth: 'auth-e2e',
    worker_id: otherWorkerId, account_id: otherAccountId,   // なりすましの試み
  })
  expect(r.body.ok, JSON.stringify(r.body)).toBe(true)
  const rows = await restSrv(`approver_push_subscriptions?endpoint=eq.${encodeURIComponent(EP)}&select=worker_id,account_id`)
  expect(rows.length).toBe(1)
  expect(rows[0].worker_id, '★本人の作業員として登録').toBe(workerId)
  expect(rows[0].account_id, '★本人の会社として登録').toBe(accountId)
  expect((await ef('approver-push-status', { endpoint: EP })).body.subscribed).toBe(true)
})

test('★他人の購読は消せない（自分の分だけ消える）', async () => {
  const theirs = `https://push.example.test/others-${TS}`
  await restSrv('approver_push_subscriptions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: otherWorkerId, endpoint: theirs, p256dh: 'x', auth: 'y' }),
  })
  await ef('approver-push-unsubscribe', { endpoint: theirs })
  expect((await restSrv(`approver_push_subscriptions?endpoint=eq.${encodeURIComponent(theirs)}&select=id`)).length, '★他人の行は残る').toBe(1)

  await ef('approver-push-unsubscribe', { endpoint: EP })
  expect((await restSrv(`approver_push_subscriptions?endpoint=eq.${encodeURIComponent(EP)}&select=id`)).length, '自分の行は消える').toBe(0)
})

test('★承認者でない作業員は登録できない（承認通知が作業員に届かない）', async () => {
  await setRole('worker')
  try {
    const st = await ef('approver-push-status', { endpoint: EP })
    expect(st.body.eligible, '作業員は対象外').toBe(false)
    const r = await ef('approver-push-subscribe', { endpoint: EP, p256dh: 'p', auth: 'a' })
    expect(r.status).toBe(403)
    expect((await restSrv(`approver_push_subscriptions?endpoint=eq.${encodeURIComponent(EP)}&select=id`)).length).toBe(0)
  } finally {
    await setRole('site_manager')
  }
})

test('カードは承認者の通知ページに出る（ホームは使えない端末では出さない）', async ({ page }) => {
  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('approver-push-settings'), '承認者には常設の欄').toBeVisible({ timeout: 20000 })
  // ローカルは VAPID 公開鍵が無い＝この端末では受け取れない、の案内になる
  await expect(page.getByTestId('approver-push-settings')).toContainText('ホーム画面に追加')

  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('approver-push-home'), '使えない端末ではホームに出さない').toHaveCount(0)
})

test('★作業員には通知ページにもカードを出さない', async ({ page }) => {
  await setRole('worker')
  try {
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('notif-tab-todo')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('approver-push-settings')).toHaveCount(0)
  } finally {
    await setRole('site_manager')
  }
})
