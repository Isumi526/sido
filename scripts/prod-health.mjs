#!/usr/bin/env node
// ============================================================
//  scripts/prod-health.mjs
//  本番ヘルスチェック — 「壊れたまま成功したように見える」不具合を機械で拾う。
//  チェック定義は scripts/prod-health/checks.mjs（1件直したら1件足す）。
//
//  使い方:
//    node scripts/prod-health.mjs                      # ローカルDBに対して実行（練習用）
//    node scripts/prod-health.mjs --prod-readonly      # ★本番を読み取り専用で監査
//    node scripts/prod-health.mjs --prod-readonly --assert   # 新規のcritical違反があれば非ゼロ終了
//    node scripts/prod-health.mjs --prod-readonly --notify   # 違反をLINE通知（cron用）
//    node scripts/prod-health.mjs --layer=1            # 層で絞る（1=不変条件 2=滞留 3=セキュリティ 4=スモーク）
//    node scripts/prod-health.mjs --check=dup-worker-auth
//    node scripts/prod-health.mjs --json               # 機械可読
//    node scripts/prod-health.mjs --prod-readonly --accept-current  # 今の違反を既知として baseline に記録
//
//  接続:
//    既定            = .env の LOCAL_DB_URL（sido は 56322。未設定だと別プロジェクトのDBを見るので必須）
//    --prod-readonly = .env の SUPABASE_PROD_DB_URL
//    URL は PG* env に分解して psql に渡す（argv/ログに残さない）。
//    本番は default_transaction_read_only=on で接続＝万一 SQL に書込が混ざっても物理的に落ちる。
//
//  ★baseline（ratchet）:
//    scripts/prod-health/baseline.json に「既知として見逃す違反キー」を持つ。
//    既存の汚れで毎日鳴り続けると誰も見なくなるので、既知は黙らせ「新しく増えた分」だけ鳴らす。
//    増えたら落ちる・減らす分には何もしない、が原則。
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHECKS, LAYER_NAMES } from './prod-health/checks.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'scripts', 'prod-health', 'baseline.json')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const getOpt = (k) => { const a = argv.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : null }

const PROD = has('--prod-readonly')
const ASSERT = has('--assert')
const NOTIFY = has('--notify')
const JSON_ONLY = has('--json')
const ACCEPT_CURRENT = has('--accept-current')
const DB_URL_OVERRIDE = getOpt('--db-url')
const LAYER_FILTER = (getOpt('--layer') || '').split(',').filter(Boolean).map(Number)
const CHECK_FILTER = (getOpt('--check') || '').split(',').filter(Boolean)

// ---- .env 読み（値はログに出さない）----
function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* .env 無しでも process.env / --db-url で動く */ }
  // ★CI には .env が無い。process.env を優先して読む（--db-url だと接続URLが argv に載るため）。
  for (const k of ['SUPABASE_PROD_DB_URL', 'LOCAL_DB_URL']) {
    if (process.env[k]) env[k] = process.env[k]
  }
  return env
}

// ---- 接続先決定（URL は PG* env に分解＝argv に出さない）----
function resolveConn(env) {
  let url, label
  if (DB_URL_OVERRIDE) { url = DB_URL_OVERRIDE; label = 'override' }
  else if (PROD) {
    url = env.SUPABASE_PROD_DB_URL
    if (!url) { console.error('✗ --prod-readonly だが .env に SUPABASE_PROD_DB_URL が無い'); process.exit(2) }
    label = 'PROD(read-only)'
  } else {
    url = (env.LOCAL_DB_URL || '').trim()
    if (!url) {
      // ★既定54322に落とすと別プロジェクトのDBを監査してしまう（2026-07-11 に踏んだ）。黙って進めない。
      console.error('✗ .env に LOCAL_DB_URL が無い。sido のローカルDBは 56322。誤って別プロジェクトを見ないよう停止する')
      process.exit(2)
    }
    label = `local(${new URL(url).port || '5432'})`
  }

  let u
  try { u = new URL(url) } catch { console.error('✗ DB URL の形式が不正'); process.exit(2) }
  const pgEnv = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username || 'postgres'),
    PGPASSWORD: decodeURIComponent(u.password || ''),
    PGDATABASE: (u.pathname || '/postgres').replace(/^\//, '') || 'postgres',
    PGCONNECT_TIMEOUT: '15',
    // ★読み取り専用を物理的に固定（チェックSQLに書込が混ざっても落ちる）
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=60000',
  }
  if (u.searchParams.get('sslmode')) pgEnv.PGSSLMODE = u.searchParams.get('sslmode')
  return { pgEnv, label }
}

// ---- チェックSQLを1本流して [{key, detail}] を得る ----
function runSql(pgEnv, sql) {
  // json_agg で1行1列に畳む（psql -A -t なので出力は1行のJSON）
  const wrapped = `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (${sql}) t`
  let out
  try {
    out = execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', wrapped], {
      env: { ...process.env, ...pgEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString().split('\n').filter(Boolean).slice(-3).join(' ')
    return { error: msg }
  }
  try { return { rows: JSON.parse(out.trim() || '[]') } }
  catch { return { error: '結果のJSON解析に失敗' } }
}

// ---- baseline（既知の違反）----
function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return {}
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).accepted ?? {} }
  catch { console.error('✗ baseline.json が壊れている'); process.exit(2) }
}

