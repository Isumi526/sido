// ============================================================
//  scripts/dispatcher.mjs
//  「決断の瞬間」だけ人に通知するディスパッチャ。/run 末尾から呼ぶ＋単体実行も可。
//   - 判定材料は既存プロパティのみ（ステータス/リスク/土台/優先度/案件/エピック）。
//   - dedup: .dispatcher-state.json（git管理外）に通知済キーを保存し再送しない。
//   - 配信は既存 LINE human-in-the-loop（notify-humanball.mjs を spawn）。
//   - 緩急: 🧱土台/🔴=即時(個別)、🟡/🟢=バッチ(集約)。本番ゲート(ship)も通知。
//  使い方: node scripts/dispatcher.mjs [--dry-run]
//  env(.env): NOTION_TOKEN, BACKLOG_PROJECT_ID,
//             BACKLOG_DATA_SOURCE_ID(既定 a7f5a28f-22af-4bc1-a512-4d427a934f31),
//             (通知) HUMANBALL_WEBHOOK_URL / _SECRET
// ============================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.slice(2).includes('--dry-run')
const REVIEW_BATCH_THRESH = 5   // 土台以外のレビュー待ちがこの件数を超えたらバッチ通知

function loadEnv(p) {
  const out = {}
  try { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch { /* */ }
  return out
}
const env = loadEnv(resolve(ROOT, '.env'))
const TOKEN = process.env.NOTION_TOKEN || env.NOTION_TOKEN
const PROJECT_ID = process.env.BACKLOG_PROJECT_ID || env.BACKLOG_PROJECT_ID
const DATA_SOURCE_ID = process.env.BACKLOG_DATA_SOURCE_ID || env.BACKLOG_DATA_SOURCE_ID || 'a7f5a28f-22af-4bc1-a512-4d427a934f31'
const STATE_PATH = resolve(ROOT, 'scripts/.dispatcher-state.json')
if (!TOKEN || !PROJECT_ID) { console.error('✗ NOTION_TOKEN / BACKLOG_PROJECT_ID が必要'); process.exit(1) }

const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' }
const norm = (id) => (id || '').replace(/-/g, '')

async function queryAll() {
  const results = []; let cursor
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ filter: { property: '案件名', relation: { contains: PROJECT_ID } }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    })
    if (!res.ok) { console.error(`✗ query NG ${res.status}: ${await res.text()}`); process.exit(1) }
    const j = await res.json(); results.push(...(j.results || [])); cursor = j.has_more ? j.next_cursor : undefined
  } while (cursor)
  return results
}
const P = (p) => ({
  id: p.id,
  title: (p.properties?.['タスク名']?.title || []).map((t) => t.plain_text).join('') || '(無題)',
  status: p.properties?.['ステータス']?.status?.name ?? null,
  priority: p.properties?.['優先順位']?.select?.name ?? null,
  risk: p.properties?.['リスク']?.select?.name ?? null,
  dodai: !!p.properties?.['土台']?.checkbox,
  epic: p.properties?.['エピック']?.select?.name ?? '(未分類)',
  url: p.url,
})

const loadState = () => { try { return new Set(JSON.parse(readFileSync(STATE_PATH, 'utf8'))) } catch { return new Set() } }
function notify(kind, task, detail) {
  console.log(`  → notify[${kind}] ${task}: ${detail}`)
  if (DRY) return
  try { execFileSync('node', [resolve(ROOT, 'scripts/notify-humanball.mjs'), '--kind', kind, '--task', task, '--detail', detail], { stdio: 'ignore' }) } catch { /* best-effort */ }
}

async function main() {
  const rows = (await queryAll()).map(P)
  const state = loadState()
  const fired = []
  const review = rows.filter((r) => r.status === 'レビュー待ち')

  // 1) 🧱土台×レビュー待ち（即時・個別）
  for (const it of review.filter((r) => r.dodai)) {
    const k = `dodai:${norm(it.id)}:reviewing`
    if (!state.has(k)) { notify('🧱土台', it.title, `🧱土台「${it.title}」レビュー待ち。後続が依存。バッチに溜めず今レビュー推奨。`); state.add(k); fired.push(k) }
  }
  // 2) レビューバッチ（土台以外）：閾値超 or 🔴≥3 で1通集約
  const leaf = review.filter((r) => !r.dodai)
  const red = leaf.filter((r) => (r.risk || '').includes('🔴')).length
  const yel = leaf.filter((r) => (r.risk || '').includes('🟡')).length
  const grn = leaf.filter((r) => (r.risk || '').includes('🟢')).length
  if (leaf.length >= REVIEW_BATCH_THRESH || red >= 3) {
    const k = `batch:${Math.floor(leaf.length / REVIEW_BATCH_THRESH)}:${red >= 3 ? 'R' : '-'}`
    if (!state.has(k)) { notify('レビュー可', 'レビューバッチ', `レビュー可: 🔴${red}/🟡${yel}/🟢${grn}（土台以外${leaf.length}件）。要対応ビューへ。`); state.add(k); fired.push(k) }
  }
  // 3) shipウィンドウ：あるエピックの該当が全て本番待ち
  const ACTIONABLE = new Set(['要件定義済み', '進行中', 'レビュー待ち', '本番待ち'])
  const byEpic = {}
  for (const r of rows) (byEpic[r.epic] ??= []).push(r)
  for (const [epic, items] of Object.entries(byEpic)) {
    const act = items.filter((r) => ACTIONABLE.has(r.status))
    if (act.length && act.every((r) => r.status === '本番待ち')) {
      const k = `ship:${epic}:${act.map((r) => norm(r.id)).sort().join(',')}`
      if (!state.has(k)) { notify('shipクラスタ', epic, `shipクラスタ「${epic}」準備OK（${act.length}件が本番待ち）。env前提は各📋ダイジェスト記載を本番で確認のうえ push/ship 可。`); state.add(k); fired.push(k) }
    }
  }
  // 4) 要回答（業務判断）まとめて1通
  const ans = rows.filter((r) => r.status === '要回答')
  if (ans.length) {
    const k = `answers:${ans.map((r) => norm(r.id)).sort().join(',')}`
    if (!state.has(k)) { notify('判断待ち', `判断待ち${ans.length}件`, ans.map((r, i) => `${i + 1}.${r.title}`).join(' / ').slice(0, 280)); state.add(k); fired.push(k) }
  }

  if (!DRY) writeFileSync(STATE_PATH, JSON.stringify([...state], null, 0))
  console.log(`[dispatcher]${DRY ? ' (dry-run)' : ''} 盤面: レビュー待ち${review.length}(🧱${review.filter((r) => r.dodai).length}) / 要回答${ans.length}. 発火${fired.length}件.`)
}
main().catch((e) => { console.error('✗ dispatcher error:', e); process.exit(1) })
