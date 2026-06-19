// ============================================================
//  liff.report-draft.spec.ts （dev モード）
//  日報フォームの「下書き自動保存／復元」：
//   入力途中 → リロード（中断相当）→ 復元バナー＋入力値が戻る → 破棄で新規。
//  ※ 送信はしない（自動保存→復元のみ検証）。localStorage は前後でクリア。
// ============================================================
import { test, expect } from '@playwright/test'

const clearDrafts = `() => Object.keys(localStorage).filter(k => k.startsWith('sido:report-draft')).forEach(k => localStorage.removeItem(k))`

test('下書き自動保存: 入力 → リロード → 復元バナー＋値が戻る → 破棄', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }

  // 既存下書きをクリアしてクリーンな状態から
  await page.evaluate(clearDrafts)
  await page.reload({ waitUntil: 'networkidle' })

  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 現場を選択（フォーム状態を変更＝下書き自動保存のトリガ）
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await expect(siteSelect).toBeVisible()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(1300)   // 800ms デバウンス + 余裕で確実に保存

  // リロード（＝中断して後で戻る相当）→ 復元バナー＋選択が戻る
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 10000 })
  await expect(page.locator('.draft-banner')).toBeVisible({ timeout: 8000 })
  const restored = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await expect(restored).not.toHaveValue('')   // 復元され空でない

  // 「破棄して新規入力」でバナーが消え、再リロードでも復元されない（下書き削除済み）
  await page.locator('.draft-discard').click()
  await expect(page.locator('.draft-banner')).toBeHidden()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 10000 })
  await expect(page.locator('.draft-banner')).toBeHidden()

  // 後始末
  await page.evaluate(clearDrafts)
})
