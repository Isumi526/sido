// ============================================================
//  liff.expense-past-periods.spec.ts （dev モード）
//  経費の申請書類を「過去に遡って閲覧できる」ようにした件（2026-09-08）
//
//  ★背景（佐谷さんの報告）
//   「7月分の経費申請した書類は見れなくなっていますか？」
//   期間の選択肢が `recentPeriodKeys().slice(0, 4)`＝直近4期（約2ヶ月）しか無く、
//   9月時点で7月は前半・後半とも範囲外だった。データは残っているのに開けなかった。
//
//  ★このspecが固定すること（片方だけだと事故る）
//   1. 過去の期間を選べる（閲覧できる）
//   2. ★過去の期間では申請も編集もできない（締切超過なので canApply=false）
//   2 が崩れると、締切を過ぎた経費を後から書き換えられることになる。
// ============================================================
import { test, expect } from '@playwright/test'

/** 数ヶ月前の期間キーとその表示ラベル（プルダウンに出る形式）。 */
function pastPeriod(monthsAgo: number): { key: string; label: string } {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsAgo)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  return { key: `${y}-${String(m).padStart(2, '0')}-first`, label: `${y}年${m}月前半` }
}

test.describe('経費書類: 過去の期間を閲覧できる（編集はできない）', () => {
  test('★直近4期より前の期間がプルダウンから選べる', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    const sel = page.getByTestId('period-past')
    await expect(sel, '過去の期間セレクトが出ている').toBeVisible()

    // 3ヶ月前＝チップ（直近4期＝約2ヶ月）には絶対に出ない範囲
    const { key } = pastPeriod(3)
    const opt = sel.locator(`option[value="${key}"]`)
    await expect(opt, `3ヶ月前(${key})が選択肢にある`).toHaveCount(1)

    await sel.selectOption(key)
    await page.waitForTimeout(800)
    // 選んだ期間が実際に表示に反映される
    await expect(page.locator('.period-bar')).toBeVisible()
  })

  test('★★過去の期間では申請ボタンもインライン編集も出ない（締切超過）', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    const { key } = pastPeriod(3)
    await page.getByTestId('period-past').selectOption(key)
    await page.waitForTimeout(1200)

    await expect(page.getByRole('button', { name: /経費を申請する|再申請/ }),
      '締切を過ぎた期間で申請できてはいけない').toHaveCount(0)
    await expect(page.locator('.btn-edit-toggle'),
      '締切を過ぎた期間で編集トグルが出てはいけない').toHaveCount(0)
  })

  test('チップ（直近）に戻すとプルダウンはプレースホルダに戻る', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    const sel = page.getByTestId('period-past')
    const { key } = pastPeriod(3)
    await sel.selectOption(key)
    await page.waitForTimeout(600)
    await expect(sel).toHaveValue(key)

    // 直近のチップを押す（先頭＝今月後半）
    await page.locator('.period-btn').first().click()
    await page.waitForTimeout(600)
    await expect(sel, 'チップ側を選んだらプルダウンは空に戻る').toHaveValue('')
  })
})
