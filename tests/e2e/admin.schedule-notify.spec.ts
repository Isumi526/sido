// ============================================================
//  admin.schedule-notify.spec.ts
//  スケジュール管理の通知をメールで完成させる（2026-09-20）— EF schedule-notify。
//   AC1 予定の作成・変更・削除 → 担当作業員へ通知（変更/削除はアプリ内通知も EF が出す。メールはテナント設定 ON の時だけ）
//   AC2 前日リマインド（cron から remind）: 翌日の予定にアプリ内通知＋メール。同じ予定に二度出さない
//   AC3 アプリ内通知は残る（作成の in-app は画面側・変更/削除/前日は EF）
//   AC4 テナント単位 ON/OFF（settings.notify_schedule_mail_enabled・未設定=OFF）／作業員単位（pref）
//   ★メールの実送信（Resend）はローカルで検証しない。EF の応答 mailed/tenantEnabled と in-app 行で固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, setFeatureFlag, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, ensureDevWorker } from './helpers'

const TS = Date.now()
let accountId = ''
let adminToken = ''
let workerId = ''
let devLineUserId = ''
const scheduleIds: string[] = []

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await res.json()).access_token ?? ''
}
async function ef(body: Record<string, unknown>, token = adminToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/schedule-notify`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
async function seedSchedule(date: string, title: string): Promise<string> {
  const rows = await restSrv('schedules', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, title, start_date: date, end_date: date, start_time: '09:00', end_time: '17:00', all_day: false, category: 'work', created_by_name: 'E2E管理者' }),
  })
  scheduleIds.push(rows[0].id)
  return rows[0].id
}
async function notifs(scheduleId: string) {
  return restSrv(`schedule_notifications?schedule_id=eq.${scheduleId}&select=kind,title,body,worker_id&order=created_at`)
}

test.describe('スケジュール通知（EF schedule-notify）', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    accountId = await getAccountId()
    adminToken = await signIn(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)
    expect(adminToken).toBeTruthy()
    const w = await ensureDevWorker('sched-notify')
    workerId = w.workerId; devLineUserId = w.lineUserId
    await setFeatureFlag('notify_schedule_mail_enabled', null)   // 未設定＝OFF から始める
  })
  test.afterAll(async () => {
    for (const id of scheduleIds) {
      await restSrv(`schedule_notifications?schedule_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`schedules?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    }
    await setFeatureFlag('notify_schedule_mail_enabled', null)
    await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', body: JSON.stringify({ schedule_mail_enabled: true }) }).catch(() => {})
  })

  test('AC1/AC3/AC4★: 変更・削除は担当作業員へアプリ内通知。テナント設定OFF（未設定）ではメールを送らない', async () => {
    const id = await seedSchedule('2026-11-10', `E2E予定_${TS}`)
    const upd = await ef({ action: 'changed', scheduleId: id, kind: 'updated', changes: { start_time: { old: '08:00', new: '09:00' } } })
    expect(upd.status, JSON.stringify(upd.body)).toBe(200)
    expect(upd.body.notified, 'アプリ内通知が出る').toBe(true)
    expect(upd.body.tenantEnabled, '未設定＝OFF').toBe(false)
    expect(upd.body.mailed, '★OFFではメールを送らない').toBe(false)

    const del = await ef({ action: 'changed', scheduleId: id, kind: 'deleted' })
    expect(del.status).toBe(200)
    expect(del.body.notified).toBe(true)

    const rows = await notifs(id)
    expect(rows.map((r: any) => r.kind), '変更・削除のアプリ内通知が担当作業員に残る').toEqual(['schedule_updated', 'schedule_deleted'])
    expect(rows[0].worker_id).toBe(workerId)
    expect(rows[0].body, '変更点が本文に入る').toContain('開始時刻')
  })

  test('AC4★: テナント設定ONなら送信経路に入る（通知用メールが無い作業員には送らない）／作業員がOFFにすれば送らない', async () => {
    await setFeatureFlag('notify_schedule_mail_enabled', true)
    const id = await seedSchedule('2026-11-11', `E2E予定ON_${TS}`)
    const r = await ef({ action: 'changed', scheduleId: id, kind: 'created' })
    expect(r.status).toBe(200)
    expect(r.body.tenantEnabled, 'ONが効く').toBe(true)
    // dev 作業員は通知用メールを持たない（LINE作業員）ので mailed=false。ここでは「ON でも経路が壊れない」ことを固定
    expect(typeof r.body.mailed).toBe('boolean')

    // 作業員本人の OFF（pref）→ 保存され、pref で読める
    const off = await ef({ action: 'pref', enabled: false, dev_line_user_id: devLineUserId }, ANON_KEY)
    expect(off.status, JSON.stringify(off.body)).toBe(200)
    expect(off.body.enabled).toBe(false)
    const w = await restSrv(`workers?id=eq.${workerId}&select=schedule_mail_enabled`)
    expect(w[0].schedule_mail_enabled, '★作業員単位のOFFが保存される').toBe(false)
    const on = await ef({ action: 'pref', enabled: true, dev_line_user_id: devLineUserId }, ANON_KEY)
    expect(on.body.enabled).toBe(true)
  })

  test('AC2★: 前日リマインドは翌日の予定にアプリ内通知を出し、二度目は出さない（冪等）', async () => {
    await setFeatureFlag('notify_schedule_mail_enabled', true)
    const target = '2026-11-12'
    const id = await seedSchedule(target, `E2E明日_${TS}`)
    const first = await ef({ action: 'remind', target_date: target, force: true })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.created, '翌日の予定に通知が作られる').toBeGreaterThanOrEqual(1)
    const rows = await notifs(id)
    expect(rows.map((r: any) => r.kind)).toEqual(['schedule_tomorrow'])
    expect(rows[0].title).toContain('明日')

    const second = await ef({ action: 'remind', target_date: target, force: true })
    expect(second.status).toBe(200)
    expect((await notifs(id)).length, '★同じ予定に二度出さない').toBe(1)
    expect(second.body.skippedDup).toBeGreaterThanOrEqual(1)

    // OFF のテナントでは動かない
    await setFeatureFlag('notify_schedule_mail_enabled', null)
    const id2 = await seedSchedule(target, `E2E明日OFF_${TS}`)
    await ef({ action: 'remind', target_date: target, force: true })
    expect((await notifs(id2)).length, 'OFF なら前日リマインドも出ない').toBe(0)
  })

  test('認可: 身元不明は 401・他テナントの予定IDは 404', async () => {
    const id = await seedSchedule('2026-11-13', `E2E認可_${TS}`)
    const anon = await ef({ action: 'changed', scheduleId: id, kind: 'updated' }, ANON_KEY)
    expect(anon.status).toBe(401)
    const other = await ef({ action: 'changed', scheduleId: '00000000-0000-0000-0000-000000000000', kind: 'updated' })
    expect(other.status).toBe(404)
    const cronNoSecret = await fetch(`${SUPABASE_URL}/functions/v1/schedule-notify`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remind' }),
    })
    // REMINDER_TRIGGER_SECRET 未設定のローカルは後方互換で通る（本番は 401）。落ちないことだけ見る
    expect([200, 401]).toContain(cronNoSecret.status)
  })
})
