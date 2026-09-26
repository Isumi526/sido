// ============================================================
//  liff.report-recent-sites.spec.ts
//  日報の現場プルダウン先頭に「最近の現場（直近1週間）」＝本人の稼働頻度TOP3を出す。
//
//  出所（2026-09-10 SEED 会議）: スタッフ「毎日同じ現場に入ることが多い…最近多いやつは上の方に」
//   大塚「現場は月20件ぐらい」 亥角「3件ぐらい、直近で頻度の高いものが」 スタッフ「1週間ぐらい見たらだいたい良い」
//
//  ★守ること:
//   1. 直近7日の日報の頻度順に最大3件。同数は最終稼働日が新しい順
//   2. 8日以上前・無効現場は入らない。履歴が無ければグループ自体が出ない
//   3. 元請け階層は従来どおり下に残る（同じ現場が二重に出てよい）
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ymd = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() - n * 86400000))
const NAMES = { a: `E2E最近A_${TS}`, b: `E2E最近B_${TS}`, c: `E2E最近C_${TS}`, d: `E2E最近D_${TS}`, old: `E2E最近OLD_${TS}` }

let accountId = ''
let userId = ''
let workerId = ''
const siteIds: string[] = []

function reportBody(date: string, names: string[]) {
  return {
    account_id: accountId, user_id: userId, date, is_working: true, note: 'E2E最近の現場',
    sites: names.map(n => ({ siteName: n, site_id: siteIds[0], subcontractors: [],
      workers: [{ workerName: 'Worker 01', workerId, startTime: '08:30', endTime: '17:30' }],
      expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] } })),
  }
}

test.describe('現場プルダウンの「最近の現場」', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
    for (const n of Object.values(NAMES)) {
      siteIds.push((await restSrv('sites', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ account_id: accountId, name: n, active: true }),
      }))[0].id)
    }
    // 直近7日: A×3（1,2,3日前）／B×2（1,5日前）／C×2（4,6日前）／D×1（2日前）／OLD は 9日前×3（範囲外）
    const plan: [number, string[]][] = [
      [1, [NAMES.a, NAMES.b]], [2, [NAMES.a, NAMES.d]], [3, [NAMES.a]], [4, [NAMES.c]], [5, [NAMES.b]], [6, [NAMES.c]],
      [9, [NAMES.old]], [10, [NAMES.old]], [11, [NAMES.old]],
    ]
    for (const [n, names] of plan) {
      await restSrv('daily_reports?on_conflict=user_id,date', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(reportBody(ymd(n), names)),
      })
    }
  })
  test.afterAll(async () => {
    await restSrv(`daily_reports?user_id=eq.${userId}&note=eq.E2E最近の現場`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${siteIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
    // 他specの前提（直近3日はクリア）に戻す
    for (const n of [1, 2, 3]) await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${ymd(n)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★直近7日の頻度TOP3が先頭グループに出る（同数は最終稼働日が新しい順・範囲外は入らない）', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    await page.waitForSelector('form.form', { timeout: 15000 })
    const group = page.locator('[data-testid="site-group-recent"]').first()
    await expect(group).toBeAttached({ timeout: 15000 })
    const names = await group.locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
    // ★他specのシード（同じ窓に別の現場）が混ざりうるので、絶対順ではなく相対で見る
    expect(names.length, '最大3件').toBeLessThanOrEqual(3)
    expect(names[0], 'A(3回) が先頭').toBe(NAMES.a)
    expect(names, 'B(2回・最終1日前) は入る').toContain(NAMES.b)
    if (names.includes(NAMES.c)) expect(names.indexOf(NAMES.b), '同数は最終稼働日が新しい B が C より上').toBeLessThan(names.indexOf(NAMES.c))
    expect(names, 'D(1回) は TOP3 に入らない').not.toContain(NAMES.d)
    expect(names, '9日以上前だけの現場は入らない').not.toContain(NAMES.old)
    // 元請け階層（従来の並び）にも同じ現場が残っている＝近道であって置き換えではない
    const all = await page.getByTestId('site-select-0').locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
    expect(all.filter(v => v === NAMES.a).length, '上の近道＋従来の階層の2箇所').toBeGreaterThanOrEqual(2)
    // 選べる
    await page.getByTestId('site-select-0').selectOption(NAMES.a)
    await expect(page.getByTestId('site-select-0')).toHaveValue(NAMES.a)
  })
})
