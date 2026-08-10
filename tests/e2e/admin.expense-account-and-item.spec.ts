// ============================================================
//  admin.expense-account-and-item.spec.ts
//  経費の「科目」と「品名」を両方出し、画面をまたいで一致させる（2026-08-10）
//
//  運用者の逐語（電話）:「管理画面で見るとちゃんとできてるけど、個人の経費にしてみると
//   品名がうまくいってない」「科目と品名を両方表示する、管理画面にしてもスマホ画面にしても」
//
//  ★このテストが守る一番大事なこと:
//   科目の導出は expenseAccountCategory ただ1つで、画面ごとに別のマッピングを書かないこと。
//   同じ経費が管理画面では「旅費交通費」、帳票では「車両費」になったら会計が壊れる。
//   なので画面に出ている文字列と、共有関数 expenseAccountCategory の戻り値を突き合わせる
//   （画面側が switch を写経していたらここで落ちる）。客先帳票側は liff.expense-doc-columns が担保。
//
//  科目のルール自体は既に実装済みで、運用者が電話で指定した内容と一致している:
//   駐車代→旅費交通費 / ガソリン代→車両費（shared/expense-flatten.ts）。
//   ここではその2つを代表として固定する（「駐車場は旅費交通費、ガソリンは車両費」）。
//
//  接頭辞 acct-item- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'acct-item-'
const WORKER = `${PREFIX}作業員${TS}`
const SITE = `${PREFIX}現場${TS}`
const YM = '2026-10'
const DATE = `${YM}-14`

let accountId = ''
let userId = ''

async function purge() {
  for (const u of (await restSrv(`users?real_name=eq.${encodeURIComponent(WORKER)}&select=id`)) ?? []) {
    await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: workers ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

test.describe('経費: 科目と品名を両方出す', () => {
  test.beforeAll(async () => {
    await purge()
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

    await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    })

    // 駐車代（→旅費交通費／品名 P代）と ガソリン代（→車両費／品名 ガソリン代）を1日報に入れる
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, date: DATE, is_working: true,
        sites: [{
          siteName: SITE, workers: [], subcontractors: [],
          expenses: {
            parkings: [{ yen: 800, payee: `${PREFIX}パーキング`, tategae: false, fileUrls: [] }],
            vehicles: [], highways: [], trains: [], hotels: [], others: [], entertainments: [],
          },
        }],
        gasoline_items: [{ yen: 5000, liters: 30, payee: `${PREFIX}スタンド`, tategae: false, fileUrls: [] }],
      }),
    })
  })

  test.afterAll(async () => { await purge() })

  /** 管理画面の 作業員×月 の明細モーダルを開く */
  async function openAdminDetail(page: Page) {
    await page.goto(`/expenses?ym=${YM}`, { waitUntil: 'networkidle' })
    const row = page.locator('tbody tr', { hasText: WORKER }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()
    await expect(page.locator('.modal, [role="dialog"]').first()).toBeVisible({ timeout: 15000 })
  }

  test('★管理画面: 科目と品名が別々の列に出る（駐車代=旅費交通費/P代）', async ({ page }) => {
    await openAdminDetail(page)
    const thead = page.locator('.modal thead, [role="dialog"] thead').first()
    await expect(thead).toContainText('科目')
    await expect(thead, '★品名列を追加した（以前は科目だけだった）').toContainText('品名')

    const parking = page.locator('tbody tr', { hasText: `${PREFIX}パーキング` }).first()
    await expect(parking).toBeVisible({ timeout: 15000 })
    await expect(parking, '駐車代の科目は旅費交通費').toContainText('旅費交通費')
    await expect(parking, '品名は P代（客先向けの言い方）').toContainText('P代')
  })

  test('★管理画面: ガソリン代の科目は車両費（電話で決めた分類）', async ({ page }) => {
    await openAdminDetail(page)
    const gas = page.locator('tbody tr', { hasText: `${PREFIX}スタンド` }).first()
    await expect(gas).toBeVisible({ timeout: 15000 })
    await expect(gas, 'ガソリン代の科目は車両費').toContainText('車両費')
    await expect(gas, '品名はガソリン代').toContainText('ガソリン代')
  })

  test('★画面が独自マッピングを持っていない（共有関数の答えと一致する）', async ({ page }) => {
    // 科目は shared/expense-flatten.ts の expenseAccountCategory が唯一の出どころ。
    // 画面側で switch を書き直すと、同じ経費が管理画面と帳票で違う科目になって会計が壊れる。
    // 「画面に出ている文字列」と「共有関数の戻り値」を突き合わせて、写経していないことを見る。
    // ※共有関数は scripts/sync-shared.mjs で liff/admin に同一内容が配られている（md5一致を確認済み）。
    await openAdminDetail(page)

    const expected = await page.evaluate(async () => {
      const m: any = await import('/src/lib/expense-flatten.gen.ts')
      return {
        parking: m.expenseAccountCategory({ category: '駐車代' }),
        gas:     m.expenseAccountCategory({ category: 'ガソリン代（本日）' }),
      }
    })
    expect(expected.parking, '前提: 共有関数が読めている').toBeTruthy()

    const parking = page.locator('tbody tr', { hasText: `${PREFIX}パーキング` }).first()
    await expect(parking).toBeVisible({ timeout: 15000 })
    await expect(parking.locator('td').nth(3), '★駐車代の科目が共有関数と一致').toHaveText(expected.parking)

    const gas = page.locator('tbody tr', { hasText: `${PREFIX}スタンド` }).first()
    await expect(gas).toBeVisible({ timeout: 15000 })
    await expect(gas.locator('td').nth(3), '★ガソリン代の科目が共有関数と一致').toHaveText(expected.gas)
  })
})
