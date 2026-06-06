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

  // リグレ: 送信後に「翌日分の日報」ボタンが出る（service_start_date設定済み＝未送信日が残る）
  // ※ 代理入力でも同ボタンが出るよう post-submit を targetUserId で統一した変更の自己経路ガード
  await expect(page.getByRole('button', { name: /の日報を入力する/ })).toBeVisible({ timeout: 10000 })
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

// ── バグ: 日報フォームから新規登録した下請業者が、次回フォームを開くとプルダウンに出ない ──
// 下請の select は「業者を選択 *」の disabled option を持つ点で他の select と区別できる。
test('新規登録した下請業者が再訪時にプルダウンへ残る', async ({ page }) => {
  const SUB_NAME = 'E2E下請業者' // upsert(onConflict)なので再実行しても重複しない

  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 送信対象の日付を控える（再訪検証は編集モードで同じ日を開く）
  const date = (await page.locator('.date-fixed').first().innerText()).trim()

  // 現場を選択（送信を成立させるため）
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)

  // 下請けの行を用意（無ければ「＋ 業者を追加」）
  const subSelectSel = page.locator('select.select').filter({ has: page.locator('option', { hasText: '業者を選択' }) })
  if (!(await subSelectSel.count())) {
    await page.getByRole('button', { name: '業者を追加' }).first().click()
  }
  const subSelect = subSelectSel.first()
  await subSelect.selectOption('__other__')
  await page.getByPlaceholder('業者名を入力 *').first().fill(SUB_NAME)

  // 送信 → 完了（このタイミングでマスタ保存を await して確実に永続化される）
  await page.locator('button[type="submit"].btn-submit').click()
  await expect(page.getByText(/送信完了|更新しました/)).toBeVisible({ timeout: 20000 })

  // 再訪（編集モードで同じ日を開く＝フォームが必ず描画される）。fetch(true)でDB最新化。
  await page.goto(`/report?edit=${date}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 下請けの行を用意してから、select の option に登録した業者が含まれることを確認
  const subSelect2sel = page.locator('select.select').filter({ has: page.locator('option', { hasText: '業者を選択' }) })
  if (!(await subSelect2sel.count())) {
    await page.getByRole('button', { name: '業者を追加' }).first().click()
  }
  await expect(
    subSelect2sel.first().locator('option', { hasText: SUB_NAME })
  ).toHaveCount(1, { timeout: 10000 })
})

// ── バグ: 編集画面(?edit=)を開いた後、アプリ内メニュー「日報登録」を押しても
//    ページが再マウントされず編集状態が残る（クエリ変化を監視していなかった）。──
test('編集画面を開いた後にメニュー「日報登録」で編集状態が残らない', async ({ page }) => {
  try { await page.goto('/history', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }

  // 過去日付の送信済み日報の編集リンクをクライアントサイド遷移で開く
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

  await expect(page.getByText('過去の日報を編集中')).toBeVisible({ timeout: 10000 })

  // アプリ内メニュー（ハンバーガー）→「日報登録」をクライアントサイド遷移で押す
  await page.locator('.app-hamburger').click()
  await page.getByRole('link', { name: '日報登録' }).click()

  // URL は /report（クエリなし）になり、編集状態（編集中バナー）が残らないこと
  await expect(page).toHaveURL(/\/report$/)
  await expect(page.getByText('過去の日報を編集中')).toHaveCount(0, { timeout: 10000 })
})
