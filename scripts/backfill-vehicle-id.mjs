#!/usr/bin/env node
// ============================================================
//  backfill-vehicle-id.mjs
//  daily_reports.sites[].expenses.vehicles[] の各車両に vehicleId を後付けする（2026-09-20・日報の車両欄をマスタ選択に）。
//  ・各アカウントの車両マスタ（active/非active 問わず・過去の日報は当時の車で書かれている）へ
//    「完全一致 → 正規化名一致（一意の時だけ）」で解決する。
//  ・解決できた車両にだけ vehicleId を刻む（vehicleName は変更しない＝追加のみ・非破壊）。解決できないものは触らない。
//  ・backfill-site-id.mjs と同型。
//
//  使い方:
//    node scripts/backfill-vehicle-id.mjs                 # local・dry-run（既定・安全）
//    node scripts/backfill-vehicle-id.mjs --apply         # local に適用
//    node scripts/backfill-vehicle-id.mjs --db prod       # 本番・dry-run（読取のみ・件数と対応表を出す）
//    node scripts/backfill-vehicle-id.mjs --db prod --apply# 本番に適用（人の承認後・ship手順で。UPDATE なので事前バックアップ）
//
//  接続: local=.env の LOCAL_DB_URL（既定 127.0.0.1:56322） / prod=.env の SUPABASE_PROD_DB_URL（値はログに出さない）。
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
  : (env.LOCAL_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:56322/postgres')
if (DB === 'prod' && !DB_URL) { console.error('SUPABASE_PROD_DB_URL が .env にありません'); process.exit(1) }

// ---- 車両名の正規化（空白・全角半角・大小の違いを吸収。数字は残す）----
function normalizeVehicleName(v) {
  return (v || '').normalize('NFKC').replace(/[\s　・,，、。.\-_/／()（）]/g, '').toLowerCase()
}
function resolveVehicleId(name, vehicles) {
  const n = (name || '').trim()
  if (!n || n === 'その他') return null
  const exact = vehicles.filter((v) => v.name === n)
  if (exact.length === 1) return exact[0].id
  if (exact.length > 1) return exact.find((v) => v.active)?.id ?? exact[0].id
  const nn = normalizeVehicleName(n)
  if (!nn) return null
  const norm = vehicles.filter((v) => normalizeVehicleName(v.name) === nn)
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

console.log(`[backfill-vehicle-id] db=${DB} mode=${APPLY ? 'APPLY' : 'dry-run'}`)

// 1) 車両マスタ（アカウント別・active 問わず）
const vehRows = psqlJsonLines(
  `select json_build_object('a', account_id::text, 'id', id::text, 'name', name, 'active', active) from vehicles where name is not null order by created_at asc`)
const vehByAcct = {}
for (const v of vehRows) (vehByAcct[v.a] ??= []).push({ id: v.id, name: v.name, active: !!v.active })

// 2) 日報を走査し、vehicleId を解決して差分を作る
const reps = psqlJsonLines(
  `select json_build_object('id', id::text, 'a', account_id::text, 'sites', coalesce(sites, '[]'::jsonb)) from daily_reports where sites::text like '%vehicleName%'`)

let scanned = 0, changedRows = 0, stamped = 0, alreadyHad = 0, unresolved = 0
const updates = []
const unresolvedNames = {}
const mapping = {}   // "account|name" -> id（対応表・報告用）
for (const rep of reps) {
  scanned++
  const vehicles = vehByAcct[rep.a] ?? []
  const arr = Array.isArray(rep.sites) ? rep.sites : []
  let changed = false
  const next = arr.map((site) => {
    const vs = Array.isArray(site?.expenses?.vehicles) ? site.expenses.vehicles : []
    if (!vs.length) return site
    const nv = vs.map((veh) => {
      if (!veh || typeof veh !== 'object') return veh
      if (veh.vehicleId) { alreadyHad++; return veh }
      if (!veh.vehicleName) return veh
      const id = resolveVehicleId(veh.vehicleName, vehicles)
      if (id) { changed = true; stamped++; mapping[`${rep.a}|${veh.vehicleName}`] = id; return { ...veh, vehicleId: id } }
      unresolved++; unresolvedNames[veh.vehicleName] = (unresolvedNames[veh.vehicleName] ?? 0) + 1
      return veh
    })
    return { ...site, expenses: { ...site.expenses, vehicles: nv } }
  })
  if (changed) { changedRows++; updates.push({ id: rep.id, sites: next }) }
}

console.log(`  日報 ${scanned} 件走査 / 変更対象 ${changedRows} 行 / vehicleId付与 ${stamped} 車両`)
console.log(`  既にvehicleId有 ${alreadyHad} / 解決できず(名前のまま) ${unresolved}`)
const pairs = Object.entries(mapping)
if (pairs.length) { console.log('  対応表(付与):'); for (const [k, id] of pairs.slice(0, 30)) console.log(`    "${k.split('|')[1]}" -> ${id}`) }
const un = Object.entries(unresolvedNames).sort((a, b) => b[1] - a[1])
if (un.length) { console.log('  解決できなかった表記(件数):'); for (const [n, c] of un.slice(0, 30)) console.log(`    "${n}" × ${c}`) }

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
const sqlPath = new URL('../.backfill-vehicle-id.generated.sql', import.meta.url)
writeFileSync(sqlPath, lines.join('\n'))
const r = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath.pathname],
  { encoding: 'utf8', maxBuffer: 1 << 28 })
if (r.status !== 0) { console.error('適用エラー:', r.stderr); process.exit(1) }
console.log(`  適用完了: ${changedRows} 行を更新。`)
