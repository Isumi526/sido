// ============================================================
//  admin.reminder-trigger-auth.spec.ts
//  リマインド系 EF の起動の認可（_shared/reminder-auth.ts）。
//   対象: punch-reminder / daily-reminder / schedule-notify(remind) / faq-generate
//
//  ★出所（2026-09-24 残業リマインド実装中に発見）:
//   以前は「ログインできる人なら誰でも」起動でき、account_slug を付けなければ全社ループした。
//   本番は全員メールログイン＝作業員の誰でも全テナント分のリマインドを発火できた。
//
//  ★このテストで守ること:
//   1. 作業員の JWT・anon キー・認証なしは 401
//   2. 承認者（site_manager 以上）の JWT は通るが、対象は**自分の会社だけ**（account_slug で他社を指定しても無視）
//   3. faq-generate は cron（共有シークレット）専用。承認者の JWT でも 401
//   4. 共有シークレット（cron）は全社が対象のまま。違うシークレットは 401
//      ※3/4 のシークレット系は supabase/functions/.env に REMINDER_TRIGGER_SECRET が無いと skip
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, FUNCTIONS_URL, REMINDER_SECRET, ACCOUNT_SLUG, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PASS = 'remind-auth-1234'
const OTHER_SLUG = 'sample-construction'
const MARK = `E2E起動認可_${TS}`
const DATE = '2027-02-16'          // punch-reminder 用（他のテストと重ならない日）
const TOMORROW_OF = '2027-02-17'   // schedule-notify 前日リマインドの対象日
const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

let accountId = ''
let otherAccountId = ''
const tokens: Record<'worker' | 'approver', string> = { worker: '', approver: '' }
const authIds: string[] = []
const workerIds: string[] = []
const siteIds: string[] = []
const scheduleIds: string[] = []
const settingKeys = ['notify_punch_reminder_enabled', 'notify_schedule_mail_enabled']
const prevSettings: { account_id: string; key: string; value: string; label: string | null }[] = []

type Auth = 'worker' | 'approver' | 'anon' | 'none' | 'secret' | 'bad-secret'
async function call(fn: string, body: Record<string, unknown> | null, auth: Auth, method = 'POST') {
  const h: Record<string, string> = { apikey: ANON_KEY, 'Content-Type': 'application/json' }
  if (auth === 'worker' || auth === 'approver') h.Authorization = `Bearer ${tokens[auth]}`
  if (auth === 'anon') h.Authorization = `Bearer ${ANON_KEY}`
  if (auth === 'secret') h['x-reminder-secret'] = REMINDER_SECRET
  if (auth === 'bad-secret') h['x-reminder-secret'] = `${REMINDER_SECRET || 'x'}-wrong`
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, { method, headers: h, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}

/** 認証ユーザー＋workers 行（permission_role 指定）を作ってアクセストークンを返す */
async function makeUser(role: 'worker' | 'site_manager'): Promise<string> {
  const email = `remind-auth.${role}.${TS}@example.com`
  const u = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ email, password: PASS, email_confirm: true, app_metadata: { account_slug: ACCOUNT_SLUG } }),
  }).then(r => r.json())
  const authId = u.id ?? u.user?.id
  authIds.push(authId)
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `${MARK}_${role}`, role: 'site', permission_role: role, auth_user_id: authId, active: true, status: 'active' }),
  })
  workerIds.push(w[0].id)
  const t = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASS }),
  }).then(r => r.json())
  return t.access_token
}

async function setSetting(acc: string, key: string, value: string) {
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: acc, key, value, label: 'E2E' }),
  })
}

/** 各社に「現場つき・時刻つき」の予定を1件ずつ作る（担当は各社の既存作業員） */
async function seedSchedules(date: string, title: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const acc of [accountId, otherAccountId]) {
    const w = await restSrv(`workers?account_id=eq.${acc}&active=eq.true&select=id&limit=1`)
    const site = await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: acc, name: `${MARK}_${title}_現場`, active: true }),
    })
    siteIds.push(site[0].id)
    const s = await restSrv('schedules', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: acc, worker_id: w[0].id, site_id: site[0].id, title: `${MARK}_${title}`, category: 'work',
        all_day: false, start_date: date, end_date: date, start_time: '08:00', end_time: '17:00', is_public: true }),
    })
    scheduleIds.push(s[0].id)
    out[acc] = s[0].id
  }
  return out
}
const notifCount = async (scheduleId: string) =>
  (await restSrv(`schedule_notifications?schedule_id=eq.${scheduleId}&select=id`)).length

