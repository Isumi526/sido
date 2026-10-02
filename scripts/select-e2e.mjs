#!/usr/bin/env node
// ============================================================
//  scripts/select-e2e.mjs — 変更に関係する E2E だけを選ぶ（2026-10-02 E2E整理2）
//
//  ★なぜ: 全体の E2E は直列で約50分。実装のたびに全体を待つと遅い。
//   実装中（/run の着地ゲート）は「関係する spec＋基本セット」、本番に出す前（/ship）は全体、と使い分ける。
//  ★選び方（変更ファイル → spec）:
//   - tests/e2e/*.spec.ts を直した               → その spec
//   - 画面（apps/liff/pages・apps/admin/src/pages） → その画面のパスを開く spec（goto('/パス')）と、名前が同じ spec
//   - 部品（components・composables・lib・utils）  → それを使う画面 → その画面の spec
//   - 文言（i18n/locales/<言語>/<ns>.json）         → その ns を使う画面 → その画面の spec
//   - Edge Function（supabase/functions/<名前>）   → その名前を含む spec ＋ それを呼ぶ画面の spec
//   - 説明だけ（*.md・docs/・CLAUDE.md）           → 基本セットだけ
//  ★選び漏れを減らすため、上のどれにも当たらないファイル（migration・shared/・設定・_shared など）を
//   1つでも触ったら全体を流す（安全側に倒す）。
//
//  使い方:
//   node scripts/select-e2e.mjs                 … origin/main からの変更（作業中の未コミットも含む）で選んで一覧を出す
//   node scripts/select-e2e.mjs --base dev      … 比べる先を変える
//   node scripts/select-e2e.mjs --run           … 選んだ spec を playwright で流す（全体なら npm run test:e2e と同じ）
//   node scripts/select-e2e.mjs --files a b c   … 変更ファイルを手で渡す（確認用）
// ============================================================
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim()
const E2E = join(ROOT, 'tests/e2e')

/** 基本セット: ログイン・打刻・日報の送信・承認の主な流れ。数分で終わる（2026-10-02 選定） */
export const BASE_SET = [
  'admin.smoke.spec.ts',
  'liff.worker-login.spec.ts',
  'liff.checkin-one-tap.spec.ts',
  'liff.report-steps.spec.ts',
  'liff.overtime-approve-todo.spec.ts',
  'liff.report-approve-todo.spec.ts',
]

const args = process.argv.slice(2)
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }

function changedFiles() {
  const manual = args.indexOf('--files')
  if (manual >= 0) return args.slice(manual + 1).filter((a) => !a.startsWith('--'))
  const base = argVal('--base') ?? 'origin/main'
  const run = (c) => { try { return execSync(c, { cwd: ROOT }).toString().split('\n').filter(Boolean) } catch { return [] } }
  const mergeBase = run(`git merge-base ${base} HEAD`)[0] ?? base
  return [...new Set([
    ...run(`git diff --name-only ${mergeBase}`),
    ...run('git ls-files --others --exclude-standard'),
  ])]
}

const specs = readdirSync(E2E).filter((f) => /^(admin|liff)\..+\.spec\.ts$/.test(f))
const specText = new Map(specs.map((s) => [s, readFileSync(join(E2E, s), 'utf8')]))

function walk(dir, exts) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) { if (e !== 'node_modules' && !e.startsWith('.')) out.push(...walk(p, exts)) }
    else if (exts.includes(extname(e))) out.push(p)
  }
  return out
}
const liffPages = walk(join(ROOT, 'apps/liff/pages'), ['.vue'])
const adminPages = walk(join(ROOT, 'apps/admin/src/pages'), ['.vue'])
const pageText = new Map([...liffPages, ...adminPages].map((p) => [p, readFileSync(p, 'utf8')]))

/** 画面ファイル → URL パス（/report・/approvals/punch・/sites/:id は /sites/ ） */
function routeOf(abs) {
  const isLiff = abs.includes('/apps/liff/pages/')
  const rel = abs.split(isLiff ? '/apps/liff/pages/' : '/apps/admin/src/pages/')[1].replace(/\.vue$/, '')
  const parts = rel.split('/').filter((s) => s !== 'index').map((s) => (s.startsWith('[') ? '' : s))
  return { app: isLiff ? 'liff' : 'admin', path: '/' + parts.filter(Boolean).join('/'), name: basename(rel) }
}

