// ============================================================
//  scripts/release-note-pdf.mjs
//  本番反映のたびに「何が本番に出たか」をA4ペライチのPDFにする。
//
//  出所: 2026-08-15 ユーザー指示
//   「本番反映したタイミングで何が本番に出たかっていうのを、今僕が理解しきれて
//     いない部分があるので、ペライチのPDFで箇条書きでわかりやすく簡潔にまとめて
//     毎回出力してもらえるようにしたら」
//
//  ★A4 1枚に収める。溢れたら削る（技術的な内訳は書かない）。
//   読む人は「作業員/管理者から見て何が変わるか」を知りたいのであって、
//   コミットの一覧を知りたいわけではない。
//
//  使い方:
//    node scripts/release-note-pdf.mjs <入力HTML> [出力PDF]
//  例:
//    node scripts/release-note-pdf.mjs /tmp/release-2026-08-15.html docs/releases/2026-08-15.pdf
// ============================================================
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const [, , inputArg, outputArg] = process.argv
if (!inputArg) {
  console.error('使い方: node scripts/release-note-pdf.mjs <入力HTML> [出力PDF]')
  process.exit(1)
}

const input = resolve(inputArg)
const output = resolve(outputArg ?? input.replace(/\.html?$/i, '') + '.pdf')
const html = readFileSync(input, 'utf8')

// 印刷用の最低限のスタイル。本文HTML側は中身だけ書けばよいようにする。
const SHELL = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 14mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
    color: #1f2937; font-size: 10.5pt; line-height: 1.55; margin: 0;
  }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  .meta { font-size: 9pt; color: #6b7280; margin: 0 0 5mm; }
  h2 {
    font-size: 11pt; margin: 5mm 0 2mm; padding: 1.2mm 2.5mm;
    background: #f1f5f9; border-left: 3px solid #06C755; border-radius: 2px;
  }
  ul { margin: 0 0 0 5mm; padding: 0; }
  li { margin: 0 0 1.2mm; }
  li b { font-weight: 700; }
  .note {
    margin-top: 5mm; padding: 3mm; font-size: 9.5pt;
    background: #fff7ed; border: 1px solid #fdba74; border-radius: 3px;
  }
  .note h2 { background: none; border: none; padding: 0; margin: 0 0 1.5mm; color: #9a3412; }
  .muted { color: #6b7280; }
  footer { margin-top: 6mm; font-size: 8.5pt; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 2mm; }
</style></head><body>${html}</body></html>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent(SHELL, { waitUntil: 'load' })
  mkdirSync(dirname(output), { recursive: true })
  await page.pdf({ path: output, format: 'A4', printBackground: true })

  // ★1枚に収まったかを機械で確かめる。溢れていたら黙って2枚出さずに警告する
  //  （「ペライチ」が要件なので、超えたら中身を削るべき）。
  const pages = Number(await page.evaluate(() => {
    const h = document.documentElement.scrollHeight
    return Math.ceil(h / (297 - 26) / (96 / 25.4))   // A4高 - 上下マージン(mm) → px換算
  }))
  console.log(`✓ 出力: ${output}`)
  if (pages > 1) console.warn(`⚠ 1枚に収まっていない可能性があります（推定 ${pages} ページ）。中身を削ってください。`)
} finally {
  await browser.close()
}
