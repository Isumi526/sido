// ============================================================
//  liff.punch-backdate.spec.ts
//  打刻を忘れた日を、あとから遡って入力できる。
//
//  出所（2026-08-10 大塚さんとの電話・逐語）:
//   「次の日でも別に今までと同じような感じで、4日前まできればいいんじゃない？3日前か」
//   「出勤するのを忘れたとしても…18時だとしても、出勤するよってすぐ〔打刻〕して、
//     実際に時間を打ち込む」
//
//  ★このテストで守ること:
//   ・遡り分が「あとから入力した」と分かる形（backdated=true）で残ること。
//     打刻は UPDATE/DELETE を禁止した追記専用の記録で、その場で押したものと
//     後付けを混同すると勤怠の証跡として使えなくなる。
//   ・際限なく後付けできないこと（4日より前は選べない）。
//
//  ★2026-08-27 出退勤モデル変更: 打刻が現場に紐づかなくなった（1日＝最初の出勤・
//   最後の退勤の2回）。現場の選択欄は無くなり、重複判定も「日付×種別」になった。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E遡り打刻現場_${TS}`

let accountId = ''
let siteId = ''
let workerId = ''

/** JSTの YYYY-MM-DD（n日前） */
function jstDay(n: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
    .format(new Date(Date.now() - n * 24 * 60 * 60 * 1000))
}

async function punchesOf(date: string) {
  const lo = new Date(`${date}T00:00:00+09:00`).toISOString()
  const hi = new Date(`${date}T23:59:59+09:00`).toISOString()
  return await restSrv(
    `attendance_logs?worker_id=eq.${workerId}` +
    `&checked_at=gte.${encodeURIComponent(lo)}&checked_at=lte.${encodeURIComponent(hi)}` +
    `&select=type,checked_at,backdated,agreed_rule_texts&order=checked_at`)
}

test.describe('打刻を忘れた日の遡り入力', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    workerId = (await rest('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
  })

  test.beforeEach(async () => {
    // ★このワーカーの直近の打刻を全部消す。他の spec が別現場で出勤打刻を残していると
    //   /checkin が「出勤中」専用画面で開き、前提が変わってしまう（実際に踏んだ）。
    const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
    await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(since)}`,
      { method: 'DELETE' }).catch(() => {})
    // 遡り対象日（今日〜4日前）も消す。現場で絞れなくなったので日付範囲で消す。
    const lo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(lo)}`,
      { method: 'DELETE' }).catch(() => {})
  })

  test.afterAll(async () => {
    // ★全期間を消さない。global-setup が積んだ当月のFEAT_ATT打刻まで巻き込み、
  //  admin.attendance-on-card 等が一括実行時だけ落ちる（2026-08-27 に踏んだ）。
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(
    new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  async function openLatePanel(page: import('@playwright/test').Page) {
    await page.goto('/checkin', { waitUntil: 'networkidle' })
    await page.getByTestId('late-open').click()
    await expect(page.getByTestId('late-panel')).toBeVisible({ timeout: 15000 })
  }

  test('★忘れた日の出勤・退勤を入れると、あとから入力した記録として残る', async ({ page }) => {
    const DAY = jstDay(2)
    await openLatePanel(page)
    await page.getByTestId('late-date').selectOption(DAY)
    await page.getByTestId('late-checkin').selectOption('07:35')
    await page.getByTestId('late-checkout').selectOption('18:45')
    await page.getByTestId('late-submit').click()
    await expect(page.getByTestId('late-done')).toBeVisible({ timeout: 20000 })

    const rows = await punchesOf(DAY)
    expect(rows.length, '出勤と退勤が1件ずつ入る').toBe(2)
    expect(rows[0].type).toBe('checkin')
    expect(rows[1].type).toBe('checkout')
    expect(rows.every((r: any) => r.backdated === true),
      '★あとから入力したと分かる（その場で押した打刻と混同しない）').toBe(true)
    expect(rows.every((r: any) => (r.agreed_rule_texts ?? []).length === 0),
      '★同意を取っていないものを取ったことにしない').toBe(true)

    const jst = (iso: string) => new Intl.DateTimeFormat('en-GB',
      { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    expect(jst(rows[0].checked_at), '入れた時刻がそのまま残る').toBe('07:35')
    expect(jst(rows[1].checked_at)).toBe('18:45')
  })

  test('★4日より前は選べない（際限なく後付けできない）', async ({ page }) => {
    await openLatePanel(page)
    const opts = await page.getByTestId('late-date').locator('option').evaluateAll(
      (els) => els.map((e) => (e as HTMLOptionElement).value))
    expect(opts, '4日前は選べる').toContain(jstDay(4))
    expect(opts, '★5日前は選べない').not.toContain(jstDay(5))
    expect(opts.length, '今日〜4日前の5日分').toBe(5)
  })

  test('★現場の選択欄は無い（打刻は現場に紐づかない）', async ({ page }) => {
    await openLatePanel(page)
    await expect(page.getByTestId('late-site')).toHaveCount(0)
  })

  test('出勤・退勤のどちらも空なら弾かれる', async ({ page }) => {
    await openLatePanel(page)
    await page.getByTestId('late-submit').click()
    await expect(page.getByTestId('late-error')).toContainText('どちらかは入力', { timeout: 15000 })
  })

  test('退勤が出勤より前だと弾かれる', async ({ page }) => {
    await openLatePanel(page)
    await page.getByTestId('late-checkin').selectOption('18:00')
    await page.getByTestId('late-checkout').selectOption('08:00')
    await page.getByTestId('late-submit').click()
    await expect(page.getByTestId('late-error')).toContainText('後の時刻', { timeout: 15000 })
  })

  test('★同じ日にすでに打刻があれば二重に足さない', async ({ page }) => {
    const DAY = jstDay(1)
    await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        worker_id: workerId, type: 'checkin',
        checked_at: `${DAY}T08:02:00+09:00`, agreed_rule_texts: [],
      }),
    })
    await openLatePanel(page)
    await page.getByTestId('late-date').selectOption(DAY)
    await page.getByTestId('late-checkin').selectOption('07:00')
    await page.getByTestId('late-submit').click()
    await expect(page.getByTestId('late-error')).toContainText('すでにあります', { timeout: 15000 })

    const rows = await punchesOf(DAY)
    expect(rows.length, '★元の打刻が二重にならない').toBe(1)
    expect(rows[0].backdated, '元の打刻は書き換えられていない').toBe(false)
  })
})
