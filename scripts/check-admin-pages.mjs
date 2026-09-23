#!/usr/bin/env node
// ============================================================
//  check-admin-pages.mjs — 管理画面の新規ページが「共通の作り」に乗っているかを機械で検査
//
//  なぜ要るか（2026-09-05 運用者「前にも別の画面で言ったけど UI がデフォルトで違和感…使い方をナビゲートして」）:
//   同じ指摘が画面ごとに繰り返された。文書のルールだけでは抜ける（現に抜けた）ので、
//   `check-no-emoji.mjs` と同じ形で機械が先に検出する。
//
//  検査（apps/admin/src/pages/*.vue）:
//   1. HelpButton（見出し横の「？」使い方ナビ）がある
//   2. テンプレートで使っているクラスが、そのページの <style> か共通CSS（src/style.css）に定義されている
//      （定義の無いクラス＝余白も行間も効かず「詰まって見える」の直接原因）
//
//  運用（ratchet）: 既存の未対応ページは scripts/admin-pages.allowlist.json に載せて逐次消し込む。
//   allowlist に無いページで違反が出たら非ゼロ終了＝新規画面は人が指摘する前に落ちる。
//   allowlist に載っているページが直ったら、その行を消す（--update-allowlist で今の違反を書き出せる）。
//
//  使い方:
//    node scripts/check-admin-pages.mjs              # 検査（allowlist 外の違反で exit 1）
//    node scripts/check-admin-pages.mjs --report     # 全ページの一覧（優先順位付け用・exit 0）
//    node scripts/check-admin-pages.mjs --update-allowlist   # 今の違反を allowlist に書き出す（ratchet の基準更新）
// ============================================================
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAGES_DIR = resolve(ROOT, 'apps/admin/src/pages')
const GLOBAL_CSS = resolve(ROOT, 'apps/admin/src/style.css')
const ALLOWLIST = resolve(ROOT, 'scripts/admin-pages.allowlist.json')

const args = process.argv.slice(2)
const REPORT = args.includes('--report')
const UPDATE = args.includes('--update-allowlist')

// HelpButton が要らない画面（ログイン・リダイレクト専用など「使い方」が無いもの）
const NO_HELP_NEEDED = new Set(['login.vue', 'index.vue'])
// フレームワーク/外部/App.vue 由来で、ページ側に定義が無くて当然のクラス
const KNOWN_GLOBAL = new Set([
  'material-symbols-rounded', 'material-symbols-outlined', 'router-link-active', 'router-link-exact-active',
  'sr-only',
])

function cssClassesOf(css) {
  // セレクタ中の .class を全部拾う（宣言ブロックの中身は除外）
  const out = new Set()
  const noBlocks = css.replace(/\{[^{}]*\}/g, '{}')
  for (const m of noBlocks.matchAll(/\.([a-zA-Z_][\w-]*)/g)) out.add(m[1])
  return out
}

