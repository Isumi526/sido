// ============================================================
//  liff.diff-parking-highway.spec.ts
//  日報の編集差分に「駐車場代」「高速代」が出ることを固定する（2026-08-10）
//
//  ★経緯: pushExpenseDiffs は 車両/電車/宿泊/ゴミ/その他/雑経費 しか比較しておらず、
//   新形式の parkings[] / highways[] を1行も見ていなかった。駐車場代を 800→1,800 に
//   変えても差分が空になり、承認画面に「表示できる差分がありません」と出る。
//   承認者は何が変わったか分からないまま承認することになる＝監査の穴。
//   旧形式(vehicles[].parkingYen)は vehSummary が拾っていたため、
//   旧→新へ移行する編集（車両配下スカラー → parkings配列）で特に見えなくなっていた。
//   /review の人力テスト中に実際にその形の編集を踏んで発覚した。
//
//  ★UIではなく computeDiff を直接呼ぶ。駐車場代の入力欄は「車両=あり」の時だけ出る等
//   前提が多く、UI操作にすると壊れやすいうえ、固定したいのは差分計算そのものだから。
//   ★Nuxt dev はソースを /_nuxt/<path> で配信する（/utils/... は HTML が返るので注意）。
// ============================================================
import { test, expect } from '@playwright/test'

/** ブラウザ内で computeDiff を呼び、差分行を返す */
async function diffOf(page: import('@playwright/test').Page, oldExpenses: any, newExpenses: any): Promise<string[]> {
  await page.goto('/history', { waitUntil: 'networkidle' })
  return await page.evaluate(async ({ o, n }) => {
    const mod = await import('/_nuxt/utils/diffReport.ts')
    const site = (expenses: any) => ({ siteName: 'テスト現場B', workers: [], subcontractors: [], expenses })
    return (mod as any).computeDiff(
      { is_working: true, note: '', sites: [site(o)], is_business_trip: false, gasoline_items: [] },
      { isWorking: true, note: '', sites: [site(n)], isBusinessTrip: false, gasolineItems: [] },
    )
  }, { o: oldExpenses, n: newExpenses })
}

const empty = { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] }

test('★駐車場代の金額変更が差分に出る（新形式 parkings[]）', async ({ page }) => {
  const diffs = await diffOf(page,
    { ...empty, parkings: [{ yen: 800, tategae: false }] },
    { ...empty, parkings: [{ yen: 1800, tategae: false }] })
  expect(diffs.join(' / '), '★駐車場代が差分に出る').toMatch(/駐車場代/)
  expect(diffs.join(' / '), '金額が分かる').toMatch(/1,800/)
})

test('★高速代の金額変更が差分に出る（新形式 highways[]）', async ({ page }) => {
  const diffs = await diffOf(page,
    { ...empty, highways: [{ yen: 1000, tategae: false }] },
    { ...empty, highways: [{ yen: 2500, tategae: false }] })
  expect(diffs.join(' / ')).toMatch(/高速代/)
  expect(diffs.join(' / ')).toMatch(/2,500/)
})

test('★旧形式(vehicles[].parkingYen)から新形式へ移行した編集でも差分が空にならない', async ({ page }) => {
  const diffs = await diffOf(page,
    { ...empty, vehicles: [{ vehicleName: '軽トラ2号', parkingYen: 800, parkingTategae: true }] },
    { ...empty, parkings: [{ yen: 1200, tategae: false }, { yen: 600, tategae: true }] })
  expect(diffs.length, '★「変更なし」に見えていた形').toBeGreaterThan(0)
  expect(diffs.join(' / '), '合計 800 → 1,800 が分かる').toMatch(/1,800/)
})

test('駐車場代を変えていなければ差分に出ない（既存の粒度を変えない）', async ({ page }) => {
  const diffs = await diffOf(page,
    { ...empty, parkings: [{ yen: 800, tategae: false }] },
    { ...empty, parkings: [{ yen: 800, tategae: true }] })   // 立替フラグだけ変更
  expect(diffs.join(' / '), '金額が同じなら駐車場代の行は出ない').not.toMatch(/駐車場代/)
})
