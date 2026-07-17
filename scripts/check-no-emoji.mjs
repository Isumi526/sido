#!/usr/bin/env node
// ============================================================
//  check-no-emoji.mjs — UI(.vue)テンプレートに絵文字が無いことを検査
//  方針: UI は絵文字でなく Material Symbols アイコン(<span class="material-symbols-rounded">)を使う。
//  再発防止: `node scripts/check-no-emoji.mjs` で .vue に絵文字があれば非ゼロ終了で落とす。
//  対象: apps/admin/src, apps/liff（pages/components/composables の .vue）。" 2" 複製は除外。
//  許容: 幾何記号の一部(▲▼▸▾ 等)はソート/開閉に使われ得るため既定は絵文字ピクトグラムのみ検出。
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['apps/admin/src', 'apps/liff']
// 絵文字ピクトグラム範囲（幾何記号 ▲▼◯△✓✕★ 等は既定で除外）。異体字セレクタ付き記号(⚠️ ✏️ 等)も検出。
const EMOJI = /(?:\p{Extended_Pictographic}️?)/u

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name.includes(' 2.')) continue          // macOS " 2" 複製は無視
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }  // 壊れたsymlink等(例: apps/liff/dist未buildで一時的にdangling)はスキップ
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== '.output' && name !== 'dist') walk(p, acc) }
    else if (name.endsWith('.vue')) acc.push(p)
  }
  return acc
}

const hits = []
for (const root of ROOTS) {
  let files = []
  try { files = walk(root) } catch { continue }
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((ln, i) => {
      const m = ln.match(EMOJI)
      if (m) hits.push({ file: f, line: i + 1, emoji: m[0], text: ln.trim().slice(0, 80) })
    })
  }
}

if (hits.length) {
  console.error(`✗ UIに絵文字が ${hits.length}件 見つかりました（Material Symbolsアイコンに置き換えてください）:`)
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.emoji}]  ${h.text}`)
  console.error('\n方針: <span class="material-symbols-rounded">icon_name</span> を使う。詳細は memory/feedback_no_emoji_use_icons。')
  process.exit(1)
}
console.log('✓ UI(.vue)に絵文字なし')
