// ============================================================
//  admin.drawing-materials.spec.ts
//  実施図面から材料情報抽出(AI)。図面PDFをアップロードすると
//  ページ分割→Gemini解析→編集可能な表に結果が読み込まれることを検証する。
//  fixtures/sample.pdf は汎用の最小PDF(図面内容なし)のため、メーカー品番は
//  抽出されない想定(temperature=0で決定的)＝「解析は完走し、結果は空」を検証する。
//  実際の図面での抽出精度そのものはこのE2Eの対象外（Geminiの読み取り品質次第）。
//  （2026-07-11・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('実施図面 材料抽出(AI)', () => {
  test('図面PDFをアップロードすると解析が完走し(進捗表示が消え)、CSV書き出しボタンの活性状態が結果と一致する', async ({ page }) => {
    test.setTimeout(90000)   // 実Geminiコールを含むため既定30sでは不足しうる
    await page.goto('/drawing-materials', { waitUntil: 'networkidle' })
    await expect(page.locator('.empty')).toBeVisible()

    const filePath = path.resolve(__dirname, 'fixtures/sample.pdf')
    await page.locator('[data-testid="drawing-file-input"]').setInputFiles(filePath)

    await expect(page.locator('[data-testid="drawing-progress"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('[data-testid="drawing-progress"]')).toHaveCount(0, { timeout: 60000 })

    // エラー無く完走したことを明示的に確認（解析失敗でも空行/無効ボタンという見た目は同じになるため、
    // ここを確認しないと「0件抽出の成功」と「解析失敗」を区別できない）
    await expect(page.locator('.error-msg')).toHaveCount(0)

    // sample.pdfは図面内容が無いため抽出0件想定＝emptyメッセージが残り、CSVボタンは無効のまま
    const rowCount = await page.locator('.table tbody tr').count()
    if (rowCount === 0) {
      await expect(page.locator('.empty')).toBeVisible()
      await expect(page.locator('.btn-ghost')).toBeDisabled()
      // 0件抽出時は「確認してください」メッセージを出さない(確認対象が無いため)
      await expect(page.locator('[data-testid="drawing-success"]')).toHaveCount(0)
    } else {
      await expect(page.locator('.btn-ghost')).toBeEnabled()
      // AIの自動抽出結果を人が確認・修正するよう促すメッセージが出ること
      await expect(page.locator('[data-testid="drawing-success"]')).toContainText('確認・修正')
    }
  })
})