test.describe('リマインド系 EF の起動の認可', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    accountId = await getAccountId()
    otherAccountId = (await restSrv(`accounts?slug=eq.${OTHER_SLUG}&select=id`))[0].id
    tokens.worker = await makeUser('worker')
    tokens.approver = await makeUser('site_manager')
    expect(tokens.worker && tokens.approver, 'テスト用のログインが作れる').toBeTruthy()
    // 両社の通知設定を ON にする（既存値は退避して後で戻す）
    for (const acc of [accountId, otherAccountId]) {
      for (const key of settingKeys) {
        const cur = await restSrv(`settings?account_id=eq.${acc}&key=eq.${key}&select=account_id,key,value,label`)
        if (cur.length) prevSettings.push(cur[0])
        await setSetting(acc, key, 'true')
      }
    }
  })

  test.afterAll(async () => {
    if (scheduleIds.length) {
      await restSrv(`schedule_notifications?schedule_id=in.(${scheduleIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`schedules?id=in.(${scheduleIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
    }
    if (siteIds.length) await restSrv(`sites?id=in.(${siteIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
    for (const acc of [accountId, otherAccountId]) {
      for (const key of settingKeys) await restSrv(`settings?account_id=eq.${acc}&key=eq.${key}`, { method: 'DELETE' }).catch(() => {})
    }
    for (const p of prevSettings) await setSetting(p.account_id, p.key, p.value).catch(() => {})
    for (const id of workerIds) await restSrv(`workers?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    for (const id of authIds) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: srvHeaders }).catch(() => {})
  })

  test('★作業員の JWT・anon キー・認証なしでは、4本とも起動できない（401）', async () => {
    const cases: [string, Record<string, unknown>, string?][] = [
      ['punch-reminder', { now: `${DATE}T08:05:00+09:00` }],
      ['daily-reminder', { dry_run: true, manual: true }],
      ['daily-reminder', {}, 'GET'],
      ['schedule-notify', { action: 'remind', target_date: TOMORROW_OF, force: true }],
      ['faq-generate', { dry_run: true }],
    ]
    for (const [fn, body, method] of cases) {
      for (const auth of ['worker', 'anon', 'none'] as const) {
        const r = await call(fn, method === 'GET' ? null : body, auth, method)
        expect(r.status, `${fn}${method === 'GET' ? '(GET)' : ''} を ${auth} で叩くと 401: ${JSON.stringify(r.body)}`).toBe(401)
      }
    }
  })

  test('★punch-reminder: 承認者の手動実行は自分の会社の予定だけに通知する', async () => {
    const ids = await seedSchedules(DATE, 'punch')
    const r = await call('punch-reminder', { now: `${DATE}T08:05:00+09:00`, lookbackMinutes: 12 }, 'approver')
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.enabledAccounts, '★ON の会社が2社あっても自分の会社1社だけ').toBe(1)
    expect(await notifCount(ids[accountId]), '自分の会社の予定には出る').toBe(1)
    expect(await notifCount(ids[otherAccountId]), '★他社の予定には出ない').toBe(0)
  })

  test('★schedule-notify(remind): 承認者の手動実行は自分の会社の予定だけに通知する', async () => {
    const ids = await seedSchedules(TOMORROW_OF, 'remind')
    const r = await call('schedule-notify', { action: 'remind', target_date: TOMORROW_OF, force: true }, 'approver')
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.ranAccounts, '★自分の会社1社だけ').toBe(1)
    expect(await notifCount(ids[accountId]), '自分の会社の予定には出る').toBe(1)
    expect(await notifCount(ids[otherAccountId]), '★他社の予定には出ない').toBe(0)
  })

  test('★daily-reminder: 承認者は自分の会社だけ（account_slug で他社を指定しても無視）', async () => {
    const g = await call('daily-reminder', null, 'approver', 'GET')
    expect(g.status).toBe(200)
    expect((g.body as any[]).map(x => x.slug), '★設定の一覧も自分の会社だけ').toEqual([ACCOUNT_SLUG])

    // daily-reminder は slug='test' を対象外にしている。自分の会社(test)に絞った上で他社指定は無視されるので、
    // 他社が走っていれば 200・正しく絞れていれば「対象なし」の 404 になる。
    const p = await call('daily-reminder', { dry_run: true, manual: true, account_slug: OTHER_SLUG }, 'approver')
    if (ACCOUNT_SLUG === 'test') {
      expect(p.status, `★他社を指定しても他社は走らない: ${JSON.stringify(p.body)}`).toBe(404)
    } else {
      expect(p.status).toBe(200)
      expect((p.body.results as any[]).map(x => x.slug)).toEqual([ACCOUNT_SLUG])
    }
  })

  test('★faq-generate は cron 専用（承認者の JWT でも起動できない）', async () => {
    const r = await call('faq-generate', { dry_run: true }, 'approver')
    expect(r.status, JSON.stringify(r.body)).toBe(401)
  })

  test('共有シークレット（cron）は全社が対象のまま・違うシークレットは 401', async () => {
    test.skip(!REMINDER_SECRET, 'supabase/functions/.env に REMINDER_TRIGGER_SECRET が無い（ローカルで設定して functions serve を起動し直す）')

    for (const fn of ['punch-reminder', 'daily-reminder', 'schedule-notify', 'faq-generate']) {
      const bad = await call(fn, { action: 'remind', dry_run: true }, 'bad-secret')
      expect(bad.status, `${fn}: 違うシークレットは 401`).toBe(401)
    }

    // punch: 他社の予定にも出る（cron は全社）
    const [pOwn, pOther] = [scheduleIds[0], scheduleIds[1]]
    await restSrv(`schedule_notifications?schedule_id=in.(${pOwn},${pOther})`, { method: 'DELETE' })
    const p = await call('punch-reminder', { now: `${DATE}T08:05:00+09:00`, lookbackMinutes: 12 }, 'secret')
    expect(p.status, JSON.stringify(p.body)).toBe(200)
    expect(p.body.enabledAccounts, 'cron は ON の全社').toBeGreaterThanOrEqual(2)
    expect(await notifCount(pOther), 'cron なら他社の予定にも出る').toBe(1)

    // daily: 他社を指定して回せる
    const d = await call('daily-reminder', { dry_run: true, manual: true, account_slug: OTHER_SLUG }, 'secret')
    expect(d.status, JSON.stringify(d.body)).toBe(200)
    expect((d.body.results as any[]).map(x => x.slug)).toEqual([OTHER_SLUG])

    // faq: 認可は通る（ローカルは Notion/Gemini 未設定なので 503 で止まる＝401 でなければよい）
    const f = await call('faq-generate', { dry_run: true }, 'secret')
    expect(f.status, `faq-generate は cron なら認可を通る: ${JSON.stringify(f.body)}`).not.toBe(401)
  })
})
