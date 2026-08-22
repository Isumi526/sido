// ============================================================
//  scripts/build-screen-catalog.mjs
//  管理画面(admin)の「画面カタログ」を apps/admin のソースから自動生成する。
//  目的: ai-chat EF の systemInstruction を手書きで維持すると必ず実態とズレて誤答する
//        （例: 「注文書ってどこから作るの？」→ 見積もり機能フラグOFFで実は開けないのに
//         「サイドバーの注文書発行です」と案内してしまう）。ルート定義・画面名・HelpButton
//        から機械的に抽出し、手書きの二重管理を作らない＝腐らないカタログにする。
//
//  抽出元:
//    - apps/admin/src/router/index.ts    … パス / component / meta(management,estimate,public)
//    - apps/admin/src/lib/screenNames.ts … パス→メニュー表示名(SCREEN_NAMES)
//    - apps/admin/src/pages/*.vue        … <h1 class=\"page-title\"> と <HelpButton> の説明文
//
//  出力:
//    - apps/admin/src/generated/screen-catalog.json      (正本・人/CIが確認できる)
//    - supabase/functions/ai-chat/screen-catalog.gen.ts  (ai-chat EF が import する)
//
//  使い方:
//    node scripts/build-screen-catalog.mjs           生成（上書き）
//    node scripts/build-screen-catalog.mjs --check   生成物が最新かを検証（CI用・ズレたら exit 1）
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const p = (rel) => resolve(ROOT, rel)

const ROUTER = p('apps/admin/src/router/index.ts')
const SCREEN_NAMES_FILE = p('apps/admin/src/lib/screenNames.ts')
const PAGES_DIR = p('apps/admin/src/pages')
const OUT_JSON = p('apps/admin/src/generated/screen-catalog.json')
const OUT_GEN_TS = p('supabase/functions/ai-chat/screen-catalog.gen.ts')

const read = (f) => readFileSync(f, 'utf8')

// --- 1) import 名 → pages ファイル名 のマップ（静的 import 用） ---
function parseImportMap(src) {
  const map = {}
  const re = /^import\s+(\w+)\s+from\s+'\.\.\/pages\/([\w-]+)\.vue'/gm
  let m
  while ((m = re.exec(src))) map[m[1]] = m[2]
  return map
}

// --- 2) routes を1行ずつパース（各ルートは1行に収まっている前提） ---
function parseRoutes(src, importMap) {
  const routes = []
  for (const line of src.split('\n')) {
    if (!/\bpath:\s*'/.test(line) || !/\bcomponent:/.test(line)) continue
    const path = (line.match(/\bpath:\s*'([^']+)'/) || [])[1]
    if (!path) continue
    // 動的パラメータ(:id)を含む詳細ページ、公開ページ(login)はメニュー導線ではないので対象外
    if (path.includes(':')) continue
    if (/\bpublic:\s*true/.test(line)) continue
    // component: 静的識別子 or () => import('../pages/xxx.vue')
    let file = null
    const dyn = line.match(/import\('\.\.\/pages\/([\w-]+)\.vue'\)/)
    if (dyn) file = dyn[1]
    else {
      const id = (line.match(/\bcomponent:\s*(\w+)/) || [])[1]
      if (id && importMap[id]) file = importMap[id]
    }
    routes.push({
      path,
      file,
      requiresManagement: /\bmanagement:\s*true/.test(line),
      requiresEstimate: /\bestimate:\s*true/.test(line),
    })
  }
  return routes
}

// --- 3) SCREEN_NAMES マップ（パス→メニュー表示名）。オブジェクトブロックだけを対象にする ---
function parseScreenNames(src) {
  const map = {}
  const block = (src.match(/SCREEN_NAMES[^{]*\{([\s\S]*?)\n\}/) || [])[1] || ''
  const re = /'([^']+)':\s*'([^']+)'/g
  let m
  while ((m = re.exec(block))) map[m[1]] = m[2]
  return map
}

// --- 4) .vue から h1(page-title) と HelpButton の説明文(items)を抽出 ---
function parseVue(file) {
  const full = resolve(PAGES_DIR, `${file}.vue`)
  if (!existsSync(full)) return { title: '', help: [] }
  const src = read(full)
  const title = ((src.match(/<h1[^>]*page-title[^>]*>\s*([^<\n]+)/) || [])[1] || '').trim()
  const help = []
  // HelpButton がある画面だけ items を拾う（他用途の :items を誤検出しない）
  const hb = src.indexOf('<HelpButton')
  if (hb >= 0) {
    const region = src.slice(hb)
    const itemsBlock = (region.match(/:items="\[([\s\S]*?)\]"/) || [])[1]
    if (itemsBlock) {
      const re = /'((?:[^'\\]|\\.)*)'/g
      let m
      while ((m = re.exec(itemsBlock))) {
        const t = m[1].replace(/\\'/g, "'").trim()
        if (t) help.push(t)
      }
    }
  }
  return { title, help }
}

