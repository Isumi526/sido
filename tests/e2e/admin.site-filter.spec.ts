// ============================================================
//  admin.site-filter.spec.ts
//  現場別集計: 現場名と元請けでタブを絞り込む（2026-08-10）
//
//  背景: 現場が341件あり、タブから目的の1件を目視で探せない。
//   ★このチケットは一度作り直している。元は「ユーザーごとの並び替え保存」として
//    実装したが、運用者に確認したら要望は「絞り込み」だった（並び替えは revert 済み）。
//
//  ★このテストが守る一番大事なこと（AC5）:
//   絞り込みは「表示するタブを減らす」だけで、各現場の集計値を変えてはいけない。
//   絞り込みが集計クエリに漏れると、金額が静かにズレる（画面は正常に見える）ので
//   「絞る前後で月計が同一」を必ず assert する。
//
//  接頭辞 E2E絞込 / _${TS} のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E絞込_${TS}`
const YM = '2026-04'

// 五十音順で あ < か < さ になるよう並べる。
const SITE_A = `E2E絞込あさひビル_${TS}`      // 元請け=甲
const SITE_B = `E2E絞込かすみ倉庫_${TS}`      // 元請け=乙
const SITE_C = `E2E絞込さくら工場_${TS}`      // 元請け=甲
// 全角英字の現場。半角小文字で打っても引っかかること（NFKC＋小文字化）を見る。
const SITE_D = `E2E絞込ＬｕｌｕＬｅｍｏｎ_${TS}`  // 元請け無し（現場マスタに元請け未設定）

const PRIME_1 = `E2E元請け甲_${TS}`
const PRIME_2 = `E2E元請け乙_${TS}`

let accountId = ''
let userId = ''

async function seedReport(date: string, siteName: string, subCount: number) {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: true,
      sites: [{
        siteName, workers: [],
        // 金額が出るように協力業者を1件入れる（AC5の「集計値が変わらない」を見るため）
        subcontractors: [{ subcontractorName: `E2E商社_${TS}`, count: subCount }],
        expenses: {},
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

  await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, name: `E2E商社_${TS}`, category: '商社', unit_price: 10000, active: true }),
  })

  const cs = await restSrv('contractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      { account_id: accountId, name: PRIME_1, active: true, sort_order: 0 },
      { account_id: accountId, name: PRIME_2, active: true, sort_order: 0 },
    ]),
  })
  const idOf = (n: string) => cs.find((c: any) => c.name === n).id

  // 現場マスタ。SITE_D だけ元請け未設定＝「元請けで絞ると出てこない」側の代表。
  await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([
      { account_id: accountId, name: SITE_A, active: true, contractor_id: idOf(PRIME_1) },
      { account_id: accountId, name: SITE_B, active: true, contractor_id: idOf(PRIME_2) },
      { account_id: accountId, name: SITE_C, active: true, contractor_id: idOf(PRIME_1) },
      { account_id: accountId, name: SITE_D, active: true, contractor_id: null },  // PostgREST の一括insertは全行キー一致が必要
    ]),
  })

  await seedReport(`${YM}-05`, SITE_A, 1)
  await seedReport(`${YM}-06`, SITE_B, 2)
  await seedReport(`${YM}-07`, SITE_C, 3)
  await seedReport(`${YM}-08`, SITE_D, 4)
})

test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=like.E2E%E7%B5%9E%E8%BE%BC*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`contractors?name=like.E2E%E5%85%83%E8%AB%8B%E3%81%91*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?name=eq.${encodeURIComponent(`E2E商社_${TS}`)}`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`sites?name=like.E2E%E7%B5%9E%E8%BE%BC*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: sites ${left}件 残っている`)
})

/** 自テストの現場だけをタブから抜く（共有DBなので他テストの現場が混ざる） */
async function myTabs(page: Page): Promise<string[]> {
  const names = await page.locator('.tabs .tab').allInnerTexts()
  return names.map((s) => s.trim()).filter((n) => n.endsWith(`_${TS}`))
}