function templateClassesOf(tpl) {
  const out = new Set()
  // 静的 class="a b c"
  for (const m of tpl.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) out.add(c)
  // :class="..." / v-bind:class … 文字列リテラル・オブジェクトキー・テンプレートリテラルの静的部分を拾う（ベストエフォート）
  for (const m of tpl.matchAll(/\s(?::class|v-bind:class)="([^"]*)"/g)) {
    const expr = m[1]
    // 文字列リテラル。ただし比較の右辺（=== 'approved' 等）や配列添字はクラスではない
    for (const s of expr.matchAll(/(===?|!==?|\[|\bin\s)?\s*'([^']*)'/g)) {
      if (s[1]) continue
      for (const c of s[2].split(/\s+/)) if (c && /^[a-zA-Z_][\w-]*$/.test(c)) out.add(c)
    }
    // オブジェクトのキー { active: cond }。三項演算子の `a ? b : c` の b は除く
    for (const k of expr.matchAll(/(^|[{,\s])([a-zA-Z_][\w-]*)\s*:(?!:)/g)) {
      const before = expr.slice(0, k.index + k[1].length).replace(/\s+$/, '')
      if (/\?[^:]*$/.test(before) && !/[{,]\s*$/.test(before)) continue
      out.add(k[2])
    }
    // テンプレートリテラルの静的部分（`st-${x}` の接頭辞片は除く）
    for (const t of expr.matchAll(/`([^`]*)`/g)) for (const c of t[1].replace(/[\w-]*\$\{[^}]*\}[\w-]*/g, ' ').split(/\s+/)) if (c && /^[a-zA-Z_][\w-]*$/.test(c)) out.add(c)
  }
  return out
}

function analyze(file) {
  const src = readFileSync(file, 'utf8')
  const tpl = (src.match(/<template>([\s\S]*)<\/template>/) ?? [])[1] ?? ''
  const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  const defined = new Set([...cssClassesOf(styles), ...GLOBAL, ...KNOWN_GLOBAL])
  const used = templateClassesOf(tpl)
  const undefinedClasses = [...used].filter((c) => !defined.has(c)).sort()
  const hasHelp = /<HelpButton\b/.test(tpl)
  return { file: basename(file), hasHelp, undefinedClasses }
}

const GLOBAL = cssClassesOf(existsSync(GLOBAL_CSS) ? readFileSync(GLOBAL_CSS, 'utf8') : '')
const pages = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.vue') && !f.includes(' 2.')).sort()
const results = pages.map((f) => analyze(resolve(PAGES_DIR, f)))

const violations = results.map((r) => {
  const issues = []
  if (!r.hasHelp && !NO_HELP_NEEDED.has(r.file)) issues.push('HelpButton無し')
  if (r.undefinedClasses.length) issues.push(`定義の無いクラス: ${r.undefinedClasses.join(', ')}`)
  return { file: r.file, issues }
}).filter((v) => v.issues.length)

if (REPORT) {
  console.log(`[admin-pages] ${pages.length} ページ・違反 ${violations.length} ページ（HelpButton無し ${violations.filter(v => v.issues.some(i => i.startsWith('HelpButton'))).length}・未定義クラス ${violations.filter(v => v.issues.some(i => i.startsWith('定義'))).length}）`)
  for (const v of violations) console.log(`- ${v.file}: ${v.issues.join(' / ')}`)
  process.exit(0)
}

if (UPDATE) {
  const list = Object.fromEntries(violations.map((v) => [v.file, v.issues]))
  writeFileSync(ALLOWLIST, JSON.stringify({ _note: '既存の未対応ページ（ratchet）。直したら行を消す。新規ページをここに足さない。', pages: list }, null, 2) + '\n')
  console.log(`[admin-pages] allowlist を更新: ${violations.length} ページ`)
  process.exit(0)
}

const allow = existsSync(ALLOWLIST) ? (JSON.parse(readFileSync(ALLOWLIST, 'utf8')).pages ?? {}) : {}
const fresh = []
for (const v of violations) {
  const allowed = new Set(allow[v.file] ?? [])
  // allowlist は「種類」で許容する（HelpButton無し／定義の無いクラス）。既存ページで新たに別種の違反が増えたら落とす
  const newIssues = v.issues.filter((i) => ![...allowed].some((a) => a.split(':')[0] === i.split(':')[0]))
  if (newIssues.length) fresh.push({ file: v.file, issues: newIssues })
}
const stale = Object.keys(allow).filter((f) => !violations.some((v) => v.file === f))

if (fresh.length) {
  console.error('[admin-pages] ✗ 共通の作りに乗っていないページがあります（新規/悪化）:')
  for (const v of fresh) console.error(`  - apps/admin/src/pages/${v.file}: ${v.issues.join(' / ')}`)
  console.error('  → 見出し横に <HelpButton title="…" :items="[…]" /> を置き、使うクラスはそのページの <style> か src/style.css に定義する（docs/templates/admin-list-page.vue が雛形）。')
  process.exit(1)
}
if (stale.length) console.log(`[admin-pages] allowlist に残っているが直っているページ（行を消してよい）: ${stale.join(', ')}`)
console.log(`✓ 管理画面ページの共通の作り OK（${pages.length} ページ・allowlist ${Object.keys(allow).length} ページ）`)
