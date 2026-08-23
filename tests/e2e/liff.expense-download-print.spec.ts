// ============================================================
//  liff.expense-download-print.spec.ts
//  経費申請書PDF(/expense/download)を印刷すると、画面用UI(no-print)が消え、
//  印刷エリアだけが出る（Notion #経費PDF2ページ: 明細が少なくても2ページになる不具合の是正）。
//  ★以前は no-print クラスは付いていたが @media print に display:none ルールが無く、
//   ナビ/期間バー/申請ボタン等が印刷され溢れて2ページ目が出ていた。
// ============================================================
import { test, expect } from '@playwright/test'

test('印刷時は画面用UI(no-print)が消え、印刷エリアだけが残る', async ({ page }) => {
  await page.goto('/expense/download', { waitUntil: 'networkidle' })
  // 印刷エリアが出るまで待つ（初期化完了）
  await expect(page.locator('.print-area')).toBeVisible({ timeout: 15000 })

  // 画面表示（screen）では期間バー等の no-print UI が見えている
  const chrome = page.locator('.period-bar.no-print')
  await expect(chrome).toBeVisible()

  // 印刷メディアに切り替える → no-print は display:none で消え、印刷エリアは残る
  await page.emulateMedia({ media: 'print' })
  await expect(chrome, '印刷では画面用UIが消える').toBeHidden()
  await expect(page.locator('.print-area'), '印刷エリアは残る').toBeVisible()
  await page.emulateMedia({ media: 'screen' })
})
