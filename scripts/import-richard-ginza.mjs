// ============================================================
//  scripts/import-richard-ginza.mjs
//  実案件のExcel「0603 銀座りシャール見積もり.xlsx」の『全体見積』シートを
//  ローカルDBの見積案件として取り込む（デモ／動作確認用）。
//
//  なぜ実データを入れるか:
//   合成データだと「同じ場所に複数工種がぶら下がる」「W/D/Hが一部の行にしか無い」
//   「数量も単価も空の検討中の行がある」といった実際の形が再現できず、
//   作った画面が実務で成立するかを確かめられない。
//
//  Excelの構造（そのまま2階層モデルに対応する）:
//    （壁面工事）  … 場所（大項目）  B列が全角カッコ始まり
//      ■軽鉄工事  … 工種（中項目）  B列が ■ 始まり
//        壁面 外周LGS間仕切 …… 明細行
//    B=名称 C=形状詳細 D=W(t) E=D(＠) F=H(L) G=数量 H=単位 I=単価 J=金額 P=単価原価
//
//  使い方: node --env-file=.env scripts/import-richard-ginza.mjs [--file <xlsx>] [--replace]
//  ※ローカル(LOCAL_DB_URL相当のSupabase)にのみ入れる。本番には触らない。
// ============================================================
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
// xlsx は apps/admin の依存（admin は npm workspace 外なのでルートに無い）。
// ルートに入れ直すと admin 側の依存解決を壊した過去があるため、admin のものを直接読む。
const xlsxUrl = new URL('../apps/admin/node_modules/xlsx/xlsx.mjs', import.meta.url).href
const XLSX = (await import(xlsxUrl)).default ?? (await import(xlsxUrl))

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : '/Users/ism526/Downloads/sido/0603　銀座りシャール見積もり.xlsx'
const REPLACE = process.argv.includes('--replace')
const PROJECT_NAME = 'リシャール銀座'

// ローカルの接続情報は apps/admin/.env.local にある（E2Eの helpers と同じ場所）
function loadLocalEnv() {
  try {
    const raw = readFileSync(new URL('../apps/admin/.env.local', import.meta.url), 'utf8')
    return Object.fromEntries(raw.split('\n')
      .map(l => l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))
  } catch { return {} }
}
const localEnv = loadLocalEnv()
const SUPA_URL = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL || 'http://127.0.0.1:56321'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY が必要です（apps/admin/.env.local）'); process.exit(1) }
// ★本番に入れない安全弁（デモデータ投入スクリプトなので、向き先がローカルであることを確認する）
if (!/127\.0\.0\.1|localhost/.test(SUPA_URL)) {
  console.error(`接続先がローカルではありません: ${SUPA_URL}\nこのスクリプトはデモデータ投入用でローカル専用です。`)
  process.exit(1)
}
const db = createClient(SUPA_URL, KEY, { auth: { persistSession: false } })

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
const txt = (v) => (v === null || v === undefined ? '' : String(v).trim())

function parseSheet(path) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
  const ws = wb.Sheets['全体見積']
  if (!ws) throw new Error('『全体見積』シートが見つかりません')
  const rows = XLSX.utils.sheet_to_json(ws, { header: 'A', raw: true, defval: null })

  const out = []
  let location = '', trade = ''
  for (let i = 2; i < rows.length; i++) {   // 1行目=タイトル, 2行目=見出し
    const r = rows[i]
    const name = txt(r.B)
    if (!name) continue
    // （壁面工事） のような全角カッコ始まり＝場所
    if (/^[（(]/.test(name)) { location = name.replace(/^[（(]|[）)]$/g, '').trim(); trade = ''; continue }
    // ■軽鉄工事 ＝ 工種
    if (name.startsWith('■')) { trade = name.slice(1).trim(); continue }
    if (name === '内訳書') continue

    out.push({
      location, trade,
      item_name: name,
      spec: txt(r.C),
      dim_w: num(r.D), dim_d: num(r.E), dim_h: num(r.F),
      quantity: num(r.G) ?? 0,
      unit: txt(r.H),
      unit_price: num(r.I) ?? 0,          // 客先単価（Excel I列）
      cost_unit_price: num(r.P),          // 単価原価（Excel P列）
      note_k: txt(r.K),                   // 「概算」「想定」等の但し書き
    })
  }
  return out
}

const items = parseSheet(FILE)
console.log(`Excelから ${items.length} 行を読み取りました`)

// ★入れる先は「画面にログインして見えるアカウント」でないと意味がない。
//   ローカルには複数テナントのシードがあり、先頭を掴むと別テナントに入って見えなくなる。
const SLUG = process.env.VITE_ACCOUNT_SLUG || localEnv.VITE_ACCOUNT_SLUG || 'test'
const { data: acc } = await db.from('accounts').select('id, name, slug').eq('slug', SLUG).maybeSingle()
if (!acc) { console.error(`accounts に slug=${SLUG} がありません`); process.exit(1) }
console.log(`投入先: ${acc.name}（slug=${acc.slug}）`)

const { data: exist } = await db.from('estimate_projects')
  .select('id').eq('account_id', acc.id).eq('name', PROJECT_NAME).maybeSingle()
if (exist && !REPLACE) {
  console.error(`案件「${PROJECT_NAME}」は既にあります。作り直すなら --replace を付けてください。`)
  process.exit(1)
}
if (exist) {
  await db.from('estimate_items').delete().eq('project_id', exist.id)
  await db.from('estimate_projects').delete().eq('id', exist.id)
  console.log('既存の案件を削除しました（--replace）')
}

const { data: pj, error: pjErr } = await db.from('estimate_projects').insert({
  account_id: acc.id, name: PROJECT_NAME,
  construction_location: '東京都中央区銀座',
  status: 'draft',
  memo: 'Excel「0603 銀座りシャール見積もり」全体見積シートから取り込み（デモデータ）',
}).select('id').single()
if (pjErr) { console.error(pjErr.message); process.exit(1) }

const payload = items.map((it, i) => ({
  account_id: acc.id, project_id: pj.id,
  item_name: it.item_name,
  note: it.location || null,          // 場所は note に入る（既存の設計）
  trade_name: it.trade || null,
  spec: [it.spec, it.note_k].filter(Boolean).join(' / ') || null,
  dim_w: it.dim_w, dim_d: it.dim_d, dim_h: it.dim_h,
  quantity: it.quantity, unit: it.unit || null,
  unit_price: Math.round(it.unit_price),
  cost_unit_price: it.cost_unit_price == null ? null : Math.round(it.cost_unit_price),
  row_type: 'item', sort_order: i,
}))
const { error: itErr } = await db.from('estimate_items').insert(payload)
if (itErr) { console.error(itErr.message); process.exit(1) }

// 確認用サマリ
const byArea = new Map()
for (const it of items) {
  const k = it.location || '(場所なし)'
  if (!byArea.has(k)) byArea.set(k, new Set())
  byArea.get(k).add(it.trade || '(工種なし)')
}
console.log(`\n案件「${PROJECT_NAME}」を作成しました（${payload.length}行）`)
for (const [area, trades] of byArea) console.log(`  ${area} … ${[...trades].join(' / ')}`)
const total = payload.reduce((s, r) => s + r.quantity * r.unit_price, 0)
console.log(`  請負金額(明細計) ¥${total.toLocaleString('ja-JP')}`)
