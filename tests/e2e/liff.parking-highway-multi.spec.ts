// ============================================================
//  liff.parking-highway-multi.spec.ts （dev モード）
//  日報フォームで駐車場代・高速代を複数行 追加/削除できる（入力UI）
//  ＋ 送信 → daily_reports へ正しいJSONで保存 → 編集で往復復元（コアデータ保存）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId } from './helpers'

test('駐車場代を2行・高速代を1行 追加でき、削除もできる', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 現場を選択
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)

  // 経費=あり にして交通経費セクションを出す
  const expenseSelect = page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: 'あり' }) }).first()
  await expenseSelect.selectOption('あり')
  await page.waitForTimeout(300)

  // 車両=なし の時点では駐車場代・高速代は出ない（車両経費の中に入れたため）
  await expect(page.getByRole('button', { name: /駐車場代を追加/ })).toHaveCount(0)

  // 車両=あり にして駐車場代・高速代を表示
  const vehicleSelect = page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: '乗合い' }) }).first()
  await vehicleSelect.selectOption('あり')
  await page.waitForTimeout(300)

  // 駐車場代を2行追加
  const addParking = page.getByRole('button', { name: /駐車場代を追加/ })
  await expect(addParking).toBeVisible()
  await addParking.click()
  await addParking.click()
  // 高速代を1行追加
  const addHighway = page.getByRole('button', { name: /高速代を追加/ })
  await addHighway.click()

  // .lineitem-card が3枚（駐車2＋高速1）
  await expect(page.locator('.lineitem-card')).toHaveCount(3)
  // 高速代カードには ETCカード select（カード①）がある
  await expect(page.locator('.lineitem-card option', { hasText: 'カード①' }).first()).toHaveCount(1)

  // 駐車場代カードの1枚目を ✕ 削除 → 2枚に減る
  await page.locator('.lineitem-card').first().locator('.btn-icon-sm').click()
  await expect(page.locator('.lineitem-card')).toHaveCount(2)
})

// ── コアデータ: 送信 → daily_reports に正しく保存 → 編集で往復復元 ──
test('駐車場代・高速代を入力して送信すると daily_reports に正しいJSONで保存され、編集で復元される', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 送信対象日を控える（往復検証で同じ日を編集モードで開く）
  const date = (await page.locator('.date-fixed').first().innerText()).trim()

  // 現場選択 → 経費=あり → 車両=あり
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)
  await page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: 'あり' }) }).first().selectOption('あり')
  await page.waitForTimeout(200)
  await page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: '乗合い' }) }).first().selectOption('あり')
  await page.waitForTimeout(300)

  // 駐車場代を2行（333 / 444=立替）
  const addParking = page.getByRole('button', { name: /駐車場代を追加/ })
  await addParking.click(); await addParking.click()
  const parkingSection = page.locator('.veh-subexpense').nth(0)
  await parkingSection.locator('.lineitem-card').nth(0).locator('input.expense-input').fill('333')
  await parkingSection.locator('.lineitem-card').nth(1).locator('input.expense-input').fill('444')
  await parkingSection.locator('.lineitem-card').nth(1).locator('.tategae-check input[type="checkbox"]').check()

  // 高速代を1行（555 / ETCカード①）
  await page.getByRole('button', { name: /高速代を追加/ }).click()
  const highwaySection = page.locator('.veh-subexpense').nth(1)
  await highwaySection.locator('.lineitem-card').nth(0).locator('input.expense-input').fill('555')
  await highwaySection.locator('.lineitem-card').nth(0).locator('select.select').selectOption('カード①')

  // 送信 → 完了
  await page.locator('button[type="submit"].btn-submit').click()
  await expect(page.getByText(/送信完了|更新しました/)).toBeVisible({ timeout: 20000 })

  // ── DB検証: daily_reports.sites に正しいJSONで保存されている ──
  const userId = await getDevUserId()
  let saved: any = null
  for (let i = 0; i < 10 && !saved; i++) {
    const rows = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${date}&select=sites`)
    if (rows?.[0]?.sites?.length) saved = rows[0]
    else await new Promise(r => setTimeout(r, 500))
  }
  expect(saved, 'daily_reports に当日の行が保存される').toBeTruthy()
  const site = (saved.sites as any[]).find(s => (s.expenses?.parkings?.length || s.expenses?.highways?.length))
  expect(site, '駐車/高速を含む現場がある').toBeTruthy()
  const exp = site.expenses

  // 駐車場代: 2件・金額・立替が正しい
  expect(exp.parkings.map((p: any) => p.yen).sort()).toEqual([333, 444])
  const pk444 = exp.parkings.find((p: any) => p.yen === 444)
  expect(pk444.tategae, '444は立替=true').toBe(true)
  // 高速代: 1件・金額・ETCカード
  expect(exp.highways).toHaveLength(1)
  expect(exp.highways[0].yen).toBe(555)
  expect(exp.highways[0].etcCard).toBe('カード①')
  // サニタイズ: File配列(files)は保存JSONに残らない
  for (const it of [...exp.parkings, ...exp.highways]) {
    expect(it.files, 'files キーは保存JSONに含めない（サニタイズ）').toBeUndefined()
  }

  // ── 往復: 編集モードで開くと駐車/高速が復元表示される ──
  await page.goto(`/report?edit=${date}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 10000 })
  // 駐車2＋高速1 のカードが復元
  await expect(page.locator('.lineitem-card')).toHaveCount(3, { timeout: 10000 })
  await expect(page.locator('.veh-subexpense').nth(0).locator('input.expense-input').nth(0)).toHaveValue('333')
  await expect(page.locator('.veh-subexpense').nth(0).locator('input.expense-input').nth(1)).toHaveValue('444')
  await expect(page.locator('.veh-subexpense').nth(1).locator('input.expense-input').nth(0)).toHaveValue('555')
})
