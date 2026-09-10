// ============================================================
//  admin.report-site-relink-non-working.spec.ts
//  「稼働なし」の日報を紐付け一覧に出さない（2026-09-10）
//
//  ★出所（尾崎さん・2026-09-10）
//   「『現場未設定の日報を紐付け』欄に表示されている佐谷良彦 8/26分ですが、
//     日報では『稼働なし』で報告いただいています。どのように対応すれば？」
//
//  ★なぜ起きるか
//   日報フォームで現場を選びかけてから「稼働なし」に切り替えて保存すると、
//   sites[] に siteName='__unset__' の入れ物だけが残る（時間も入ったまま）。
//   集計側は is_working で弾く（worker-reports.vue が !is_working で continue）ので
//   数字は狂わないが、この画面にだけ残り続けて事務方の手を止めていた。
//   本番sidoでは直近90日で1件（佐谷さん 2026-08-26）。
//
//  ★ただし休みの日でも経費は現場に紐づく（駐車代・高速代など）。
//   金額の入った入れ物まで隠すと紐付ける先を失うので、そこは残す。
//   ＝「稼働なし」だけでは隠す理由にならない、というのがこのspecの主眼。
//
//  ★ナビのバッジも同じ判定を使う（片方だけ直すと
//    「バッジは1件と言うのに開くと空」になる）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E稼働なし_${TS}`

const D_OFF_BARE = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0]
const D_OFF_EXPENSE = new Date(Date.now() - 4 * 86400000).toISOString().split('T')[0]
const D_WORKING = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0]

let accountId = ''
let userId = ''

async function seed(date: string, isWorking: boolean, expenses: any) {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: isWorking,
      sites: [{
        siteName: '__unset__', subcontractors: [], expenses,
        // ★実データと同じ形：稼働なしでも時間が残っている
        workers: [{ workerName: WORKER, startTime: '08:00', endTime: '17:30', hoursNormal: 8 }],
      }],
    }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
  })
  const u = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: w[0].id }),
  })
  userId = u[0].id

  // ① 稼働なし・経費なし（＝本番で起きていた形。空の入れ物が1つ置かれる点まで再現）
  await seed(D_OFF_BARE, false, {
    parkings: [], highways: [], trains: [{ label: '', payee: '', tategae: false }],
    vehicles: [{ vehicleName: '', gasTategae: false }], others: [{ label: '', account: '消耗品費' }],
  })
  // ② 稼働なし・でも駐車代が入っている（現場に紐づける必要がある）
  await seed(D_OFF_EXPENSE, false, { parkings: [{ yen: 1200, payee: `E2E駐車場_${TS}` }] })
  // ③ 稼働あり（従来どおり出る＝この修正で消してはいけない）
  await seed(D_WORKING, true, {})
})

test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
})

function rowOf(page: import('@playwright/test').Page, date: string) {
  const [, m, d] = date.split('-')
  return page.locator('tbody tr').filter({ hasText: `${Number(m)}/${Number(d)}` }).filter({ hasText: WORKER })
}

test('★「稼働なし」で経費も無い日報は紐付け一覧に出ない', async ({ page }) => {
  await page.goto('/report-site-relink', { waitUntil: 'networkidle' })
  // 先に「出るはずの行」を待つ＝読み込み前の空振りで誤ってgreenにしない
  await expect(rowOf(page, D_WORKING)).toHaveCount(1, { timeout: 15000 })
  await expect(rowOf(page, D_OFF_BARE), '稼働なしは出さない').toHaveCount(0)
})

test('★「稼働なし」でも経費が入っていれば出す（紐付け先を失わせない）', async ({ page }) => {
  await page.goto('/report-site-relink', { waitUntil: 'networkidle' })
  await expect(rowOf(page, D_OFF_EXPENSE), '駐車代1,200円ぶんは現場に紐づける').toHaveCount(1, { timeout: 15000 })
})

test('★稼働ありの現場未設定は従来どおり出る', async ({ page }) => {
  await page.goto('/report-site-relink', { waitUntil: 'networkidle' })
  await expect(rowOf(page, D_WORKING)).toHaveCount(1, { timeout: 15000 })
})

test('★ナビのバッジ件数が一覧の行数と一致する（片方だけ直すズレを防ぐ）', async ({ page }) => {
  await page.goto('/report-site-relink', { waitUntil: 'networkidle' })
  await expect(rowOf(page, D_WORKING)).toHaveCount(1, { timeout: 15000 })
  const rows = await page.locator('tbody tr').count()
  const badge = page.getByTestId('nav-badge-site-unset')
  const shown = (await badge.count()) ? Number((await badge.first().innerText()).trim()) : 0
  expect(shown, 'バッジと一覧の件数が食い違わない').toBe(rows)
})
