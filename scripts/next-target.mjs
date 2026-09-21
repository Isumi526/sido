// ============================================================
//  scripts/next-target.mjs
//  Notionバックログから「要件定義済み」を優先度順で全件取得し、
//  次に着手すべきターゲット（最優先の1件）を出力する。
//  - notion-search の取りこぼし対策（確実に全件・フィルタはAPI側で）
//  - 旧 databases/query が version/endpoint エラーなら
//    data_sources/query (Notion-Version: 2025-09-03) にフォールバック
//
//  ※バックログDBは sido / osarAI / Garage Connect の3プロジェクトで共用。
//    タスクは「案件名」relation（説明=「案件管理マスタと紐付け」。"案件名 1" ではない）で
//    各案件に紐づく。本スクリプトは .env の BACKLOG_PROJECT_ID（自分の案件page_id）で絞り、
//    自分の案件のタスクだけを拾う。
//
//  使い方: node scripts/next-target.mjs
//  必要env(.env): NOTION_TOKEN, BACKLOG_PROJECT_ID（必須・自分の案件page_id）, (任意) BACKLOG_DB_ID
// ============================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { rankOfPriority } from './priority-rank.mjs'   // 優先順位の順位マップ＋空欄=最後(9) の唯一の正本（第19条）

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
const PROJECT_ID     = process.env.BACKLOG_PROJECT_ID || env.BACKLOG_PROJECT_ID

if (!TOKEN) { console.error('✗ NOTION_TOKEN が .env にありません'); process.exit(1) }
// 【安全装置】案件page_id 未設定なら即停止。フィルタなしで全プロジェクトのタスクを拾う事故を防ぐ。
if (!PROJECT_ID) { console.error('✗ BACKLOG_PROJECT_ID が .env にありません（自分の案件page_idを設定してください）'); process.exit(1) }

