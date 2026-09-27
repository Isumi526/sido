// ============================================================
//  liff.worker-push.spec.ts
//  「アプリからの通知を受け取る」の購読と設定（設計「承認や申請の処理をやることで完結＋通知の統一」A-1・2026-09-27）。
//  （2026-09-24 の liff.approver-push.spec.ts ＝承認者だけ、を全員向けにしたもの）
//
//  ★実際に端末へ届くかはローカルでは見られない（VAPID鍵・プッシュサービスが無い）。実機で見る。
//   ここでは「誰の宛先として登録されるか」「種類ごとのオン/オフ」「画面の出し分け」を固定する。
//  ★守ること:
//   1. 登録先の作業員・会社は**検証済みの身元**で決まる（body で他人・他社を名乗っても無視）
//   2. 作業員も登録できる（全員向け）。「承認のお願い」の設定は承認者にだけ出す
//   3. 他人の購読は消せない
//   4. 種類ごとのオン/オフは保存され、既定は全部オン
//   5. 承認者の「やること」に承認待ちの残業申請が1行出る（作業員には出ない）
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const EP = `https://push.example.test/e2e-${TS}`
const MARK = `E2E通知設定_${TS}`
let accountId = ''
let workerId = ''
let otherWorkerId = ''
let otherAccountId = ''

test.describe.configure({ mode: 'serial' })

async function ef(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push-settings`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, dev_line_user_id: 'dev-user-id', ...payload }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
async function setRole(role: string) {
  await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: role }) })
}
async function clearPrefs() {
  await restSrv(`worker_notification_prefs?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
  workerId = u[0].worker_id
  const others = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&id=neq.${workerId}&select=id&limit=1`)
  otherWorkerId = others[0].id
  otherAccountId = (await restSrv('accounts?slug=eq.sample-construction&select=id'))[0].id
  await clearPrefs()
})
test.afterAll(async () => {
  await setRole('site_manager')
  await clearPrefs()
  await restSrv(`worker_push_subscriptions?endpoint=like.${encodeURIComponent('https://push.example.test/')}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`overtime_requests?reason=like.${encodeURIComponent(MARK)}*`, { method: 'DELETE' }).catch(() => {})
})

test('状態: 未登録・承認者（現場責任者）・種類は既定で全部オン', async () => {
  const r = await ef('status', { endpoint: EP })
  expect(r.body.ok, JSON.stringify(r.body)).toBe(true)
  expect(r.body.subscribed).toBe(false)
  expect(r.body.isApprover).toBe(true)
  expect(Object.values(r.body.prefs).every(v => v === true), '既定は全部オン').toBe(true)
})

test('★登録先は身元で決まる（body で他人・他社を名乗っても無視される）', async () => {
  const r = await ef('subscribe', {
    endpoint: EP, p256dh: 'p256dh-e2e', auth: 'auth-e2e',
    worker_id: otherWorkerId, account_id: otherAccountId,   // なりすましの試み
  })
  expect(r.body.ok, JSON.stringify(r.body)).toBe(true)
  const rows = await restSrv(`worker_push_subscriptions?endpoint=eq.${encodeURIComponent(EP)}&select=worker_id,account_id`)
  expect(rows.length).toBe(1)
  expect(rows[0].worker_id, '★本人の作業員として登録').toBe(workerId)
  expect(rows[0].account_id, '★本人の会社として登録').toBe(accountId)
  expect((await ef('status', { endpoint: EP })).body.subscribed).toBe(true)
})

test('★他人の購読は消せない（自分の分だけ消える）', async () => {
  const theirs = `https://push.example.test/others-${TS}`
  await restSrv('worker_push_subscriptions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: otherWorkerId, endpoint: theirs, p256dh: 'x', auth: 'y' }),
  })
  await ef('unsubscribe', { endpoint: theirs })
  expect((await restSrv(`worker_push_subscriptions?endpoint=eq.${encodeURIComponent(theirs)}&select=id`)).length, '★他人の行は残る').toBe(1)

  await ef('unsubscribe', { endpoint: EP })
  expect((await restSrv(`worker_push_subscriptions?endpoint=eq.${encodeURIComponent(EP)}&select=id`)).length, '自分の行は消える').toBe(0)
})