/** 画面 → それを開く spec */
function specsForPage(abs) {
  const { app, path, name } = routeOf(abs)
  const hit = new Set()
  const esc = path.replace(/[/.*+?^${}()|[\]\\-]/g, '\\$&')
  const re = path === '/' ? /goto\((['"`])\/(\?[^'"`]*)?\1/ : new RegExp(`goto\\((['"\`])${esc}(?![A-Za-z0-9-])`)
  for (const [s, t] of specText) {
    if (!s.startsWith(app + '.')) continue
    if (re.test(t) || s.startsWith(`${app}.${name}`)) hit.add(s)
  }
  return hit
}

/** 部品・文言・関数の名前 → それを使う画面 */
function pagesUsing(token) {
  return [...pageText].filter(([, t]) => t.includes(token)).map(([p]) => p)
}

const files = changedFiles()
const chosen = new Set(BASE_SET.filter((s) => specText.has(s)))   // まだ無い spec（別ブランチの分）は飛ばす
const unmapped = []

for (const f of files) {
  const abs = join(ROOT, f)
  if (/\.md$/.test(f) || f.startsWith('docs/') || f === 'CLAUDE.md') continue
  if (/^tests\/e2e\/(admin|liff)\..+\.spec\.ts$/.test(f)) { if (existsSync(abs)) chosen.add(basename(f)); continue }
  if (/^tests\/e2e\/(QUARANTINE|README)\.md$/.test(f)) continue
  if (/^apps\/(liff\/pages|admin\/src\/pages)\/.+\.vue$/.test(f)) {
    if (!existsSync(abs)) { unmapped.push(f); continue }
    const hit = specsForPage(abs)
    if (!hit.size) unmapped.push(f)
    for (const s of hit) chosen.add(s)
    continue
  }
  const comp = /^apps\/(liff\/(components|composables|utils|plugins)|admin\/src\/(components|lib|composables))\/(.+)\.(vue|ts)$/.exec(f)
  if (comp) {
    const name = basename(comp[4]).replace(/\.gen$/, '')
    const users = pagesUsing(name)
    if (!users.length) { unmapped.push(f); continue }
    for (const p of users) for (const s of specsForPage(p)) chosen.add(s)
    continue
  }
  const i18n = /^apps\/liff\/i18n\/locales\/[a-z]+\/([A-Za-z0-9]+)\.json$/.exec(f)
  if (i18n) {
    for (const p of pagesUsing(`${i18n[1]}.`)) for (const s of specsForPage(p)) chosen.add(s)
    continue
  }
  const fn = /^supabase\/functions\/([a-z0-9-]+)\//.exec(f)
  if (fn && fn[1] !== '_shared') {
    let any = false
    for (const [s, t] of specText) if (t.includes(fn[1])) { chosen.add(s); any = true }
    for (const p of pagesUsing(fn[1])) for (const s of specsForPage(p)) { chosen.add(s); any = true }
    if (!any) unmapped.push(f)
    continue
  }
  unmapped.push(f)
}

const runAll = unmapped.length > 0
if (!args.includes('--quiet')) {
  console.log(`変更 ${files.length} ファイル`)
  if (runAll) {
    console.log('対応の分からない変更があるので全体を流す（安全側）:')
    for (const u of unmapped.slice(0, 20)) console.log(`  - ${u}`)
  } else {
    console.log(`選んだ spec ${chosen.size} 本（基本セット ${BASE_SET.filter((b) => specText.has(b)).length} 本を含む）:`)
    for (const s of [...chosen].sort()) console.log(`  ${s}`)
  }
}

if (args.includes('--run')) {
  const cmd = runAll ? ['playwright', 'test'] : ['playwright', 'test', ...[...chosen].map((s) => `tests/e2e/${s}`)]
  const r = spawnSync('npx', cmd, { cwd: ROOT, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
