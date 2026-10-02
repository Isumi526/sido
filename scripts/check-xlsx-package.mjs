#!/usr/bin/env node
// ============================================================
//  scripts/check-xlsx-package.mjs
//  .xlsx の「包み」が壊れていないかを機械で確かめる（2026-10-02 見積E-6b）。
//
//  ★なぜ要るか: Excel は中身（セル）が正しくても、包みの宣言が1行欠けるだけで
//   「修復または削除しますか」を出す＝静かに壊れる（2026-09-09 に実際に踏んだ。
//   openpyxl で保存すると画像・図形と [Content_Types].xml の <Default Extension="jpeg"> が落ちた）。
//  ★確かめること:
//   1. [Content_Types].xml がある
//   2. 中の全パーツに、拡張子の Default か パーツ名の Override で種類の宣言がある
//   3. 全ての .rels の行き先（外部リンク以外）が実在する
//   4. 図形・画像（xl/drawings・xl/media）があれば、それを指す rels がある（取り残しが無い）
//
//  使い方: node scripts/check-xlsx-package.mjs <file.xlsx> [...]
//  関数として: import { checkXlsxPackage } from './check-xlsx-package.mjs'  → 問題の配列（空なら OK）
//  ★依存なし（node:zlib だけ）。CI でも、テンプレを作るスクリプトの最後でも同じものを使う。
// ============================================================
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'

/** zip の中身を {パーツ名: Buffer} にする（central directory を読む・暗号化/zip64 は扱わない） */
export function readZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip の終わりが見つからない（.xlsx ではない？）')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory が壊れている')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtraLen = buf.readUInt16LE(local + 28)
    const data = buf.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize)
    if (!name.endsWith('/')) files.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data))
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]

/** 問題の一覧（日本語の1行ずつ）。空なら OK */
export function checkXlsxPackage(buf) {
  const files = readZip(buf)
  const problems = []
  const ct = files.get('[Content_Types].xml')
  if (!ct) return ['[Content_Types].xml が無い']
  const ctXml = ct.toString('utf8')
  const defaults = new Set([...ctXml.matchAll(/<Default\b[^>]*>/g)].map((m) => (attr(m[0], 'Extension') ?? '').toLowerCase()))
  const overrides = new Set([...ctXml.matchAll(/<Override\b[^>]*>/g)].map((m) => attr(m[0], 'PartName') ?? ''))

  for (const name of files.keys()) {
    if (name === '[Content_Types].xml') continue
    // ★_rels/.rels のように名前が「.拡張子」だけのものもある（path.extname は空を返す）ので最後の . から取る
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
    if (!defaults.has(ext) && !overrides.has(`/${name}`)) {
      problems.push(`種類の宣言が無い: /${name}（[Content_Types].xml に Default Extension="${ext}" か Override が要る）`)
    }
  }

  const targeted = new Set()
  for (const [name, data] of files) {
    if (!name.endsWith('.rels')) continue
    // xl/_rels/workbook.xml.rels → 基準は xl/ 、_rels/.rels → 基準は ルート
    const base = posix.dirname(posix.dirname(name))
    for (const m of data.toString('utf8').matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], 'TargetMode') === 'External') continue
      const target = attr(m[0], 'Target') ?? ''
      const resolved = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(base === '.' ? '' : base, target))
      targeted.add(resolved)
      if (!files.has(resolved)) problems.push(`行き先が無い: ${name} → ${target}`)
    }
  }
  for (const name of files.keys()) {
    if ((name.startsWith('xl/drawings/') && !name.includes('/_rels/')) || name.startsWith('xl/media/')) {
      if (!targeted.has(name)) problems.push(`どこからも指されていない図形・画像: ${name}`)
    }
  }
  return problems
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const paths = process.argv.slice(2)
  if (!paths.length) { console.error('使い方: node scripts/check-xlsx-package.mjs <file.xlsx> [...]'); process.exit(2) }
  let bad = 0
  for (const p of paths) {
    const problems = checkXlsxPackage(readFileSync(p))
    if (problems.length) { bad++; console.error(`✗ ${p}`); for (const x of problems) console.error(`  - ${x}`) }
    else console.log(`✓ ${p}（包みの宣言・行き先 OK）`)
  }
  process.exit(bad ? 1 : 0)
}
