// ============================================================
//  liff.report-similar-site-pick.spec.ts
//  日報フォームの「似た現場が既にあります」警告：候補名をタップすると
//  手入力(その他の現場)をやめて現場セレクトへ直接反映される
//  （2026-07-16・現場名類似候補 複数箇所対応チケット・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'

test('似た現場候補をタップすると現場選択欄にそのまま反映される', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }

  if (await page.getByText('送信済みです').count()) {
    test.skip(true, '全日送信済みのためフォーム無し')
    return
  }
  await page.waitForSelector('form.form', { timeout: 10000 })

  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: '＋ 新しい現場を登録する' }) }).first()
  await expect(siteSelect).toBeVisible()
  await siteSelect.selectOption({ label: '＋ 新しい現場を登録する' })

  // 末尾を落とした表記ゆれで既存の「テスト現場A」を似た現場として検知させる
  const customInput = page.locator('input.mt6').first()
  await customInput.fill('テスト現場A'.slice(0, -1))

  const pick = page.locator('[data-testid="similar-site-pick"]', { hasText: 'テスト現場A' })
  await expect(pick).toBeVisible({ timeout: 10000 })
  await pick.click()

  // 手入力(__other__)をやめ、現場セレクトが既存の「テスト現場A」に直接切り替わる
  await expect(siteSelect).toHaveValue('テスト現場A')
})
