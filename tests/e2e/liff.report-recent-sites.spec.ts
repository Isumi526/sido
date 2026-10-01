// ============================================================
//  liff.report-recent-sites.spec.ts
//  日報の現場プルダウン先頭に「最近の現場（直近1週間）」＝本人の直近7日に使った現場を全部出す。
//
//  出所（2026-09-10 SEED 会議）: スタッフ「毎日同じ現場に入ることが多い…最近多いやつは上の方に」
//   大塚「現場は月20件ぐらい」 亥角「3件ぐらい、直近で頻度の高いものが」 スタッフ「1週間ぐらい見たらだいたい良い」
//
//  ★守ること:
//   1. 直近7日の日報の頻度順に全部（件数で切らない）。同数は最終稼働日が新しい順
//      ※2026-10-01 今井さん「最近1週間はすべて残してほしい」で TOP3 → 全部に変更
//   2. 8日以上前・無効現場は入らない。履歴が無ければグループ自体が出ない
//   3. 元請け階層は従来どおり下に残る（同じ現場が二重に出てよい）
//   4. 代理入力に切り替えたら代理先の現場に入れ替わり、戻したら本人の現場に戻る
//      ※同日 今井さん「代理入力は代理入力、自分は自分で分けて」（切替で読み直していなかった）
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ymd = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() - n * 86400000))
const NAMES = { a: `E2E最近A_${TS}`, b: `E2E最近B_${TS}`, c: `E2E最近C_${TS}`, d: `E2E最近D_${TS}`, old: `E2E最近OLD_${TS}`, p: `E2E最近代理先_${TS}` }
const PROXY_NAME = `E2E最近代理_${TS}`

let accountId = ''
let userId = ''
let workerId = ''
const siteIds: string[] = []
let px: { workerId: string; usersId: string; proxyId: string } | null = null

function reportBody(date: string, names: string[], uid = userId) {
  return {
    account_id: accountId, user_id: uid, date, is_working: true, note: 'E2E最近の現場',
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
    // 代理先（自分が代理人）: 直近7日に P だけ使っている人
    const [w] = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: PROXY_NAME, role: 'site', unit_price: 0, active: true }),
    })
    const [u] = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: PROXY_NAME, worker_id: w.id, permission_role: 'worker' }),
    })
    const [pr] = await restSrv('worker_proxies', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, worker_id: w.id, proxy_operator_id: workerId }),
    })
    px = { workerId: w.id, usersId: u.id, proxyId: pr.id }
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(reportBody(ymd(2), [NAMES.p], u.id)),
    })
  })
  test.afterAll(async () => {
    if (px) {
      await restSrv(`worker_proxies?id=eq.${px.proxyId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`daily_reports?user_id=eq.${px.usersId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`users?id=eq.${px.usersId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`workers?id=eq.${px.workerId}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`daily_reports?user_id=eq.${userId}&note=eq.E2E最近の現場`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${siteIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
    // 他specの前提（直近3日はクリア）に戻す
    for (const n of [1, 2, 3]) await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${ymd(n)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★直近7日の現場が全部、頻度順で先頭グループに出る（同数は最終稼働日が新しい順・範囲外は入らない）', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    await page.waitForSelector('form.form', { timeout: 15000 })
    const group = page.locator('[data-testid="site-group-recent"]').first()
    await expect(group).toBeAttached({ timeout: 15000 })
    const names = await group.locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
    // ★他specのシード（同じ窓に別の現場）が混ざりうるので、絶対順ではなく相対で見る
    expect(names[0], 'A(3回) が先頭').toBe(NAMES.a)
    for (const n of [NAMES.b, NAMES.c, NAMES.d]) expect(names, '直近7日の現場は件数で切らず全部入る').toContain(n)
    expect(names.indexOf(NAMES.b), '同数は最終稼働日が新しい B が C より上').toBeLessThan(names.indexOf(NAMES.c))
    expect(names.indexOf(NAMES.c), '2回の C が 1回の D より上').toBeLessThan(names.indexOf(NAMES.d))
    expect(names, '9日以上前だけの現場は入らない').not.toContain(NAMES.old)
    // 元請け階層（従来の並び）にも同じ現場が残っている＝近道であって置き換えではない
    const all = await page.getByTestId('site-select-0').locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
    expect(all.filter(v => v === NAMES.a).length, '上の近道＋従来の階層の2箇所').toBeGreaterThanOrEqual(2)
    // 選べる
    await page.getByTestId('site-select-0').selectOption(NAMES.a)
    await expect(page.getByTestId('site-select-0')).toHaveValue(NAMES.a)
  })

  test('★代理入力に切り替えると代理先の現場に入れ替わり、戻すと自分の現場に戻る', async ({ page }) => {
    const recent = async () => page.locator('[data-testid="site-group-recent"]').first()
      .locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value)).catch(() => [] as string[])
    await page.goto('/report', { waitUntil: 'networkidle' })
    await page.waitForSelector('form.form', { timeout: 15000 })
    await expect.poll(recent, { timeout: 15000 }).toContain(NAMES.a)
    expect(await recent(), '自分の時は代理先の現場は出ない').not.toContain(NAMES.p)

    // 日報画面のまま代理入力に切り替える
    await page.getByTestId('nav-hamburger').click()
    await page.getByTestId(`proxy-row-${px!.workerId}`).click()
    await expect.poll(recent, { timeout: 20000, message: '代理先の現場に入れ替わる' }).toEqual([NAMES.p])

    // 代理をやめると自分の現場に戻る（同じ行をもう一度押すと解除）
    await page.getByTestId('nav-hamburger').click()
    await page.getByTestId(`proxy-row-${px!.workerId}`).click()
    await expect.poll(recent, { timeout: 20000, message: '自分の現場に戻る' }).toContain(NAMES.a)
    expect(await recent()).not.toContain(NAMES.p)
  })
})
