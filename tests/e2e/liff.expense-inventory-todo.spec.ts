// ============================================================
//  liff.expense-inventory-todo.spec.ts
//  経費精算の申請・在庫の確認待ちを、管理者・役員/経理の「やること」に件数で出し、申請時に通知する
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-5・2026-10-02）。
//
//  ★守ること:
//   1. 管理者・役員/経理の「やること」に「経費精算の申請 N件」「在庫の確認待ち N件」。数はアイコンの数字と同じ
//   2. 押すと同じドメインの管理画面の該当ページ（/admin/expenses・/admin/inventory）が開く（処理は管理画面・確認事項#2=A）
//   3. 現場責任者・作業員には出さない（経営・経理の画面は開けない）。在庫は機能を使っている会社だけ
//   4. 申請時に管理者・役員/経理の端末へ通知（申請者本人と現場責任者には送らない）
//   ※ローカルは VAPID 鍵が無いので実配信はせず（skipped=no_vapid）、宛先の数(targets)で確かめる
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId, workerSession, setFeatureFlag, enableInventoryFeature, FEATURE_KEY_INVENTORY, FUNCTIONS_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const MARK = `E2E経費在庫やること_${TS}`
const PERIOD = '2026-02-first'

let accountId = ''
let meWorkerId = ''
let otherWorkerId = ''
let otherUserId = ''
const pendingIds: string[] = []
const subEndpoint = `https://push.example.test/a5-${TS}`

test.describe.configure({ mode: 'serial' })

async function setRole(role: string) {
  await restSrv(`workers?id=eq.${meWorkerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: role }) })
}
async function ef(fn: string, workerId: string | null, payload: Record<string, unknown>) {
  const token = workerId ? (await workerSession(workerId)).access_token : ANON_KEY
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}
async function badge() { return (await ef('push-settings', meWorkerId, { action: 'badge' })).body }
async function countApplied(): Promise<number> {
  return (await restSrv(`expense_settlements?account_id=eq.${accountId}&status=eq.${encodeURIComponent('申請中')}&select=id`)).length
}
async function countInventoryPending(): Promise<number> {
  return (await restSrv(`inventory_pending_moves?account_id=eq.${accountId}&status=eq.pending&select=id`)).length
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  meWorkerId = await devUserWorkerId()
  const users = await restSrv(`users?account_id=eq.${accountId}&worker_id=not.is.null&worker_id=neq.${meWorkerId}&select=id,worker_id`)
  const active = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&permission_role=eq.worker&id=in.(${users.map((u: any) => u.worker_id).join(',')})&select=id`)
  const u = users.find((x: any) => active.some((w: any) => w.id === x.worker_id))
  otherUserId = u.id
  otherWorkerId = u.worker_id
  await enableInventoryFeature()
  await setRole('office')
  // 自分（役員/経理）の端末の購読（宛先の数で通知を確かめる）
  await restSrv('worker_push_subscriptions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: meWorkerId, endpoint: subEndpoint, p256dh: 'p', auth: 'a' }),
  })
})
test.afterAll(async () => {
  await setRole('site_manager')
  await enableInventoryFeature()
  await restSrv(`expense_settlements?user_id=eq.${otherUserId}&period_key=eq.${PERIOD}`, { method: 'DELETE' }).catch(() => {})
  if (pendingIds.length) await restSrv(`inventory_pending_moves?id=in.(${pendingIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`inventory_pending_moves?note=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.inventory_confirm_role`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`worker_push_subscriptions?endpoint=eq.${encodeURIComponent(subEndpoint)}`, { method: 'DELETE' }).catch(() => {})
})

test('★経費精算: 申請すると役員/経理の端末へ通知され、やることに件数が出て、押すと管理画面の経費精算が開く', async ({ page }) => {
  // 作業員が申請（アプリは精算行を「申請中」にしてから、この EF を呼ぶ）
  await restSrv('expense_settlements?on_conflict=account_id,user_id,period_key', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, user_id: otherUserId, period_key: PERIOD, status: '申請中', applied_at: new Date().toISOString(), notified_at: null }),
  })
  const sent = await ef('test-send-expense-application', otherWorkerId, { user_id: otherUserId, period_key: PERIOD })
  expect(sent.status, JSON.stringify(sent.body)).toBe(200)
  expect(sent.body.push, '通知の結果を返す').toBeTruthy()
  expect(sent.body.push.targets, '★役員/経理（自分）の端末が宛先').toBeGreaterThanOrEqual(1)

  const b = await badge()
  expect(b.expensePending, 'やることの数＝申請中の件数').toBe(await countApplied())
  expect(b.expensePending).toBeGreaterThanOrEqual(1)

  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click()
  const todo = page.getByTestId('todo-admin-expense')
  await expect(todo).toBeVisible({ timeout: 20000 })
  await expect(todo, '★押し先は同じドメインの管理画面（ログインしたまま開く）').toHaveAttribute('href', '/admin/expenses')
  await expect(todo).toContainText(`${b.expensePending}件`)
})

test('経費精算: 現場責任者・作業員には出さず通知もしない／処理されたら減る', async () => {
  await setRole('site_manager')
  try {
    expect((await badge()).expensePending, '現場責任者には出さない（経費精算の画面を開けない）').toBe(0)
    await restSrv(`expense_settlements?user_id=eq.${otherUserId}&period_key=eq.${PERIOD}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ notified_at: null }),
    })
    const sent = await ef('test-send-expense-application', otherWorkerId, { user_id: otherUserId, period_key: PERIOD })
    expect(sent.body.push.targets, '★現場責任者の端末には送らない').toBe(0)
    await setRole('worker')
    expect((await badge()).expensePending).toBe(0)
  } finally {
    await setRole('office')
  }
  const before = (await badge()).expensePending
  await restSrv(`expense_settlements?user_id=eq.${otherUserId}&period_key=eq.${PERIOD}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: '支払い済み' }),
  })
  expect((await badge()).expensePending, '処理されたら減る').toBe(before - 1)
})

test('★在庫: 事務が確認する会社で作業員が登録すると役員/経理へ通知され、やることに件数が出て、押すと管理画面の在庫が開く', async ({ page }) => {
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: 'inventory_confirm_role', value: 'office', label: 'E2E' }),
  })
  const moved = await ef('inventory', otherWorkerId, {
    action: 'move', kind: 'in', qty: 3, photoUrls: ['https://example.test/a5.png'], note: MARK, clientRequestId: crypto.randomUUID(),
  })
  expect(moved.status, JSON.stringify(moved.body)).toBe(200)
  expect(moved.body.pending).toBe(true)
  pendingIds.push(moved.body.pendingId)
  expect(moved.body.push.targets, '★役員/経理（自分）の端末が宛先').toBeGreaterThanOrEqual(1)

  const b = await badge()
  expect(b.inventoryPending, 'やることの数＝確認待ちの件数').toBe(await countInventoryPending())

  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click()
  const todo = page.getByTestId('todo-admin-inventory')
  await expect(todo).toBeVisible({ timeout: 20000 })
  await expect(todo).toHaveAttribute('href', '/admin/inventory')
})

test('在庫: 機能を使っていない会社・現場責任者には出さない', async () => {
  await setFeatureFlag(FEATURE_KEY_INVENTORY, false)
  try {
    expect((await badge()).inventoryPending, '在庫の機能がオフなら出さない').toBe(0)
  } finally {
    await enableInventoryFeature()
  }
  await setRole('site_manager')
  try {
    expect((await badge()).inventoryPending).toBe(0)
  } finally {
    await setRole('office')
  }
})
