#!/usr/bin/env node
// ============================================================
//  backfill-site-id.mjs
//  daily_reports.sites[] の各現場に site_id を後付けする（根本対策のバックフィル）。
//  ・各アカウントの active な現場マスタへ「正規化名一致」で解決（LIFF保存/集計と同一ロジック）。
//  ・解決できたエントリにだけ site_id を刻む（siteName は変更しない＝追加のみ・非破壊）。
//  ・これにより表記ゆれで割れていた孤児（例: ルルレモン原宿 → ルルレモン　原宿）が
//    集計上 active 現場の site_id に集約される。
//
//  使い方:
//    node scripts/backfill-site-id.mjs                 # local・dry-run（既定・安全）
//    node scripts/backfill-site-id.mjs --apply         # local に適用
//    node scripts/backfill-site-id.mjs --db prod       # 本番・dry-run（読取のみ）
//    node scripts/backfill-site-id.mjs --db prod --apply# 本番に適用（人の承認後・ship手順で）
//
//  接続: local=127.0.0.1:54322 / prod=.env の SUPABASE_PROD_DB_URL（値はログに出さない）。
// ============================================================
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const DB = args.includes('--db') ? args[args.indexOf('--db') + 1] : 'local'

// ---- .env 読み込み（SUPABASE_PROD_DB_URL 用・値は表示しない）----
function loadEnv() {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const out = {}
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch { return {} }
}
const env = loadEnv()
const DB_URL = DB === 'prod'
  ? (env.SUPABASE_PROD_DB_URL || '')
  : 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (DB === 'prod' && !DB_URL) { console.error('SUPABASE_PROD_DB_URL が .env にありません'); process.exit(1) }

// ---- 現場名の正規化（apps/*/siteSimilarity.ts と同一ロジック）----
function normalizeSiteName(s) {
  return (s || '')
    .normalize('NFKC')
    .replace(/[\s　・,，、。.\-_/／()（）「」『』【】]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
}
function resolveActiveSiteId(site, activeSites) {
  const raw = site?.siteName
  if (!raw || raw === '__unset__') return null
  const name = raw === '__other__' ? (site?.customSiteName || '') : raw
  if (!name) return null
  const exact = activeSites.filter((s) => s.name === name)
  if (exact.length >= 1) return exact[0].id
  const nn = normalizeSiteName(name)
  if (!nn) return null
  const norm = activeSites.filter((s) => normalizeSiteName(s.name) === nn)
  if (norm.length === 1) return norm[0].id
  return null
}

// ---- psql ヘルパ（読取）----
function psqlJsonLines(sql) {
  const r = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status !== 0) { console.error('psql エラー:', r.stderr); process.exit(1) }
  return r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

console.log(`[backfill-site-id] db=${DB} mode=${APPLY ? 'APPLY' : 'dry-run'}`)

// 1) active 現場マスタ（アカウント別）
const siteRows = psqlJsonLines(
  `select json_build_object('a', account_id::text, 'id', id::text, 'name', name) from sites where active = true and name is not null order by created_at asc`)
const activeByAcct = {}
for (const s of siteRows) (activeByAcct[s.a] ??= []).push({ id: s.id, name: s.name })

// 2) 日報を走査し、site_id を解決して差分を作る
const reps = psqlJsonLines(
  `select json_build_object('id', id::text, 'a', account_id::text, 'sites', coalesce(sites, '[]'::jsonb)) from daily_reports`)

let scanned = 0, changedRows = 0, stampedEntries = 0, alreadyHad = 0, unresolved = 0
const updates = [] // { id, sites }
const samples = []
for (const rep of reps) {
  scanned++
  const active = activeByAcct[rep.a] ?? []
  const arr = Array.isArray(rep.sites) ? rep.sites : []
  let changed = false
  const next = arr.map((s) => {
    if (s && typeof s === 'object' && s.site_id) { alreadyHad++; return s }
    const id = resolveActiveSiteId(s, active)
    if (id) {
      changed = true; stampedEntries++
      if (samples.length < 12) samples.push({ id: rep.id, from: s?.siteName, to: id })
      return { ...s, site_id: id }
    }
    if (s?.siteName && s.siteName !== '__unset__') unresolved++
    return s
  })
  if (changed) { changedRows++; updates.push({ id: rep.id, sites: next }) }
}

console.log(`  日報 ${scanned} 件走査 / 変更対象 ${changedRows} 行 / site_id付与 ${stampedEntries} 現場エントリ`)
console.log(`  既にsite_id有 ${alreadyHad} / 解決できず(名前フォールバック) ${unresolved}`)
if (samples.length) {
  console.log('  サンプル(付与):')
  for (const s of samples) console.log(`    report=${s.id} "${s.from}" -> site_id ${s.to}`)
}

if (!APPLY) {
  console.log('  dry-run のため書込みなし。--apply で適用。')
  process.exit(0)
}

// 3) 適用: UPDATE 文を生成して psql -f で一括実行（追加のみ・非破壊）
const esc = (str) => str.replace(/'/g, "''")
const lines = ['BEGIN;']
for (const u of updates) {
  const json = JSON.stringify(u.sites)
  lines.push(`UPDATE daily_reports SET sites = '${esc(json)}'::jsonb, updated_at = now() WHERE id = '${u.id}';`)
}
lines.push('COMMIT;')
const sqlPath = new URL('../.backfill-site-id.generated.sql', import.meta.url)
writeFileSync(sqlPath, lines.join('\n'))
const r = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath.pathname],
  { encoding: 'utf8', maxBuffer: 1 << 28 })
if (r.status !== 0) { console.error('適用エラー:', r.stderr); process.exit(1) }
console.log(`  適用完了: ${changedRows} 行を更新。`)
