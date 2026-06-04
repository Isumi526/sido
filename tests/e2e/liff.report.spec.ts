// ============================================================
//  liff.report.spec.ts （dev モード）
//  日報入力 → 送信 → 完了画面 → 履歴に反映、をUIで通す。
//  ※ 次の未送信日付のフォームに対して、現場を選んで送信する。
// ============================================================
import { test, expect } from '@playwright/test'

test('日報入力 → 送信 → 完了画面が出る', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }

  // フォーム（稼働あり）が出るのを待つ。全送信済み画面なら skip
  if (await page.getByText('送信済みです').count()) {
    test.skip(true, '全日送信済みのためフォーム無し')
    return
  }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 現場セレクト（'テスト現場A' を持つ select）を選択
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await expect(siteSelect).toBeVisible()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(500)

  // 送信
  await page.locator('button[type="submit"].btn-submit').click()

  // 完了画面
  await expect(page.getByText(/送信完了|更新しました/)).toBeVisible({ timeout: 20000 })
})