// ---- 実行 ----
const env = loadEnv()
const { pgEnv, label } = resolveConn(env)
const baseline = loadBaseline()

const targets = CHECKS.filter((c) =>
  (!LAYER_FILTER.length || LAYER_FILTER.includes(c.layer)) &&
  (!CHECK_FILTER.length || CHECK_FILTER.includes(c.id)))

if (!targets.length) { console.error('✗ 該当するチェックが無い'); process.exit(2) }

const results = []
for (const c of targets) {
  let outcome
  if (c.kind === 'sql') {
    outcome = runSql(pgEnv, c.sql)
  } else if (typeof c.run === 'function') {
    // 層3(probe)・層4(smoke)用。run() は {rows:[{key,detail}]} を返す
    try { outcome = await c.run({ env, pgEnv }) } catch (e) { outcome = { error: e.message } }
  } else {
    outcome = { error: `kind='${c.kind}' に run() が無い` }
  }

  if (outcome.error) {
    // ★測れなかったことを「違反0」と混同しない。エラーは黙って飲まずに別枠で出す。
    results.push({ ...c, status: 'error', error: outcome.error, known: [], fresh: [] })
    continue
  }
  const accepted = new Set(baseline[c.id]?.keys ?? [])
  const known = outcome.rows.filter((r) => accepted.has(String(r.key)))
  const fresh = outcome.rows.filter((r) => !accepted.has(String(r.key)))
  results.push({ ...c, status: 'ok', known, fresh })
}

// ---- --accept-current: 今の違反を既知として記録 ----
if (ACCEPT_CURRENT) {
  const accepted = { ...baseline }
  for (const r of results) {
    if (r.status !== 'ok') continue
    const keys = [...(baseline[r.id]?.keys ?? []), ...r.fresh.map((x) => String(x.key))]
    if (keys.length) accepted[r.id] = { keys: [...new Set(keys)], note: baseline[r.id]?.note ?? '要調査（--accept-current で自動記録）' }
  }
  writeFileSync(BASELINE_PATH, JSON.stringify({
    _comment: '既知として見逃す違反キー。新しく増えた分だけ鳴らすための ratchet。調査して直したらキーを消す。',
    accepted,
  }, null, 2) + '\n')
  console.log(`✓ baseline.json を更新（既知として記録）`)
  process.exit(0)
}

// ---- 出力 ----
const freshCritical = results.filter((r) => r.status === 'ok' && r.severity === 'critical' && r.fresh.length)
const freshWarn = results.filter((r) => r.status === 'ok' && r.severity === 'warn' && r.fresh.length)
const errored = results.filter((r) => r.status === 'error')

if (JSON_ONLY) {
  console.log(JSON.stringify({ target: label, results: results.map((r) => ({
    id: r.id, layer: r.layer, severity: r.severity, title: r.title, status: r.status,
    error: r.error ?? null, fresh: r.fresh.length, known: r.known.length,
    samples: r.fresh.slice(0, 5),
  })) }, null, 2))
} else {
  console.log(`\n本番ヘルスチェック — 対象: ${label}\n${'━'.repeat(60)}`)
  let lastLayer = null
  for (const r of results) {
    if (r.layer !== lastLayer) { console.log(`\n【層${r.layer}: ${LAYER_NAMES[r.layer]}】`); lastLayer = r.layer }
    const mark = r.status === 'error' ? '⚠ 測定不能'
      : r.fresh.length ? (r.severity === 'critical' ? '🔴 違反' : '🟡 注意')
      : '✓ 正常'
    const extra = r.status === 'error' ? ` — ${r.error}`
      : r.fresh.length ? ` — ${r.fresh.length}件${r.known.length ? `（既知 ${r.known.length} 件を除く）` : ''}`
      : r.known.length ? ` （既知 ${r.known.length} 件は baseline で除外中）` : ''
    console.log(`  ${mark}  ${r.title}${extra}`)
    for (const s of r.fresh.slice(0, 5)) console.log(`         ・${s.detail}`)
    if (r.fresh.length > 5) console.log(`         …ほか ${r.fresh.length - 5} 件`)
    if (r.fresh.length) console.log(`         ↳ 影響: ${r.impact}`)
  }
  console.log(`\n${'━'.repeat(60)}`)
  console.log(`🔴 新規のcritical違反: ${freshCritical.length} 種 / 🟡 注意: ${freshWarn.length} 種 / ⚠ 測定不能: ${errored.length} 種`)
  if (!freshCritical.length && !errored.length) console.log('問題なし。')
}

// ---- LINE通知（cron用・best-effort）----
if (NOTIFY && (freshCritical.length || errored.length)) {
  const lines = [
    ...freshCritical.map((r) => `${r.title}: ${r.fresh.length}件`),
    ...errored.map((r) => `${r.title}: 測定不能`),
  ]
  try {
    execFileSync('node', [
      join(ROOT, 'scripts', 'notify-humanball.mjs'),
      '--kind', '要対応',
      '--task', '本番ヘルスチェックで異常',
      '--detail', lines.slice(0, 4).join(' / ') + (lines.length > 4 ? ` ほか${lines.length - 4}件` : ''),
    ], { stdio: 'inherit' })
  } catch { /* 通知失敗は無視して処理を続ける（監査結果そのものは出力済み） */ }
}

// ★測定不能も失敗扱い。「0件と測れた」と「測れなかった」を混同しない。
if (ASSERT && (freshCritical.length || errored.length)) process.exit(1)
