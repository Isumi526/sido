// ============================================================
//  scripts/release-doc-pdf.mjs
//  「詳しめ」のリリース資料をPDFにする（画面キャプチャ入り・複数ページ可）。
//
//  ★ペライチ版（release-note-pdf.mjs）とは別物。使い分け:
//   ・release-note-pdf.mjs … 毎回の本番反映。A4 1枚・箇条書き。溢れたら削る。
//   ・こちら              … 業務フローが変わる回。図とキャプチャで手順を追えるようにする。
//     2026-08-31 ユーザー指示「業務フローが全体に変わったりとか、想定するケースも
//     多岐にわたるので、しっかりドキュメント化して送りたい。画面キャプチャとか
//     業務フローの流れが視覚的に分かりやすい形で、かつ長文になりすぎない」
//
//  ★画像は相対パスで参照する。setContent ではなく file:// で開くのはそのため
//   （setContent だとベースURLが無く、img が全部壊れる）。
//
//  使い方:
//    node scripts/release-doc-pdf.mjs <入力HTML> [出力PDF]
// ============================================================
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const [, , inputArg, outputArg] = process.argv
if (!inputArg) {
  console.error('使い方: node scripts/release-doc-pdf.mjs <入力HTML> [出力PDF]')
  process.exit(1)
}
const input = resolve(inputArg)
if (!existsSync(input)) { console.error(`入力が見つかりません: ${input}`); process.exit(1) }
const output = resolve(outputArg ?? input.replace(/\.html?$/i, '') + '.pdf')

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(`file://${input}`, { waitUntil: 'load' })
  // 画像の読み込み完了を待つ（待たないと空枠のままPDF化される）
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images)
      .filter(img => !img.complete)
      .map(img => new Promise(res => { img.onload = img.onerror = res })))
  })
  mkdirSync(dirname(output), { recursive: true })
  await page.pdf({ path: output, format: 'A4', printBackground: true })
  console.log(`✓ ${output}`)
} finally {
  await browser.close()
}
