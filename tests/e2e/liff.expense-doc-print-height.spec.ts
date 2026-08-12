// ============================================================
//  liff.expense-doc-print-height.spec.ts
//  経費申請書PDFが明細4行でも2ページになる（2026-08-12 レビュー中に発見）
//
//  原因: html,body { min-height:100vh } が印刷時にも効いて、明細が何行でも
//   必ず1ページ分の高さが確保され、ほぼ空の2ページ目が出ていた。
//   admin側(expenses.vue)は body * { visibility:hidden } で印刷対象を絞っているため
//   同じ症状が出ておらず、実際 admin のPDFは 1/1、liff のPDFだけ 1/2 だった。
//
//  ★客先に渡す書類なので体裁として実害がある。
//
//  判定方法: 印刷メディアをエミュレートして、ページ全体の高さが
//   「中身の高さ」に収まっているか（＝ビューポート分の下駄を履いていないか）を見る。
//   ページ数そのものはブラウザからは取れないため、原因である高さで固定する。
// ============================================================
import { test, expect } from '@playwright/test'

test.describe('経費申請書の印刷レイアウト', () => {
  test('★印刷時に画面高さ分の余白を作らない（空の2ページ目を出さない）', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    // 明細が描画されるまで待つ（無いと高さの比較に意味が無い）
    await expect(page.locator('.print-area')).toBeVisible({ timeout: 20000 })

    await page.emulateMedia({ media: 'print' })

    const m = await page.evaluate(() => {
      const de = document.documentElement
      const body = document.body
      const cs = getComputedStyle(body)
      const csHtml = getComputedStyle(de)
      return {
        bodyMinHeight: cs.minHeight,
        htmlMinHeight: csHtml.minHeight,
        // 中身の高さ（印刷対象）と、実際の文書の高さ
        printAreaHeight: (document.querySelector('.print-area') as HTMLElement)?.getBoundingClientRect().height ?? 0,
        scrollHeight: de.scrollHeight,
        viewport: window.innerHeight,
      }
    })

    // ★min-height が viewport 由来で残っていないこと（これが2ページ目の正体）
    expect(m.bodyMinHeight, 'body の min-height を印刷時に解除している').not.toMatch(/vh$/)
    expect(m.htmlMinHeight, 'html の min-height を印刷時に解除している').not.toMatch(/vh$/)

    // 中身が画面高さより短い時に、文書全体が画面高さぶん引き伸ばされていないこと
    if (m.printAreaHeight > 0 && m.printAreaHeight < m.viewport) {
      expect(m.scrollHeight, '★中身より文書が高い＝空白ページの元になる')
        .toBeLessThan(m.viewport + 40)
    }
  })

  test('用紙設定が print.vue と揃っている（同じ書類が2種類の体裁で出ない）', async ({ page }) => {
    // ★@page は CSSOM から安定して拾えない（ブラウザによって cssRules に現れない）ので、
    //  配信された CSS テキストを直接見る。DOM越しに測れないものを「無い」と判定しない。
    const css: string[] = []
    page.on('response', async (r) => {
      const ct = r.headers()['content-type'] ?? ''
      if (ct.includes('text/css') || r.url().includes('download')) {
        css.push(await r.text().catch(() => ''))
      }
    })
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await expect(page.locator('.print-area')).toBeVisible({ timeout: 20000 })
    const all = css.join('\n')
    expect(all.includes('@page') && /A4/.test(all), '@page size:A4 portrait が配信されている').toBe(true)
  })
})
