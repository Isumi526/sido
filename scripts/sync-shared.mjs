// ============================================================
//  scripts/sync-shared.mjs
//  単一ソース shared/*.ts を各アプリの *.gen.ts へコピーする。
//  経費平坦化ロジックの二重化（admin/liff 手動コピー）による直し漏れを防ぐため、
//  共有ロジックは shared/ だけを編集し、本スクリプトで各アプリへ展開する。
//  使い方: npm run sync:shared  （shared/ を編集したら必ず実行してコミット）
//  ※ Vercel の workspace 解決問題を避けるため packages 化はせず、各アプリ内の
//    相対 import で解決できる生成ファイルとしてコミットする。
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 共有ソース → 各アプリの生成先（複数追加可）
const SHARES = [
  {
    src: 'shared/expense-flatten.ts',
    dests: [
      'apps/admin/src/lib/expense-flatten.gen.ts',
      'apps/liff/composables/expense-flatten.gen.ts',
    ],
  },
  {
    src: 'shared/schedule-core.ts',
    dests: [
      'apps/admin/src/lib/schedule-core.gen.ts',
      'apps/liff/composables/schedule-core.gen.ts',
    ],
  },
]

const HEADER = (srcRel) =>
  `// ⚠️ AUTO-GENERATED from ${srcRel} — DO NOT EDIT.\n` +
  `// 共有ロジックの正本は ${srcRel}。編集したら \`npm run sync:shared\` で本ファイルを再生成すること。\n\n`

let changed = 0
for (const { src, dests } of SHARES) {
  const body = readFileSync(resolve(ROOT, src), 'utf8')
  const out = HEADER(src) + body
  for (const dest of dests) {
    const abs = resolve(ROOT, dest)
    mkdirSync(dirname(abs), { recursive: true })
    let prev = ''
    try { prev = readFileSync(abs, 'utf8') } catch { /* new file */ }
    if (prev !== out) { writeFileSync(abs, out); changed++; console.log(`✓ 生成: ${dest}`) }
    else console.log(`= 変更なし: ${dest}`)
  }
}
console.log(changed ? `\n${changed}ファイルを更新しました。コミットを忘れずに。` : '\nすべて最新です。')
