// ============================================================
//  admin.punch-reminder.spec.ts
//  スケジュールの現場の開始・終了時刻に「打刻を」の通知を出す（punch-reminder EF）。
//
//  出所: 2026-08-15 「予定どおり動いているなら、予定の開始・終了時刻に打刻を促せばよい」
//  ★守ること:
//   1. 開始時刻に「出勤の打刻を」、終了時刻に「退勤の打刻を」がアプリ内通知（schedule_notifications）に残る
//   2. すでに打刻済みなら送らない（打った人にも毎日飛ぶと通知自体を切られる）
//   3. 同じ予定に二度出さない（cron が重なっても冪等）
//   4. テナントの設定が OFF（未設定）なら何もしない
//  EF は body.now（ISO）で「今」を差し替えられるので、日付固定で検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, FUNCTIONS_URL, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, ANON_KEY, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E打刻リマインド現場_${TS}`
const DATE = '2026-12-16'

let accountId = ''
let workerId = ''
let siteId = ''
let adminToken = ''
const scheduleIds: string[] = []

async function callEf(nowJst: string, lookbackMinutes = 12): Promise<any> {
  const res = await fetch(`${FUNCTIONS_URL}/punch-reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ now: `${nowJst}+09:00`, lookbackMinutes }),
  })
  return res.json()
}
async function setToggle(on: boolean) {
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_punch_reminder_enabled`, { method: 'DELETE' }).catch(() => {})
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: 'notify_punch_reminder_enabled', value: String(on), label: 'E2E' }),
  })
}
async function seedSchedule(start: string, end: string): Promise<string> {
  const rows = await restSrv('schedules', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, site_id: siteId, title: SITE, category: 'work',
      all_day: false, start_date: DATE, end_date: DATE, start_time: start, end_time: end, is_public: true,
    }),
  })
  scheduleIds.push(rows[0].id)
  return rows[0].id
}
async function notifs(scheduleId: string): Promise<any[]> {
  return restSrv(`schedule_notifications?schedule_id=eq.${scheduleId}&select=kind,title,body,link_path,worker_id&order=kind`)
}
async function clearPunches() {
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${DATE}T00:00:00%2B09:00&checked_at=lte.${DATE}T23:59:59%2B09:00`, { method: 'DELETE' }).catch(() => {})
}

test.describe('打刻リマインド（予定の開始・終了時刻）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const ws = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&limit=1`)
    workerId = ws[0].id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
    const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
    }).then(r => r.json())
    adminToken = auth.access_token
    await clearPunches()
  })
  test.afterAll(async () => {
    await clearPunches()
    if (scheduleIds.length) {
      await restSrv(`schedule_notifications?schedule_id=in.(${scheduleIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`schedules?id=in.(${scheduleIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_punch_reminder_enabled`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('設定がOFF（未設定）なら何も出さない', async () => {
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_punch_reminder_enabled`, { method: 'DELETE' }).catch(() => {})
    const sid = await seedSchedule('08:30', '17:30')
    const r = await callEf(`${DATE}T08:33:00`)
    expect(r.ok).toBe(true)
    expect(r.enabledAccounts).toBe(0)
    expect(await notifs(sid)).toHaveLength(0)
  })

  test('★開始時刻に「出勤の打刻を」、終了時刻に「退勤の打刻を」がアプリ内通知に残る', async () => {
    await setToggle(true)
    const sid = await seedSchedule('09:00', '18:00')

    // 開始時刻の直後（窓に入る）
    const r1 = await callEf(`${DATE}T09:04:00`)
    expect(r1.created, `開始の通知が1件: ${JSON.stringify(r1)}`).toBeGreaterThanOrEqual(1)
    let n = await notifs(sid)
    expect(n.map(x => x.kind)).toEqual(['punch_checkin'])
    expect(n[0].title).toContain('出勤')
    expect(n[0].body).toContain(SITE)
    expect(n[0].body).toContain('09:00')
    expect(n[0].link_path).toBe('/checkin')
    expect(n[0].worker_id, '★送信先は予定の worker_id（DBの実在行）').toBe(workerId)

    // 開始時刻からだいぶ経った時刻（窓の外）では出ない
    const rMid = await callEf(`${DATE}T13:00:00`)
    expect(rMid.created).toBe(0)

    // 終了時刻の直後
    const r2 = await callEf(`${DATE}T18:02:00`)
    expect(r2.created).toBeGreaterThanOrEqual(1)
    n = await notifs(sid)
    expect(n.map(x => x.kind)).toEqual(['punch_checkin', 'punch_checkout'])
    expect(n[1].title).toContain('退勤')
  })

  test('★同じ予定には二度出さない（cronが重なっても冪等）', async () => {
    await setToggle(true)
    const sid = await seedSchedule('10:00', '19:00')
    await callEf(`${DATE}T10:03:00`)
    const again = await callEf(`${DATE}T10:06:00`)
    expect(again.created, '2回目は作らない').toBe(0)
    expect(again.skippedDup).toBeGreaterThanOrEqual(1)
    expect((await notifs(sid)).filter(x => x.kind === 'punch_checkin')).toHaveLength(1)
  })

  test('★すでに出勤打刻があれば「出勤の打刻を」は出さない／退勤も同様', async () => {
    await setToggle(true)
    const sid = await seedSchedule('11:00', '20:00')
    await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ worker_id: workerId, site_id: siteId, type: 'checkin', checked_at: `${DATE}T10:58:00+09:00`, agreed_rule_texts: [] }),
    })
    const r1 = await callEf(`${DATE}T11:02:00`)
    expect(r1.skippedPunched).toBeGreaterThanOrEqual(1)
    expect((await notifs(sid)).filter(x => x.kind === 'punch_checkin'), '打刻済みには出さない').toHaveLength(0)

    await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ worker_id: workerId, site_id: siteId, type: 'checkout', checked_at: `${DATE}T19:55:00+09:00`, agreed_rule_texts: [] }),
    })
    await callEf(`${DATE}T20:03:00`)
    expect((await notifs(sid)).filter(x => x.kind === 'punch_checkout'), '退勤済みにも出さない').toHaveLength(0)
  })

  test('予定に時刻が無い（終日）／現場が無い予定は対象外', async () => {
    await setToggle(true)
    const rows = await restSrv('schedules', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify([
        { account_id: accountId, worker_id: workerId, site_id: siteId, title: 'E2E終日', category: 'work', all_day: true, start_date: DATE, end_date: DATE, start_time: null, end_time: null, is_public: true },
        { account_id: accountId, worker_id: workerId, site_id: null, title: 'E2E現場なし', category: 'general', all_day: false, start_date: DATE, end_date: DATE, start_time: '12:00', end_time: '13:00', is_public: true },
      ]),
    })
    for (const r of rows) scheduleIds.push(r.id)
    await callEf(`${DATE}T12:03:00`)
    for (const r of rows) expect(await notifs(r.id), `${r.title} は対象外`).toHaveLength(0)
  })

  test('管理画面の設定にトグルがあり、保存される', async ({ page }) => {
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_punch_reminder_enabled`, { method: 'DELETE' }).catch(() => {})
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const toggle = page.getByTestId('punch-reminder-toggle')
    await expect(toggle).toBeVisible({ timeout: 15000 })
    await expect(toggle, '既定はOFF').toContainText('OFF')
    await toggle.click()
    await expect(toggle).toContainText('ON')
    await expect.poll(async () => {
      const rows = await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_punch_reminder_enabled&select=value`)
      return rows?.[0]?.value ?? null
    }, { timeout: 10000 }).toBe('true')
  })
})
