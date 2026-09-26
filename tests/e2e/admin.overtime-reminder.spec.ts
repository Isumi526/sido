// ============================================================
//  admin.overtime-reminder.spec.ts
//  未決裁の残業申請を承認者へまとめてリマインドする（A-2・2026-09-24）。
//
//  出所（2026-09-23 お客様報告）: 申請時の通知はメール1通きりで、締切前申請の36%が翌日以降の承認。
//   → 1日2回（16:05 締切直後／17:30 日報の時間帯）会社ごとにまとめて1通。
//
//  ★このテストで守ること:
//   1. 会社×日×時間帯で1回だけ（cron の再実行・手動実行で何通も出ない）
//   2. 手動実行（承認者JWT）は**自分の会社だけ**。他テナントの申請を催促しない
//      （認可は _shared/reminder-auth。全4本の認可は admin.reminder-trigger-auth.spec.ts）
//   3. 承認依頼メールの設定(notify_approval_request_enabled=false)の会社には送らない
//   4. 認証なしは弾く
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, ACCOUNT_SLUG, todayJST } from './helpers'

const MARK = `E2E残業リマインド_${Date.now()}`
const OTHER_SLUG = 'sample-construction'
let accountId = ''
let otherAccountId = ''
let token = ''

test.describe.configure({ mode: 'serial' })

async function remind(body: Record<string, unknown>, auth: 'admin' | 'none' = 'admin') {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/overtime-reminder`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY, 'Content-Type': 'application/json',
      ...(auth === 'admin' ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
async function clearLogs() {
  await restSrv(`reminder_logs?account_id=eq.${accountId}&kind=like.overtime_pending_*&target_date=eq.${todayJST()}`, { method: 'DELETE' }).catch(() => {})
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  otherAccountId = (await restSrv(`accounts?slug=eq.${OTHER_SLUG}&select=id`))[0].id
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  token = (await auth.json()).access_token

  for (const [acc, reason] of [[accountId, MARK], [otherAccountId, `${MARK}_他社`]] as const) {
    const w = await restSrv(`workers?account_id=eq.${acc}&active=eq.true&select=id&limit=1`)
    await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: acc, worker_id: w[0].id, date: '2026-09-10', status: 'pending', reason, requested_end_time: '19:00' }),
    })
  }
  await clearLogs()
})
test.afterAll(async () => {
  await restSrv(`overtime_requests?reason=like.${encodeURIComponent(MARK)}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_approval_request_enabled`, { method: 'DELETE' }).catch(() => {})
  await clearLogs()
})

test('認証なしでは起動できない', async () => {
  const r = await remind({ slot: 'after_deadline', dry_run: true }, 'none')
  expect(r.status).toBe(401)
})

test('★承認者の手動実行は自分の会社だけが対象（他テナントの申請は催促しない）', async () => {
  // account_slug で他社を指定しても無視されること
  const r = await remind({ slot: 'after_deadline', dry_run: true, account_slug: OTHER_SLUG })
  expect(r.status).toBe(200)
  const results = r.body.results as any[]
  expect(results.map(x => x.slug), '★自分の会社1社だけ').toEqual([ACCOUNT_SLUG])
  expect(results[0].pending, '仕込んだ承認待ちが数えられている').toBeGreaterThanOrEqual(1)
  expect(results[0].dry_run).toBe(true)
  const logs = await restSrv(`reminder_logs?account_id=eq.${accountId}&kind=like.overtime_pending_*&target_date=eq.${todayJST()}&select=id`)
  expect(logs.length, 'dry_run は記録しない').toBe(0)
})

test('★同じ会社×日×時間帯は1回だけ（2回目は already_sent）', async () => {
  await clearLogs()
  const first = await remind({ slot: 'evening' })
  expect(first.status).toBe(200)
  const r1 = (first.body.results as any[])[0]
  expect(r1.skipped, `1回目は送る: ${JSON.stringify(r1)}`).toBeUndefined()
  const logs = await restSrv(`reminder_logs?account_id=eq.${accountId}&kind=eq.overtime_pending_evening&target_date=eq.${todayJST()}&select=unsubmitted_count,result`)
  expect(logs.length, '記録が1行残る').toBe(1)
  expect(logs[0].unsubmitted_count).toBeGreaterThanOrEqual(1)

  const second = await remind({ slot: 'evening' })
  expect((second.body.results as any[])[0].skipped, '★2回目は送らない').toBe('already_sent')

  // 時間帯が違えば別枠（16:05 と 17:30 はそれぞれ1回）
  const other = await remind({ slot: 'after_deadline' })
  expect((other.body.results as any[])[0].skipped, '別の時間帯は送る').toBeUndefined()
})

test('承認依頼メールをオフにしている会社には送らない', async () => {
  await clearLogs()
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({ account_id: accountId, key: 'notify_approval_request_enabled', value: 'false', label: '承認依頼メール' }),
  })
  const r = await remind({ slot: 'evening', dry_run: true })
  expect((r.body.results as any[])[0].skipped).toBe('disabled')
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_approval_request_enabled`, { method: 'DELETE' })
})

// ★A-3: プッシュは「送る時点で承認者の人」の端末だけ。購読した後に権限が外れた人へは届かない。
//  ローカルは VAPID 鍵が無いので実配信はせず（skipped=no_vapid）、宛先の数(targets)で確かめる。
test('★プッシュは送る時点で承認者の端末だけ（権限が外れた人の古い購読には送らない）', async () => {
  const u = await restSrv('users?line_user_id=eq.dev-user-id&select=worker_id')
  const wid = u[0].worker_id
  const ep = `https://push.example.test/reminder-${Date.now()}`
  await restSrv('approver_push_subscriptions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: wid, endpoint: ep, p256dh: 'p', auth: 'a' }),
  })
  try {
    await clearLogs()
    const r1 = (await remind({ slot: 'evening' })).body.results[0]
    expect(r1.push.targets, '現場責任者（承認者）の端末は宛先').toBe(1)

    await restSrv(`workers?id=eq.${wid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: 'worker' }) })
    await clearLogs()
    const r2 = (await remind({ slot: 'evening' })).body.results[0]
    expect(r2.push.targets, '★権限が外れたら古い購読には送らない').toBe(0)
  } finally {
    await restSrv(`workers?id=eq.${wid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: 'site_manager' }) })
    await restSrv(`approver_push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE' }).catch(() => {})
  }
})