test('★作業員（承認者でない人）も登録できる（全員向け）', async () => {
  await setRole('worker')
  try {
    const st = await ef('status', { endpoint: EP })
    expect(st.body.isApprover, '作業員は承認者ではない').toBe(false)
    const r = await ef('subscribe', { endpoint: EP, p256dh: 'p', auth: 'a' })
    expect(r.body.ok, JSON.stringify(r.body)).toBe(true)
    expect((await restSrv(`worker_push_subscriptions?endpoint=eq.${encodeURIComponent(EP)}&select=id`)).length).toBe(1)
  } finally {
    await setRole('site_manager')
    await ef('unsubscribe', { endpoint: EP })
  }
})

test('★種類ごとのオン/オフが保存される（不正な種類は弾く）', async () => {
  const off = await ef('prefs-set', { kind: 'schedule', enabled: false })
  expect(off.body.ok, JSON.stringify(off.body)).toBe(true)
  expect(off.body.prefs.schedule).toBe(false)
  expect(off.body.prefs.approval, 'ほかの種類はオンのまま').toBe(true)
  expect((await ef('status')).body.prefs.schedule, '読み直しても保存されている').toBe(false)
  expect((await ef('prefs-set', { kind: 'nope', enabled: false })).status).toBe(400)
  await ef('prefs-set', { kind: 'schedule', enabled: true })
})

test('設定ページ: 種類ごとに切り替えられ、「承認のお願い」は承認者にだけ出る。メニューに「設定」がある', async ({ page }) => {
  await clearPrefs()
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('settings-kinds')).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('settings-kind-approval'), '承認者には承認のお願い').toBeVisible()
  // ローカルは VAPID 公開鍵が無い＝この端末では受け取れない、の案内になる
  await expect(page.getByTestId('settings-device-status')).toContainText('ホーム画面に追加')
  await expect(page.getByTestId('settings-password-link'), 'メールでログインしている人にはパスワード変更').toBeVisible()

  await page.getByTestId('settings-kind-chat').uncheck()
  await expect.poll(async () => (await ef('status')).body.prefs.chat, { timeout: 10000 }).toBe(false)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByTestId('settings-kind-chat'), '読み直してもオフ').not.toBeChecked({ timeout: 20000 })
  await clearPrefs()

  await setRole('worker')
  try {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('settings-kind-chat')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('settings-kind-approval'), '★作業員には承認のお願いを出さない').toHaveCount(0)
  } finally {
    await setRole('site_manager')
  }

  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('notify-push-home'), '使えない端末ではホームに案内を出さない').toHaveCount(0)
})

test('★承認者の「やること」に承認待ちの残業申請が1行出て、押し先は作業員アプリの承認画面（作業員には出ない）', async ({ page }) => {
  await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: otherWorkerId, date: '2026-09-10', status: 'pending', reason: MARK, requested_end_time: '19:00' }),
  })
  expect((await ef('badge')).body.approvalPending, '承認者には承認待ちが数えられる').toBeGreaterThanOrEqual(1)

  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click()
  const item = page.getByTestId('todo-approval-overtime')
  await expect(item).toBeVisible({ timeout: 20000 })
  await expect(item).toHaveAttribute('href', '/approvals/overtime')   // A-2: 作業員アプリの中で承認する

  await setRole('worker')
  try {
    expect((await ef('badge')).body.approvalPending, '作業員には 0').toBe(0)
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await page.getByTestId('notif-tab-todo').click()
    await expect(page.getByTestId('todo-approval-overtime')).toHaveCount(0)
  } finally {
    await setRole('site_manager')
  }
})