// 案件の表示名は**Notion 案件管理マスタのページタイトル**から引く（第19条: 真実は Notion にある）。
//   ★2026-08-05 変更: 以前はここに page_id → 表示名 のハードコード表を持っていたが、
//     同じ page_id を project-resolve.mjs が GENLINKS、ここが SIDO と別名で呼んでいた
//     （SIDO は案件名ではなくリポ名の大文字化で、案件管理マスタに存在しない名前）。
//     .env に表示名を持たせる案も検討したが、それは同じ文字列を3展開先に複製することになり
//     突き合わせ不能な写像が増えるので採らなかった（plans/20260805-project-registry.md）。
//   取得に失敗しても /run は止めない（表示は本質ではない）。従来と同じ形にフォールバックする。
const norm = (id) => (id || '').replace(/-/g, '')
const FALLBACK_NAME = `(page_id …${norm(PROJECT_ID).slice(-6)})`
async function fetchProjectName() {
  try {
    const r = await fetch(`https://api.notion.com/v1/pages/${PROJECT_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28' },
    })
    if (!r.ok) return FALLBACK_NAME
    const j = await r.json()
    const titleProp = Object.values(j.properties || {}).find((p) => p?.type === 'title')
    const name = (titleProp?.title || []).map((t) => t.plain_text).join('').trim()
    return name || FALLBACK_NAME
  } catch { return FALLBACK_NAME }
}
const PROJECT_NAME = await fetchProjectName()

const STATUS_PROP   = 'ステータス'
const PRIORITY_PROP = '優先順位'
const TITLE_PROP    = 'タスク名'
const PROJECT_PROP  = '案件名'   // relation（説明=「案件管理マスタと紐付け」）。"案件名 1" ではない方
const TARGET_STATUS = '要件定義済み'
// ★ 順位マップは priority-rank.mjs に一本化（第19条・計画⑧）。ここに local const を持たない
//   （持つと next-ball.mjs と二重定義になり、緊急の欠落や空欄挙動がズレる）。
// --board: 自案件の「全ステータス」を取得（/run ステートマシン用の盤面スナップショット）。
// 既定（/next 用・引数なし）: ステータス＝要件定義済み のみ（従来どおり・後方互換）。
// 【仕様】案件名が未設定（空）のタスクは relation 一致しないため、どのプロジェクトでも拾わない（＝自然に除外）。
const BOARD = process.argv.slice(2).includes('--board')
const REVIEW = process.argv.slice(2).includes('--review')   // レビュー待ちを設計書単位に束ねて出す（/review §0）
const filter = (BOARD || REVIEW)
  ? { property: PROJECT_PROP, relation: { contains: PROJECT_ID } }
  : {
      and: [
        { property: STATUS_PROP,  status: { equals: TARGET_STATUS } },
        { property: PROJECT_PROP, relation: { contains: PROJECT_ID } },
      ],
    }

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
const statusOf = (p) => p.properties?.[STATUS_PROP]?.status?.name ?? '(未設定)'
const riskOf   = (p) => p.properties?.['リスク']?.select?.name ?? null
const dodaiOf  = (p) => p.properties?.['土台']?.checkbox === true
const tagsOf   = (p) => (p.properties?.['タグ']?.multi_select ?? []).map((o) => o.name)

// --board: 全ステータスをグループ表示（ステートマシンが盤面を読むための機械可読寄り出力）
function printBoard(results) {
  const ORDER = ['未整理', '要回答', '要件定義済み', '進行中', 'レビュー待ち', '本番待ち', '保留', '完了']
  const groups = new Map(ORDER.map((s) => [s, []]))
  for (const p of results) {
    const s = statusOf(p)
    if (!groups.has(s)) groups.set(s, [])
    groups.get(s).push(p)
  }
  const rank = (p) => rankOfPriority(priority(p))
  for (const arr of groups.values()) {
    arr.sort((a, b) => (rank(a) - rank(b)) || (a.created_time || '').localeCompare(b.created_time || ''))
  }
  console.log(`▶ 対象プロジェクト: ${PROJECT_NAME} — 盤面スナップショット（全ステータス）`)
  const counts = [...groups.entries()].map(([s, arr]) => `${s}:${arr.length}`)
  console.log(`■ 件数: ${counts.join(' / ')}`)
  for (const [s, arr] of groups) {
    if (arr.length === 0) continue
    console.log(`\n## ${s} (${arr.length})`)
    for (const p of arr) {
      const tg = tagsOf(p)
      const risk = riskOf(p) ?? '-'
      const dodai = dodaiOf(p) ? '🧱' : ''
      console.log(`  - [${priority(p) ?? '-'}/${risk}${dodai}] ${title(p)}${tg.length ? ' 〔' + tg.join(',') + '〕' : ''}`)
      console.log(`    ${p.url}`)
    }
  }
}

// --review: レビュー待ちを「設計書×段階」に束ねる（/review の入口・2026-09-21）。
//  ★なぜ設計書単位か: 同じ機能がチケットに分割されていると、同じ画面・同じ導線を何度もなぞることになる。
//   設計書には §0 確認事項（仮置き）・§3 マトリクス・§4 動き があり、人が見るべきは
//   「仮置きが正しかったか」「マトリクス通りに動くか」＝設計書1枚を通しで触る方が早い。
//  段階の並びは spec-to-tickets が依存順に作る＝作成日順。設計書を持たない単発はエピック別に後ろへ。
async function printReviewGroups(results) {
  const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28' }
  const review = results.filter((p) => statusOf(p) === 'レビュー待ち')
  const byCreated = (a, b) => (a.created_time || '').localeCompare(b.created_time || '')
  const specs = new Map()   // specId → { title, status, review, url }
  for (const p of review) for (const r of (p.properties?.['設計書']?.relation || [])) if (!specs.has(r.id)) {
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${r.id}`, { headers: H })
      const j = res.ok ? await res.json() : null
      specs.set(r.id, {
        title: (j?.properties?.['タイトル']?.title || []).map((t) => t.plain_text).join('') || '(無題)',
        status: j?.properties?.['ステータス']?.select?.name ?? '(読めない)',
        review: j?.properties?.['レビュー']?.select?.name ?? '未',
        url: j?.url ?? '',
      })
    } catch { specs.set(r.id, { title: '(読めない)', status: '(読めない)', review: '未', url: '' }) }
  }
  // 段階順: タイトルの「【在庫①】」「E-3」「R-2」等から段階番号を拾い、無ければ作成日順（spec-to-tickets は依存順に作る）
  //  同じ設計書に系列が複数ある（在庫①〜④ と 道具①〜③）ので、系列（【在庫】/【道具】/E/R…）→番号 の順
  const stageOf = (p) => {
    const t = title(p)
    const circ = t.match(/【?([^【】\s]*?)([①②③④⑤⑥⑦⑧⑨⑩])/)
    if (circ) return { family: circ[1] || '', n: '①②③④⑤⑥⑦⑧⑨⑩'.indexOf(circ[2]) + 1 }
    const m = t.match(/\b([A-Z])-(\d+)\b/)
    if (m) return { family: m[1], n: Number(m[2]) }
    return null
  }
  const byStage = (a, b) => {
    const sa = stageOf(a), sb = stageOf(b)
    if (sa && sb) return sa.family.localeCompare(sb.family, 'ja') || (sa.n - sb.n) || byCreated(a, b)
    if (!!sa !== !!sb) return sa ? -1 : 1
    return byCreated(a, b)
  }
  const grouped = new Map(); const single = []
  for (const p of review.sort(byStage)) {
    const rel = p.properties?.['設計書']?.relation || []
    if (!rel.length) { single.push(p); continue }
    for (const r of rel) { if (!grouped.has(r.id)) grouped.set(r.id, []); grouped.get(r.id).push(p) }
  }
  const line = (p) => {
    const dodai = dodaiOf(p) ? '🧱' : ''
    const tg = tagsOf(p)
    return `  - [${priority(p) ?? '-'}/${riskOf(p) ?? '-'}${dodai}] ${title(p)}${tg.length ? ' 〔' + tg.join(',') + '〕' : ''}\n    ${p.url}`
  }
  console.log(`▶ 対象プロジェクト: ${PROJECT_NAME} — レビュー待ち ${review.length}件 を設計書単位に束ねた`)
  console.log(`■ 設計書 ${grouped.size}枚 / 単発 ${single.length}件`)
  let n = 0
  for (const [id, arr] of grouped) {
    const sp = specs.get(id)
    n++
    console.log(`\n## ${n}. 設計書「${sp.title}」（設計書ステータス: ${sp.status} / レビュー: ${sp.review}）— ${arr.length}件（段階順）`)
    console.log(`   ${sp.url}`)
    for (const p of arr) console.log(line(p))
  }
  if (single.length) {
    const byEpic = new Map()
    for (const p of single) { const e = p.properties?.['エピック']?.select?.name ?? '(未分類)'; if (!byEpic.has(e)) byEpic.set(e, []); byEpic.get(e).push(p) }
    for (const [epic, arr] of byEpic) {
      n++
      console.log(`\n## ${n}. 単発（設計書なし）エピック「${epic}」— ${arr.length}件`)
      for (const p of arr) console.log(line(p))
    }
  }
}

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

  // --board: 全ステータスの盤面を出して終了（/run ステートマシン用）
  if (BOARD) { printBoard(out.results); return }
  if (REVIEW) { await printReviewGroups(out.results); return }

  // ★T44 設計OK ゲート（2026-09-20）: 設計書 relation を持つ要件定義済みは、設計書のステータスが
  //   設計OK／チケット化済 になるまで Ready から外す（先方の回答待ちのものを /run が拾って推測実装しない）。
  //   設計書が読めない（未共有・失敗）時は fail-closed＝外す（理由を出す）。設計書なしは従来どおり。
  const specStatus = new Map()
  for (const p of out.results) for (const r of (p.properties?.['設計書']?.relation || [])) if (!specStatus.has(r.id)) {
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${r.id}`, { headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28' } })
      const j = res.ok ? await res.json() : null
      specStatus.set(r.id, j?.properties?.['ステータス']?.select?.name ?? '(読めない)')
    } catch { specStatus.set(r.id, '(読めない)') }
  }
  const specGate = (p) => {
    const rel = p.properties?.['設計書']?.relation || []
    if (rel.length === 0) return null
    const bad = rel.map((r) => specStatus.get(r.id)).filter((st) => !['設計OK', 'チケット化済'].includes(st))
    return bad.length ? `設計OK待ち（設計書: ${bad.join('/')}）` : null
  }
  const held = out.results.filter((p) => specGate(p))
  if (held.length) {
    console.log(`■ 設計OK待ちで保留中（Ready から除外）: ${held.length}件`)
    for (const p of held) console.log(`  - ${title(p)} — ${specGate(p)}`)
  }

  const rows = out.results.filter((p) => !specGate(p)).sort((a, b) => {
    const ra = rankOfPriority(priority(a))
    const rb = rankOfPriority(priority(b))
    if (ra !== rb) return ra - rb
    return (a.created_time || '').localeCompare(b.created_time || '')   // 同率は作成日古い順
  })

  console.log(`▶ 対象プロジェクト: ${PROJECT_NAME}（案件で絞り込み中）`)
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