function build() {
  const routerSrc = read(ROUTER)
  const importMap = parseImportMap(routerSrc)
  const routes = parseRoutes(routerSrc, importMap)
  const names = parseScreenNames(read(SCREEN_NAMES_FILE))
  return routes.map((r) => {
    const { title, help } = r.file ? parseVue(r.file) : { title: '', help: [] }
    return {
      path: r.path,
      name: names[r.path] || title || r.path,
      title,
      requiresManagement: r.requiresManagement,
      requiresEstimate: r.requiresEstimate,
      help,
    }
  })
}

function renderJson(catalog) {
  return JSON.stringify(catalog, null, 2) + '\n'
}

function renderGenTs(catalog) {
  const header = `// ============================================================
//  screen-catalog.gen.ts  ★自動生成 — 直接編集しない★
//  生成元: scripts/build-screen-catalog.mjs
//  ai-chat EF が systemInstruction の接地に使う画面カタログ。
//  画面を追加/変更したら  node scripts/build-screen-catalog.mjs  で再生成する。
// ============================================================
export interface ScreenCatalogEntry {
  path: string
  name: string
  title: string
  requiresManagement: boolean
  requiresEstimate: boolean
  help: string[]
}

export const SCREEN_CATALOG: ScreenCatalogEntry[] = `
  return header + JSON.stringify(catalog, null, 2) + '\n'
}

const CHECK = process.argv.includes('--check')
const catalog = build()

// 回帰保証: 元となった不具合(注文書がどこか誤答)の画面が、パスと機能フラグ付きで
// カタログに入っていること。ここが崩れる＝接地が壊れているのでCIで落とす。
const po = catalog.find((c) => c.path === '/purchase-orders')
if (!po) {
  console.error('[screen-catalog] /purchase-orders がカタログに見つかりません（router 解析に失敗？）')
  process.exit(1)
}
if (!po.requiresEstimate) {
  console.error('[screen-catalog] /purchase-orders の見積もり機能フラグ(meta.estimate)を拾えていません')
  process.exit(1)
}

const json = renderJson(catalog)
const genTs = renderGenTs(catalog)

if (CHECK) {
  const cur = (f) => (existsSync(f) ? read(f) : '')
  const drift = cur(OUT_JSON) !== json || cur(OUT_GEN_TS) !== genTs
  if (drift) {
    console.error('[screen-catalog] 生成物が最新ではありません。`node scripts/build-screen-catalog.mjs` を実行してコミットしてください。')
    process.exit(1)
  }
  console.log(`[screen-catalog] OK (${catalog.length} screens・最新)`)
} else {
  mkdirSync(dirname(OUT_JSON), { recursive: true })
  writeFileSync(OUT_JSON, json)
  writeFileSync(OUT_GEN_TS, genTs)
  console.log(`[screen-catalog] wrote ${catalog.length} screens -> ${OUT_JSON} / ${OUT_GEN_TS}`)
}
