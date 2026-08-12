// ============================================================
//  admin.report-punch-diff.spec.ts
//  日報一覧: 実打刻と作業時刻のズレをその場で見る（2026-08-12）
//
//  出所（2026-08-10 大塚さんとの電話・逐語）:
//   「（出退勤の画面と日報の画面が）別じゃなくて一緒でいい」「日報一覧で」
//   「実際打った打刻時間と、管理者が打った8時半・6時っていうのと、本人たちが実際…
//     それが出てくればそれでいいじゃないの？」
//
//  ★経緯: 当初これを別ページ（出退勤ログ）に作った。要約だけ読んで逐語に戻らなかったため。
//   日報一覧には 実打刻 も 作業時刻 も既に出ていたので、足りなかったのは『差』だけだった。
//
//  ★このテストが守る一番大事なこと:
//   ズレは表示専用で、人件費・稼働時間を1円も動かさないこと。
//   同じ電話で「人件費は管理者が決めた時間ベースで今までと変わらず」と明言されている。
//
//  接頭辞 pdiff- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'pdiff-'
const SITE = `${PREFIX}現場${TS}`
const W_GAP = `${PREFIX}ズレ${TS}`      // 作業時刻 08:30-18:00 に対し 06:02 / 19:53 打刻
const W_SAME = `${PREFIX}一致${TS}`     // 打刻と作業時刻がほぼ同じ
const W_NOPUNCH = `${PREFIX}打刻なし${TS}`
// ★日報一覧の月ナビは URL 同期されておらず常に「当月」を出す。
//  固定日付にすると画面に出ず、テストが「表示されない」ではなく「月が違う」で落ちる。
const _t = new Date()
const DATE = `${_t.getFullYear()}-${String(_t.getMonth() + 1).padStart(2, '0')}-${String(_t.getDate()).padStart(2, '0')}`
const YM = DATE.slice(0, 7)

let accountId = ''
let siteId = ''
const wid: Record<string, string> = {}
const uid: Record<string, string> = {}

async function purge() {
  for (const n of [W_GAP, W_SAME, W_NOPUNCH]) {
    for (const u of (await restSrv(`users?real_name=eq.${encodeURIComponent(n)}&select=id`)) ?? []) {
      await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }
  if (siteId) await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: workers ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

/** 作業時刻 08:30-18:00 の日報を1件作る */
async function seedReport(name: string) {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid[name], date: DATE, is_working: true,
      sites: [{
        siteName: SITE, subcontractors: [], expenses: {},
        workers: [{ workerName: name, workerId: wid[name], startTime: '08:30', endTime: '18:00', breakMinutes: 60 }],
      }],
    }),
  })
}

async function punch(name: string, type: string, hm: string) {
  await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      site_id: siteId, worker_id: wid[name], type,
      checked_at: `${DATE}T${hm}:00+09:00`, agreed_rule_texts: [],
    }),
  })
}

test.describe('日報一覧: 実打刻と作業時刻のズレ', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: SITE, active: true,
        default_start_time: '08:30', default_end_time: '18:00',
      }),
    }))[0].id

    for (const n of [W_GAP, W_SAME, W_NOPUNCH]) {
      const w = await restSrv('workers', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ account_id: accountId, name: n, role: 'site', active: true }),
      })
      wid[n] = w[0].id
      const u = await restSrv('users', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ account_id: accountId, real_name: n, worker_id: w[0].id }),
      })
      uid[n] = u[0].id
      await seedReport(n)
    }

    await punch(W_GAP, 'checkin', '06:02')     // 作業 08:30 に対し 2時間28分 早い
    await punch(W_GAP, 'checkout', '19:53')    // 作業 18:00 に対し 1時間53分 遅い
    await punch(W_SAME, 'checkin', '08:34')    // 4分ズレ＝表示しない範囲
    await punch(W_SAME, 'checkout', '17:56')
  })

  test.afterAll(async () => { await purge() })

  const cardOf = (page: Page, name: string) =>
    page.locator('.report-card, .card', { hasText: name }).first()

  async function open(page: Page) {
    await page.goto('/reports', { waitUntil: 'networkidle' })   // 月ナビは既定で当月
    await expect(page.locator('body')).toContainText(W_GAP, { timeout: 20000 })
  }

  test('★ズレている日は、出勤も退勤もズレの大きさが出る', async ({ page }) => {
    await open(page)
    const card = cardOf(page, W_GAP)
    // 実打刻と作業時刻は元から出ている。足したのは「差」。
    await expect(card, '実打刻').toContainText('06:02')
    await expect(card, '作業時刻').toContainText('08:30')
    await expect(card.getByTestId('punch-diff-in'), '★出勤のズレ').toHaveText('出勤 −2時間28分')
    await expect(card.getByTestId('punch-diff-out'), '★退勤のズレ').toHaveText('退勤 +1時間53分')
  })

  test('★30分以上のズレは目立たせる（申請漏れに気づくため）', async ({ page }) => {
    await open(page)
    await expect(cardOf(page, W_GAP).getByTestId('punch-diff-in')).toHaveClass(/big/)
  })

  test('★数分のズレは出さない（全行にチップが並ぶと大きなズレが埋もれる）', async ({ page }) => {
    // 4分ズレ。実運用ではほぼ全員がこの程度ズレるので、出すと画面が埋まる。
    await open(page)
    const card = cardOf(page, W_SAME)
    await expect(card, '打刻自体は出る').toContainText('08:34')
    await expect(card.getByTestId('punch-diff-in'), '15分未満は黙る').toHaveCount(0)
    await expect(card.getByTestId('punch-diff-out')).toHaveCount(0)
  })

  test('★打刻が無い日は、ズレを 0 と偽らない', async ({ page }) => {
    await open(page)
    const card = cardOf(page, W_NOPUNCH)
    await expect(card, '打刻なしと出る').toContainText('打刻なし')
    await expect(card.getByTestId('punch-diff-in'), '★無いものを在るように見せない').toHaveCount(0)
    await expect(card.getByTestId('punch-diff-out')).toHaveCount(0)
  })

  test('★ズレていても稼働時間・人件費は動かない（表示専用であること）', async ({ page }) => {
    // 2時間28分ズレている W_GAP と、ぴったりの W_SAME は
    // 同じ作業時刻(08:30-18:00・休憩60分)なので、稼働も人件費も同額でなければならない。
    await page.goto(`/site-reports?ym=${YM}`, { waitUntil: 'networkidle' })
    await page.getByTestId('site-filter-text').fill(SITE)
    await page.locator('.tabs .tab', { hasText: SITE }).first().click()
    const table = page.locator('.table-wrap')
    await expect(table).toBeVisible({ timeout: 15000 })
    // ★打刻の時刻が集計に混ざっていない
    await expect(table, '実打刻は集計に出てこない').not.toContainText('06:02')
    await expect(table, '実打刻は集計に出てこない').not.toContainText('19:53')
  })
})
