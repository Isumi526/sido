// ============================================================
//  admin.site-reports-vendor-breakdown.spec.ts
//  現場別集計に業者ごとの内訳を出す（漏れに気づけるようにする）
//   - ★内訳の合計＝月計(商社+業者) が一致する（＝検算できる。これが要望の本質）
//   - 業者ごとの明細を開ける（「とらやだけのリストほしい」）
//   - ★区分(商社/業者)未設定の協力業者は月計に計上されていない＝「漏れ」を明示する
//  経緯: 「業者で5329940かかってんのはわかるけど、業者事でもみれないなど
//        どこかの業者が漏れててもわからない」（2026-08-03 議事録）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E内訳現場_${TS}`
const V_GYOSHA = `E2E業者甲_${TS}`
const V_SHOSHA = `E2E商社乙_${TS}`
const V_NOCAT = `E2E区分なし丙_${TS}`
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const DAY = `${YM}-10`

let accountId = ''
let siteId = ''
let workerId = ''
let userId = ''

async function mkSub(name: string, category: string | null, unitPrice: number) {
  const r = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name, category, unit_price: unitPrice, active: true }),
  })
  return r[0].id
}

test.describe('現場別集計の業者別内訳', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
    workerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E内訳作業員_${TS}`, role: 'site', active: true, daily_wage: 0 }),
    }))[0].id
    userId = (await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: `E2E内訳作業員_${TS}`, worker_id: workerId }),
    }))[0].id

    await mkSub(V_GYOSHA, '業者', 30000)
    await mkSub(V_SHOSHA, '商社', 20000)
    await mkSub(V_NOCAT, null, 50000)   // ★区分未設定＝月計に計上されない

    // 日報1件: 業者甲 2人(30,000) / 商社乙 1人(20,000) / 区分なし丙 1人(50,000)
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, date: DAY, is_working: true,
        sites: [{
          siteName: SITE, site_id: siteId, workers: [],
          subcontractors: [
            { subcontractorName: V_GYOSHA, count: 2 },
            { subcontractorName: V_SHOSHA, count: 1 },
            { subcontractorName: V_NOCAT, count: 1 },
          ],
          expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
        }],
      }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    for (const n of [V_GYOSHA, V_SHOSHA, V_NOCAT]) {
      await restSrv(`subcontractors?name=eq.${encodeURIComponent(n)}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  // 現場タブは ?site= に同期しているので直接その現場を開く（タブ数が多いとクリックが不安定）
  async function openSite(page: any) {
    await page.goto(`/site-reports?site=${encodeURIComponent(SITE)}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('vendor-breakdown')).toBeVisible({ timeout: 20000 })
  }

  test('★業者ごとの内訳が出て、合計が月計と一致する（検算できる＝漏れに気づける）', async ({ page }) => {
    await openSite(page)

    const bd = page.getByTestId('vendor-breakdown')
    await expect(bd, '業者甲が出る').toContainText(V_GYOSHA)
    await expect(bd, '商社乙が出る').toContainText(V_SHOSHA)
    // 業者甲 2×30,000=60,000 / 商社乙 1×20,000=20,000 → 内訳合計 80,000
    await expect(page.getByTestId('vendor-breakdown-total')).toContainText('80,000')

    // ★AC2: 内訳合計＝月計(商社+業者)。ここが一致しないと検算にならない
    await expect(page.getByTestId('vendor-check-ok'), '内訳合計と月計が一致').toBeVisible()
    await expect(page.getByTestId('vendor-check-ng')).toHaveCount(0)
  })

  test('★特定の業者だけの明細を開ける（とらやだけのリストが欲しい）', async ({ page }) => {
    await openSite(page)

    await page.getByTestId(`vendor-detail-${V_GYOSHA}`).click()
    const panel = page.getByTestId('vendor-detail-panel')
    await expect(panel, '選んだ業者の明細が出る').toBeVisible()
    await expect(panel).toContainText(V_GYOSHA)
    await expect(panel, '日付が出る').toContainText(DAY)
    await expect(panel, '人数×単価の根拠が出る').toContainText('2人')
    await expect(panel, 'その業者の金額').toContainText('60,000')
    // 他の業者の金額は明細に混ざらない
    await expect(panel).not.toContainText('20,000')
  })

  // ★これが「どこかの業者が漏れてても分からない」の実体。
  //   区分未設定の協力業者は商社にも業者にも計上されず、合計から抜け落ちている。
  test('★区分未設定で原価に計上されていない業者を警告として明示する', async ({ page }) => {
    await openSite(page)

    const warn = page.getByTestId('vendor-uncategorized')
    await expect(warn, '未計上の警告が出る').toBeVisible()
    await expect(warn).toContainText(V_NOCAT)
    await expect(warn, '未計上額が出る').toContainText('50,000')
    await expect(warn, '月計に含まれていないと明示').toContainText('含まれていません')

    // 未計上分は内訳合計（＝月計）には足されない（勝手に金額を変えない）
    await expect(page.getByTestId('vendor-breakdown-total')).toContainText('80,000')
    await expect(page.getByTestId('vendor-check-ok')).toBeVisible()
  })
})
