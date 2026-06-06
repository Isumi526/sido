// ============================================================
//  scripts/next-target.mjs
//  Notionバックログから「要件定義済み」を優先度順で全件取得し、
//  次に着手すべきターゲット（最優先の1件）を出力する。
//  - notion-search の取りこぼし対策（確実に全件・フィルタはAPI側で）
//  - 旧 databases/query が version/endpoint エラーなら
//    data_sources/query (Notion-Version: 2025-09-03) にフォールバック
//
//  使い方: node scripts/next-target.mjs
//  必要env(.env): NOTION_TOKEN, (任意) BACKLOG_DB_ID
// ============================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(p) {
  const out = {}
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
  return out
}

const env = loadEnv(resolve(ROOT, '.env'))
const TOKEN          = process.env.NOTION_TOKEN || env.NOTION_TOKEN
const DB_ID          = process.env.BACKLOG_DB_ID || env.BACKLOG_DB_ID || '6e7dd24739dd431688564b12f64d8ebd'
const DATA_SOURCE_ID = process.env.BACKLOG_DATA_SOURCE_ID || env.BACKLOG_DATA_SOURCE_ID || 'a7f5a28f-22af-4bc1-a512-4d427a934f31'

if (!TOKEN) { console.error('✗ NOTION_TOKEN が .env にありません'); process.exit(1) }

const STATUS_PROP   = 'ステータス'
const PRIORITY_PROP = '優先順位'
const TITLE_PROP    = 'タスク名'
const TARGET_STATUS = '要件定義済み'
const PRIORITY_RANK = { '緊急': 0, '高': 1, '中': 2, '低': 3 }
const filter = { property: STATUS_PROP, status: { equals: TARGET_STATUS } }

function queryDatabase(cursor) {
  return fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
  })
}

function queryDataSource(cursor) {
  return fetch(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
  })
}

async function paginate(doQuery) {
  const results = []
  let cursor
  do {
    const res = await doQuery(cursor)
    if (!res.ok) return { ok: false, status: res.status, text: await res.text() }
    const j = await res.json()
    results.push(...(j.results || []))
    cursor = j.has_more ? j.next_cursor : undefined
  } while (cursor)
  return { ok: true, results }
}

const title    = (p) => (p.properties?.[TITLE_PROP]?.title || []).map((t) => t.plain_text).join('') || '(無題)'
const priority = (p) => p.properties?.[PRIORITY_PROP]?.select?.name ?? null

async function main() {
  // 旧 databases/query を試し、ダメなら data_sources/query にフォールバック
  let out = await paginate(queryDatabase)
  if (!out.ok) {
    console.error(`… databases/query NG (HTTP ${out.status}) → data_sources/query (2025-09-03) で再試行`)
    out = await paginate(queryDataSource)
    if (!out.ok) {
      console.error(`✗ data_sources/query も失敗 (HTTP ${out.status}): ${out.text}`)
      process.exit(1)
    }
  }

  const rows = out.results.sort((a, b) => {
    const ra = PRIORITY_RANK[priority(a)] ?? 9
    const rb = PRIORITY_RANK[priority(b)] ?? 9
    if (ra !== rb) return ra - rb
    return (a.created_time || '').localeCompare(b.created_time || '')   // 同率は作成日古い順
  })

  console.log(`■ 要件定義済み（Readyキュー）: ${rows.length}件 — 優先度順`)
  if (rows.length === 0) {
    console.log('  （対象なし）')
    console.log('\n=== 次のターゲット ===\n（なし）')
    return
  }
  rows.forEach((p, i) => {
    console.log(`  ${i + 1}. [${priority(p) ?? '-'}] ${title(p)}`)
    console.log(`     ${p.url}`)
  })

  const t = rows[0]
  console.log('\n=== 次のターゲット ===')
  console.log(`[${priority(t) ?? '-'}] ${title(t)}`)
  console.log(`URL: ${t.url}`)
  console.log(`NEXT_TARGET_URL=${t.url}`)
}

main().catch((e) => { console.error('✗ 実行エラー:', e); process.exit(1) })
