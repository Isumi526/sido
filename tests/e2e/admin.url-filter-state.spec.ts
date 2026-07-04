// ============================================================
//  admin.url-filter-state.spec.ts
//  管理画面の絞り込み/選択状態を URL クエリに同期（ページ跨ぎ/戻る/リロードで復元）(#8049)。
//  検証: 現場マスタの検索→ ?q= がURLに乗り、リロードしても検索語が復元される。
// ============================================================
import { test, expect } from '@playwright/test'

test('現場マスタ: 検索語がURL(?q=)に同期しリロードで復元される', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場')

  const kw = 'テスト'
  await page.getByPlaceholder(/検索/).fill(kw)
  // URL に ?q=テスト が乗る
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(kw)

  // リロードしても検索語が復元される（入力欄に残る）
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByPlaceholder(/検索/)).toHaveValue(kw)
  expect(new URL(page.url()).searchParams.get('q')).toBe(kw)
})
