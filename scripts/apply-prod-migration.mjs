#!/usr/bin/env node
// ============================================================
//  scripts/apply-prod-migration.mjs
//  本番 Supabase（.env の SUPABASE_PROD_DB_URL）に migration ファイルを1本ずつ psql で適用する。
//
//  使い方:
//    node --env-file=.env scripts/apply-prod-migration.mjs supabase/migrations/2026xxxx_a.sql [b.sql ...]
//    node --env-file=.env scripts/apply-prod-migration.mjs --dry  <files>   # 中身の危険判定だけ
//
//  ★方針（CLAUDE.md「本番migration適用は条件付きでCC実行可」）:
//   - 人の明示承認があること（このスクリプトは承認の記録を持たない＝呼ぶ側の責任）
//   - 破壊的DDL（DROP TABLE/COLUMN・TRUNCATE・DELETE・型変更・NOT NULL 追加）を含むファイルは
//     ここで止める（--force が無い限り適用しない）。`drop trigger/policy/function if exists` の
//     作り直しは破壊的に数えない。
//   - 接続文字列は出力しない。
//   - 適用後、supabase_migrations.schema_migrations に version を記録する（履歴 drift を残さない）。
// ============================================================
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const force = args.includes('--force')
const files = args.filter((a) => !a.startsWith('--'))
if (!files.length) { console.error('migration ファイルを指定してください'); process.exit(1) }

const DB = process.env.SUPABASE_PROD_DB_URL
if (!DB) { console.error('SUPABASE_PROD_DB_URL が無い（--env-file=.env を付ける）'); process.exit(1) }
const u = new URL(DB)
if (!u.hostname.includes('nrzzesbtvswoiouhldvi') && !u.username.includes('nrzzesbtvswoiouhldvi')) {
  console.error('本番 ref (nrzzesbtvswoiouhldvi) 以外に見えるので中止'); process.exit(1)
}
const pgEnv = {
  ...process.env,
  PGHOST: u.hostname, PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username || 'postgres'),
  PGPASSWORD: decodeURIComponent(u.password || ''),
  PGDATABASE: (u.pathname || '/postgres').replace(/^\//, '') || 'postgres',
  PGSSLMODE: 'require',
}

const DESTRUCTIVE = [
  /\bdrop\s+table\b/i, /\bdrop\s+column\b/i, /\bdrop\s+schema\b/i, /^\s*truncate\b/im,
  /^\s*delete\s+from\b/im, /\balter\s+column\s+\S+\s+type\b/i, /\bset\s+not\s+null\b/i,
]

function psql(sqlOrFile, { file = false } = {}) {
  const a = ['-v', 'ON_ERROR_STOP=1', '-q', '-X', ...(file ? ['-f', sqlOrFile] : ['-Atc', sqlOrFile])]
  return execFileSync('psql', a, { env: pgEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

let bad = 0
for (const f of files) {
  const sql = readFileSync(f, 'utf8')
  const hits = DESTRUCTIVE.filter((re) => re.test(sql)).map((re) => re.source)
  const version = basename(f).match(/^(\d{14})/)?.[1]
  if (hits.length && !force) {
    console.error(`✗ ${basename(f)}: 破壊的な記述あり → 適用しない（人手でSQL Editor＋事前バックアップ）: ${hits.join(', ')}`)
    bad++; continue
  }
  if (dry) { console.log(`✓ ${basename(f)}: 追加のみ（dry）`); continue }
  const already = version ? psql(`select 1 from supabase_migrations.schema_migrations where version='${version}'`).trim() : ''
  if (already === '1') { console.log(`– ${basename(f)}: 適用済み（schema_migrations に記録あり）→ スキップ`); continue }
  try {
    psql(f, { file: true })
    if (version) psql(`insert into supabase_migrations.schema_migrations(version, name) values ('${version}', '${basename(f).replace(/\.sql$/, '').replace(/^\d{14}_/, '')}') on conflict do nothing`)
    console.log(`✓ ${basename(f)}: 適用`)
  } catch (e) {
    console.error(`✗ ${basename(f)}: 失敗\n${String(e.stderr || e.message).slice(0, 2000)}`)
    bad++; break
  }
}
process.exit(bad ? 1 : 0)
