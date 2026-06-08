// ============================================================
//  liff.ai-receipt.spec.ts （dev モード）
//  領収書AI解析を 駐車場代・高速代・電車 に流用
//  - analyze-receipt は外部API(Gemini)依存のため page.route でスタブし決定的に検証
//  - 電車が明細ごと領収書(per-item file + AI解析)になっていること
//  - 電車(明細ごと)を送信 → daily_reports.trains に正しく保存（型変更の保存検証）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId } from './helpers'

// 1x1 PNG（ダミー領収書）
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const dummyFile = { name: 'receipt.png', mimeType: 'image/png', buffer: PNG_1x1 }

async function openExpenseForm(page: any) {
  await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 })
  await page.waitForSelector('form.form', { timeout: 10000 })
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)
  await page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: 'あり' }) }).first().selectOption('あり')
  await page.waitForTimeout(200)
}

test('駐車・高速・電車の領収書AI解析で金額（電車は区間も）が自動入力される', async ({ page }) => {
  // analyze-receipt をスタブ（区間＋金額を返す）
  await page.route('**/analyze-receipt', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ label: '名古屋〜大阪', yen: 6600, invoiceNumber: 'T1234567890123' }),
    }),
  )

  try { await openExpenseForm(page) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }

  // 車両=あり → 駐車場代・高速代セクション
  await page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: '乗合い' }) }).first().selectOption('あり')
  await page.waitForTimeout(300)

  // 駐車場代: 追加 → 領収書添付 → AI解析 → 金額6600
  await page.getByRole('button', { name: /駐車場代を追加/ }).click()
  const pkCard = page.locator('.veh-subexpense').nth(0).locator('.lineitem-card').first()
  await pkCard.locator('input[type="file"]').setInputFiles(dummyFile)
  await pkCard.getByRole('button', { name: /AI解析/ }).click()
  await expect(pkCard.locator('input.expense-input')).toHaveValue('6600', { timeout: 10000 })

  // 高速代: 追加 → 領収書添付 → AI解析 → 金額6600
  await page.getByRole('button', { name: /高速代を追加/ }).click()
  const hwCard = page.locator('.veh-subexpense').nth(1).locator('.lineitem-card').first()
  await hwCard.locator('input[type="file"]').setInputFiles(dummyFile)
  await hwCard.getByRole('button', { name: /AI解析/ }).click()
  await expect(hwCard.locator('input.expense-input')).toHaveValue('6600', { timeout: 10000 })

  // 電車=あり → 明細ごと領収書（per-item file + AI解析）
  await page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: 'あり' }) }).nth(2).selectOption('あり')
  await page.waitForTimeout(300)
  // 電車セクション（最後の Field）の最初の明細カード
  const trCard = page.locator('.lineitem-card').filter({ has: page.locator('input[placeholder="例: 名古屋〜大阪"]') }).first()
  await expect(trCard.locator('input[type="file"]')).toHaveCount(1)  // 明細ごと領収書になっている
  await trCard.locator('input[type="file"]').setInputFiles(dummyFile)
  await trCard.getByRole('button', { name: /AI解析/ }).click()
  // 区間（label）＋金額が入る
  await expect(trCard.locator('input[placeholder="例: 名古屋〜大阪"]')).toHaveValue('名古屋〜大阪', { timeout: 10000 })
  await expect(trCard.locator('input.expense-input')).toHaveValue('6600')
})

test('電車(明細ごと)を入力して送信すると daily_reports.trains に保存される', async ({ page }) => {
  try { await openExpenseForm(page) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }

  const date = (await page.locator('.date-fixed').first().innerText()).trim()

  // 電車=あり → 区間＋金額（領収書なし＝アップロードでabortしない）
  await page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: 'あり' }) }).nth(2).selectOption('あり')
  await page.waitForTimeout(300)
  const trCard = page.locator('.lineitem-card').filter({ has: page.locator('input[placeholder="例: 名古屋〜大阪"]') }).first()
  await trCard.locator('input[placeholder="例: 名古屋〜大阪"]').fill('東京〜横浜')
  await trCard.locator('input.expense-input').fill('480')

  await page.locator('button[type="submit"].btn-submit').click()
  await expect(page.getByText(/送信完了|更新しました/)).toBeVisible({ timeout: 20000 })

  // DB検証: trains に明細が保存される
  const userId = await getDevUserId()
  let saved: any = null
  for (let i = 0; i < 10 && !saved; i++) {
    const rows = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${date}&select=sites`)
    const s = rows?.[0]?.sites?.find((x: any) => (x.expenses?.trains || []).some((t: any) => t.yen === 480))
    if (s) saved = s
    else await new Promise(r => setTimeout(r, 500))
  }
  expect(saved, 'trains に当該明細が保存される').toBeTruthy()
  const tr = saved.expenses.trains.find((t: any) => t.yen === 480)
  expect(tr.label).toBe('東京〜横浜')
  expect(tr.files, 'files キーは保存JSONに残らない（サニタイズ）').toBeUndefined()
})
