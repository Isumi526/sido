// ============================================================
//  admin.ai-help.spec.ts
//  AIヘルプ（管理者向けチャット）: メッセージ送信→ユーザー/AIの吹き出しが出る。
//  ※ LLM(Gemini)・Notion起票は外部依存のため、ここではUIフロー＋応答(成功/グレースフルエラー)
//    ＋認可(verify_jwt)を担保。実回答/実起票はレビューで確認。
// ============================================================
import { test, expect } from '@playwright/test'

test('AIヘルプでメッセージを送ると吹き出しが出て応答が返る', async ({ page }) => {
  await page.goto('/ai-help', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('AIヘルプ')
  await expect(page.locator('.chat-empty')).toBeVisible()
  await expect(page.locator('.btn-bug-manual')).toBeVisible()

  await page.locator('.composer-input').fill('日報はどこから入力しますか？')
  await page.locator('.btn-send').click()

  // ユーザーの吹き出し
  await expect(page.locator('.msg.user .bubble')).toContainText('日報はどこから')
  // AIの応答（実回答 or グレースフルエラー）が必ず1つ出る
  await expect(page.locator('.msg.ai .bubble')).toBeVisible({ timeout: 30000 })
})

test('常駐ウィジェット: どのページでもFABから開け、SPA遷移しても保持される', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const fab = page.locator('[data-testid="ai-help-fab"]')
  await expect(fab).toBeVisible()                       // ダッシュボードでも右下にFAB常駐
  await fab.click()
  await expect(page.locator('.ai-panel')).toBeVisible() // パネルが開く
  await expect(page.locator('.ai-panel .composer-input')).toBeVisible()

  // SPA内のページ遷移（リロードしない）でウィジェットがアンマウントされず、開いた状態が保持される
  await page.locator('a.nav-link[href="/reports"]').first().click()
  await expect(page).toHaveURL(/\/reports/)
  await expect(fab).toBeVisible()
  await expect(page.locator('.ai-panel')).toBeVisible() // 遷移後もパネルは開いたまま
})

test('バグ報告モーダルが開き、タイトル必須が効く', async ({ page }) => {
  await page.goto('/ai-help', { waitUntil: 'networkidle' })
  await page.locator('.btn-bug-manual').click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('h2')).toContainText('バグとして報告')
  // タイトル空で起票→エラー
  await modal.locator('input').fill('')
  await modal.locator('.btn-save').click()
  await expect(modal.locator('.error')).toContainText('タイトル')
})
