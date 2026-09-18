// ============================================================
//  liff.night-only-site.spec.ts
//  夜のみ現場（例 20:30〜翌6:00・平和不動産）で日跨ぎの定時と打刻が壊れないこと。
//
//  出所（2026-09-10 SEED 会議・大塚さん）「20時から翌朝3時までというのがたまにある」
//  決定（2026-09-12）: 作業区分は増やさず、現場×区分の定時に夜間帯を入れて表現する。
//
//  ★守ること:
//   1. 翌朝の退勤のあと「日報を書く」が**出勤した日**の日報に飛ぶ（翌日に飛ばない）
//   2. 夜勤明けの朝、ホームが今日を「退勤したのに日報が無い」と急かさない（前日ぶんとして扱う）
//   3. 未提出バッジが翌朝の退勤で「今日」を数えない
//   4. 週カレンダーで日跨ぎ予定の帯が潰れない（当日は24:00まで・翌日側に続き）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, suppressOverdueModal } from './helpers'

const TS = Date.now()
const SITE = `E2E夜のみ現場_${TS}`
const ymd = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() - n * 86400000))
const TODAY = ymd(0)
const YESTERDAY = ymd(1)

test.use({ geolocation: { latitude: 35.6812, longitude: 139.7671 }, permissions: ['geolocation'] })

let accountId = ''
let userId = ''
let workerId = ''
let siteId = ''

async function clearState() {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=in.(${YESTERDAY},${TODAY})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${YESTERDAY}T00:00:00%2B09:00`, { method: 'DELETE' }).catch(() => {})
}
async function seedPunch(type: 'checkin' | 'checkout', date: string, hhmm: string) {
  await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ worker_id: workerId, site_id: siteId, type, agreed_rule_texts: [], backdated: false,
      checked_at: new Date(`${date}T${hhmm}:00+09:00`).toISOString() }),
  })
}
/** 直近数日を提出済みにして、起動時の未提出割り込みが被らないようにする（昨日・今日は除く） */
async function fillBacklog() {
  for (const n of [2, 3, 4, 5]) {
    await restSrv('daily_reports?on_conflict=user_id,date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: userId, date: ymd(n), is_working: false, sites: [], note: 'E2E:前提' }),
    }).catch(() => {})
  }
}

test.describe('夜のみ現場（日跨ぎ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true, default_start_time: '20:30', default_end_time: '06:00',
        default_breaks: [{ start: '00:00', minutes: 60 }] }),
    }))[0].id
    await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ report_start_date: ymd(5) }) })
  })
  test.beforeEach(async () => { await clearState(); await fillBacklog() })
  test.afterAll(async () => {
    await clearState()
    await restSrv(`daily_reports?user_id=eq.${userId}&note=eq.E2E:前提`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ report_start_date: ymd(2) }) }).catch(() => {})
  })

  test('★翌朝の退勤のあと「日報を書く」は出勤した日（前日）の日報に飛ぶ', async ({ page }) => {
    // 昨日 20:30 に出勤したまま（退勤未）。今朝これから退勤する
    await seedPunch('checkin', YESTERDAY, '20:30')
    await page.goto('/checkin', { waitUntil: 'networkidle' })
    const rules = page.locator('.rule-row')
    for (let i = 0, n = await rules.count(); i < n; i++) await rules.nth(i).click()
    await page.locator('.loc-get').first().click()
    const submit = page.getByRole('button', { name: '退勤を記録する' }).last()
    await expect(submit).toBeEnabled({ timeout: 20000 })
    await submit.click()
    await page.waitForURL(/\/report\?date=/, { timeout: 20000 })
    expect(page.url(), '★出勤した日（昨日）の日報。翌日ではない').toContain(`date=${YESTERDAY}`)
  })

  test('★夜勤明けの朝、ホームは今日を「退勤したのに日報が無い」と急かさず、前日ぶんの日報へ誘導する', async ({ page }) => {
    await seedPunch('checkin', YESTERDAY, '20:30')
    await seedPunch('checkout', TODAY, '06:02')
    // 前日ぶんが未提出なので起動時の割り込み（未提出モーダル）は出る。ここの主題はカードなので抑える
    await suppressOverdueModal(page)
    await page.goto('/', { waitUntil: 'networkidle' })
    const card = page.getByTestId('home-today-card')
    await expect(card).toBeVisible({ timeout: 20000 })
    // 前日ぶんの日報が無い＝report-due だが、リンク先は前日
    await expect(card).toHaveClass(/report-due/)
    await page.getByTestId('today-act-report').click()
    await expect(page, '★前日の日報へ').toHaveURL(new RegExp(`/report\\?date=${YESTERDAY}`))
  })

  test('★前日ぶんの日報を出してあれば、夜勤明けの朝は「完了」扱い（今日ぶんを催促しない）', async ({ page }) => {
    await seedPunch('checkin', YESTERDAY, '20:30')
    await seedPunch('checkout', TODAY, '06:02')
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: userId, date: YESTERDAY, is_working: true, note: 'E2E夜勤',
        sites: [{ siteName: SITE, site_id: siteId, subcontractors: [], workers: [{ workerName: 'Worker 01', workerId, startTime: '20:30', endTime: '06:00' }],
          expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] } }] }),
    })
    await page.goto('/', { waitUntil: 'networkidle' })
    const card = page.getByTestId('home-today-card')
    await expect(card).toBeVisible({ timeout: 20000 })
    await expect(card, '★前日の回は日報済み＝急かさない').not.toHaveClass(/report-due/)
    // 未提出バッジ（日報履歴）も今日ぶんを数えない（今日はまだ出勤していない・前日は提出済み）
    await expect(page.getByTestId('bottom-nav-badge-history')).toHaveCount(0)
  })

  test('★週カレンダーで日跨ぎ予定の帯が潰れず、翌日側に続きが出る', async ({ page }) => {
    const rows = await restSrv('schedules', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, site_id: siteId, title: SITE, category: 'work',
        all_day: false, start_date: TODAY, end_date: TODAY, start_time: '20:30', end_time: '06:00', is_public: true, is_night_shift: true }),
    })
    try {
      await page.goto('/calendar', { waitUntil: 'networkidle' })
      await page.locator('.cal-tab', { hasText: '個人' }).click()
      await expect(page.locator('.personal-week-scroll')).toBeVisible({ timeout: 10000 })
      const chip = page.locator('.week-timed-chip', { hasText: SITE }).first()
      await expect(chip).toBeVisible({ timeout: 20000 })
      const h = await chip.evaluate(el => (el as HTMLElement).offsetHeight)
      expect(h, '★20:30〜24:00 の帯（以前は30分ぶんに潰れていた）').toBeGreaterThan(60)
      await expect(chip, '翌が付く').toContainText('翌06:00')
      await expect(page.getByTestId('week-overnight-cont').first(), '翌日側の続き').toBeVisible()
    } finally {
      await restSrv(`schedules?id=eq.${rows[0].id}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})