async function open(page: Page) {
  await page.goto(`/site-reports?ym=${YM}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('site-filter-text')).toBeVisible({ timeout: 15000 })
  await expect.poll(() => myTabs(page), { timeout: 15000 }).toHaveLength(4)
}

test.describe('現場別集計: 現場名と元請けで絞り込む', () => {
  test('★AC1: 現場名の部分一致で絞れる（全角/大文字の揺れを吸収する）', async ({ page }) => {
    await open(page)

    await page.getByTestId('site-filter-text').fill('さくら')
    await expect.poll(() => myTabs(page)).toEqual([SITE_C])

    // ★現場名は手入力なので表記が揺れる。全角で登録された現場を半角小文字で打っても出ること。
    //  （normalizeSiteName の NFKC＋小文字化を通していないとここで落ちる）
    await page.getByTestId('site-filter-text').fill('lululemon')
    await expect.poll(() => myTabs(page), '全角登録の現場が半角小文字で引ける').toEqual([SITE_D])
  })

  test('★AC2: 元請けで絞れる。現場名と併用できる（AND）', async ({ page }) => {
    await open(page)

    await page.getByTestId('site-filter-contractor').selectOption({ label: PRIME_1 })
    await expect.poll(() => myTabs(page), '甲の現場だけ').toEqual([SITE_A, SITE_C])

    // AND：甲 かつ 名前に「さくら」
    await page.getByTestId('site-filter-text').fill('さくら')
    await expect.poll(() => myTabs(page)).toEqual([SITE_C])

    // ★OR で実装されていたら SITE_B（乙・名前不一致）が混ざる
    await page.getByTestId('site-filter-text').fill('かすみ')
    await expect.poll(() => myTabs(page), '甲AND かすみ = 該当なし（ORなら乙の現場が出る）').toEqual([])
    await expect(page.getByTestId('site-filter-empty')).toBeVisible()
  })

  test('AC3: クリアで全件に戻る', async ({ page }) => {
    await open(page)
    await page.getByTestId('site-filter-text').fill('さくら')
    await expect.poll(() => myTabs(page)).toHaveLength(1)

    await page.getByTestId('site-filter-clear').click()
    await expect.poll(() => myTabs(page)).toHaveLength(4)
    await expect(page.getByTestId('site-filter-text')).toHaveValue('')
    await expect(page.getByTestId('site-filter-clear'), '絞っていない時は出さない').toHaveCount(0)
  })

  test('★AC4: 0件のとき「該当なし」と分かる（無言の空タブにしない）', async ({ page }) => {
    await open(page)
    await page.getByTestId('site-filter-text').fill(`存在しない現場${TS}`)

    await expect(page.getByTestId('site-filter-empty')).toBeVisible()
    await expect(page.locator('.tabs')).toHaveCount(0)
    // 表も内訳も残さない（前の現場の数字が出たままだと「0件なのに金額がある」に見える）
    await expect(page.locator('.table-wrap')).toHaveCount(0)
    await expect(page.getByTestId('vendor-breakdown')).toHaveCount(0)
  })

  test('★AC5: 絞り込んでも集計値は変わらない（表示だけの機能）', async ({ page }) => {
    await open(page)

    // 絞る前：さくら工場を選んで月計合計を控える
    await page.locator('.tabs .tab', { hasText: SITE_C }).click()
    // 月計の総合計セル（業者別内訳にも .total-col があるので日表側に限定する）
    const totalCell = page.locator('.table-wrap tfoot .total-col')
    await expect(totalCell).toBeVisible()
    const before = (await totalCell.innerText()).trim()
    expect(before, '金額が出ている前提（0円だと差が見えない）').not.toBe('¥0')

    // 絞ったあと：同じ現場の月計が1円も動かないこと
    await page.getByTestId('site-filter-contractor').selectOption({ label: PRIME_1 })
    await expect.poll(() => myTabs(page)).toEqual([SITE_A, SITE_C])
    await page.locator('.tabs .tab', { hasText: SITE_C }).click()
    await expect(totalCell, '★絞り込みが集計に漏れていない').toHaveText(before)

    // 元請けが未設定の現場は「元請けで絞ると出てこない」（分からない現場を混ぜない）
    await expect.poll(() => myTabs(page)).not.toContain(SITE_D)
  })
})
