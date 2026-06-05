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

// ── 回帰: 送信済みの過去日報を「編集」で開くと、誤って「過去の未送信日報です」が出ていた ──
test('編集モード（送信済みの過去日報）では「過去の未送信日報です」を表示しない', async ({ page }) => {
  try { await page.goto('/history', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }

  // 履歴の「編集する →」リンクから、過去日付（< 今日）の送信済み日報を1件選ぶ
  const links = page.locator('a.btn-edit')
  await links.first().waitFor({ timeout: 10000 }).catch(() => {})
  const n = await links.count()
  if (!n) { test.skip(true, '履歴に編集可能な日報が無い'); return }

  const today = new Date().toISOString().split('T')[0]
  let target: ReturnType<typeof links.nth> | null = null
  for (let i = 0; i < n; i++) {
    const href = await links.nth(i).getAttribute('href')
    const m = href?.match(/edit=(\d{4}-\d{2}-\d{2})/)
    if (m && m[1] < today) { target = links.nth(i); break }
  }
  if (!target) { test.skip(true, '過去日付の送信済み日報が無い'); return }

  await target.click()

  // 編集モードバナーは表示される（= 既存の日報を開いている）
  await expect(page.getByText('過去の日報を編集中')).toBeVisible({ timeout: 10000 })
  await page.waitForSelector('form.form', { timeout: 10000 })
  // 送信済みなので、誤った「過去の未送信日報です」バナーは出ない
  await expect(page.getByText('過去の未送信日報です')).toHaveCount(0)
})
