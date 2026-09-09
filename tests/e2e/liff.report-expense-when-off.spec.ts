// ============================================================
//  liff.report-expense-when-off.spec.ts （dev モード）
//  有給・稼働なしの日でも「現場に紐づく経費」を日報から入力できる（2026-09-08）
//
//  ★背景
//   今井さん「有給で自分が休んでいる時に経費が出た場合はどのようにできますか？」
//   佐谷さんの件と同様、有給中に別日のホテルを取る等で現場に紐づく経費が出る。
//   それまでは 稼働あり を選んだ時しか現場ブロックが描画されず、入力する場所が無かった。
//
//  ★一元化した形（設計の要点）
//   既に「下請けのみ（自分は稼働なし）」チェック＝`selfWorking='なし'`（workers: []）で
//   「稼働なしで経費だけ登録する」手段があった。
//   有給/稼働なしの日は **全ブロックを自動的にその状態にする**だけで、
//   データの持ち方は増やしていない（workers: [] は既存の集計・保存・承認が既に扱える）。
//
//  ★このspecが固定すること
//   1. 有給/稼働なしでも現場ブロックが出て、経費が入力できる
//   2. その日は作業時間（作業員）の入力が出ない＝人件費は発生しない
//   3. 稼働ありに戻すと作業時間の入力が戻る
// ============================================================
import { test, expect } from '@playwright/test'

async function openReport(page: any) {
  await page.goto('/report', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('site-select-0')).toBeVisible({ timeout: 20000 })
}

test.describe('有給・稼働なしの日の経費入力', () => {
  test('★有給の既定は「何も無い日」。現場UIは畳まれ、そのまま送信できる', async ({ page }) => {
    await openReport(page)
    await page.getByTestId('work-status').selectOption('paid_leave')
    await page.waitForTimeout(600)

    await expect(page.getByTestId('expense-only-note'), 'そのまま送信できる旨の案内').toBeVisible()
    await expect(page.getByTestId('site-select-0'), '既定では現場UIを出さない（情報過多にしない）').toBeHidden()
    await expect(page.getByTestId('expense-open'), '経費がある人だけ開ける').toBeVisible()

    // ★何も入れずに送信できる（現場は稼働なしの日は必須ではない）
    await page.getByTestId('omission-confirm').check()
    await expect(page.locator('button[type="submit"].btn-submit'), '何も無くても送信できる').toBeEnabled()
  })

  test('★「経費を登録する」を押すと現場UIが出て、経費を紐づけられる', async ({ page }) => {
    await openReport(page)
    await page.getByTestId('work-status').selectOption('paid_leave')
    await page.waitForTimeout(600)
    await page.getByTestId('expense-open').click()
    await page.waitForTimeout(400)

    await expect(page.getByTestId('site-select-0'), '開けば現場を選べる').toBeVisible()
    await expect(page.getByTestId('expense-open'), '開いたらボタンは消える').toHaveCount(0)
  })

  test('★有給の日は作業時間（作業員）の入力が出ない＝人件費は発生しない', async ({ page }) => {
    await openReport(page)
    // まず稼働ありで現場を選び、作業員の入力が出ることを確かめる（対照）
    const siteSel = page.getByTestId('site-select-0')
    const opt = await siteSel.locator('option').nth(1).getAttribute('value')
    await siteSel.selectOption(opt!)
    await page.waitForTimeout(600)
    await expect(page.locator('.self-off-check'), '稼働ありなら「下請けのみ」チェックが出る').toBeVisible()

    // 有給に切り替えると稼働の入力が消える（現場が入っているので現場UIは畳まれない）
    await page.getByTestId('work-status').selectOption('paid_leave')
    await page.waitForTimeout(600)
    await expect(page.locator('.self-off-check'), '有給では稼働の入力自体を出さない').toHaveCount(0)
    // ★入力済みの現場は消さない（消えて見えると入れ直しになる）
    await expect(page.getByTestId('site-select-0'), '入力済みの現場は畳まない').toBeVisible()
  })

  test('稼働ありに戻すと作業時間の入力が戻る', async ({ page }) => {
    await openReport(page)
    const siteSel = page.getByTestId('site-select-0')
    const opt = await siteSel.locator('option').nth(1).getAttribute('value')
    await siteSel.selectOption(opt!)
    await page.getByTestId('work-status').selectOption('off')
    await page.waitForTimeout(500)
    await expect(page.locator('.self-off-check')).toHaveCount(0)

    await page.getByTestId('work-status').selectOption('working')
    await page.waitForTimeout(600)
    await expect(page.locator('.self-off-check'), '稼働ありに戻れば稼働の入力も戻る').toBeVisible()
  })

  test('稼働なし（休み）も同じ（既定は畳む・開けば出る）', async ({ page }) => {
    await openReport(page)
    await page.getByTestId('work-status').selectOption('off')
    await page.waitForTimeout(600)
    await expect(page.getByTestId('expense-only-note')).toBeVisible()
    await expect(page.getByTestId('site-select-0')).toBeHidden()
    await page.getByTestId('expense-open').click()
    await page.waitForTimeout(400)
    await expect(page.getByTestId('site-select-0')).toBeVisible()
  })
})
