// ============================================================
//  admin.drawing-independent.spec.ts
//  図面の材料抽出が「見積・発注」から独立していること。
//
//  ★経緯（2026-08-19 大塚さん・3回明言）:
//   「材料抽出としては、めちゃくちゃ別ですね」「多分別です」
//   「あれは別に見積もりに関連付けなくてもいい、出ればいいってことです」
//
//   実装は元から独立していた（estimate-builder から drawing-material-extract を
//   呼んでいる箇所はゼロ・結果は drawing_material_extractions に独立保存）が、
//   **メニューとルートのフラグだけ**が見積に巻き込まれていて、見積機能をOFFにしている
//   会社では図面の読み取りごと使えなくなっていた。
//
//   ★R53の「解析完了バッジ」も見積ナビに出していたので、見積を使っていない会社には
//    終わったことに気づく場所が無かった。図面ナビへ移した。
// ============================================================
import { test, expect } from '@playwright/test'
import { disableEstimateFeature, restoreEstimateFeature } from './helpers'

test.describe('図面の材料抽出は見積から独立', () => {
  test.afterAll(async () => {
    // ★戻し忘れると、アルファベット順で後に来る見積系specが全部落ちる
    await restoreEstimateFeature()
  })

  test('★見積機能がOFFでも図面の読み取りは開ける', async ({ page }) => {
    await disableEstimateFeature()
    await page.goto('/drawing-materials', { waitUntil: 'networkidle' })

    // 見積フラグOFFだとダッシュボードへ飛ばされていた（それが不具合）
    expect(page.url(), '★見積OFFでも追い出されない').toContain('/drawing-materials')
    await expect(page.locator('body'), '画面の中身が出る').toContainText(/図面|材料/, { timeout: 15000 })
  })

  test('★見積機能がOFFでもメニューに図面が残る', async ({ page }) => {
    await disableEstimateFeature()
    await page.goto('/', { waitUntil: 'networkidle' })

    const link = page.locator('a[href="/drawing-materials"], a[href="#/drawing-materials"]')
    await expect(link.first(), '★見積OFFでもメニューから辿れる').toBeVisible({ timeout: 15000 })

    // 見積のメニューは消えている（フラグ自体は効いたまま＝分離できている証拠）
    await expect(page.locator('a[href="/estimate-list"], a[href="#/estimate-list"]'),
      '見積のメニューはOFFで消える').toHaveCount(0)
  })

  test('見積をONに戻すと従来どおり見積メニューも出る（回帰なし）', async ({ page }) => {
    await restoreEstimateFeature()
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('a[href="/estimate-list"], a[href="#/estimate-list"]').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('a[href="/drawing-materials"], a[href="#/drawing-materials"]').first()).toBeVisible()
  })
})
