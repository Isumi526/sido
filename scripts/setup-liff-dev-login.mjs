#!/usr/bin/env node
// ============================================================
//  scripts/setup-liff-dev-login.mjs
//  作業員アプリ（apps/liff）のローカル開発用に「テスト用作業員のログイン」を用意する（2026-09-27）。
//
//  RLS第2段B以降、ログイン無し（公開キー）では作業員アプリの画面が成り立たない。開発モードは
//  useLiff.ts がこのログイン（seed の Worker 01 ＝ worker01.login.e2e@example.com）で自動ログインする。
//  E2E（liff.worker-login 等）を一度でも回したローカルDBには既にあるので、db reset 直後など
//  「自動ログインに失敗しました」と出た時だけ実行すればよい。何度実行しても同じ状態になる。
//
//  ★ローカル専用。Supabase URL が 127.0.0.1 / localhost でなければ何もせず終了する。
//
//  使い方:  node scripts/setup-liff-dev-login.mjs
//  前提:    supabase start 済み・apps/liff/.env.local（ローカルの URL と公開キー）がある
// ============================================================
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EMAIL = 'worker01.login.e2e@example.com'   // useLiff.ts の DEV_LOGIN_EMAIL と同じ
const PASS = 'worker-login-1234'                 // tests/e2e/helpers.ts の LIFF_LOGIN_PASS と同じ
const WORKER_NAME = 'Worker 01'                  // supabase/seed.sql（line_user_id='dev-user-id' の作業員）

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, 'apps/liff/.env.local')
if (!existsSync(envPath)) {
  console.error(`apps/liff/.env.local が無い（ローカルの NUXT_PUBLIC_SUPABASE_URL / ANON_KEY を置くファイル）: ${envPath}`)
  process.exit(1)
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(m => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
)
const SUPABASE_URL = env.NUXT_PUBLIC_SUPABASE_URL
const ANON_KEY = env.NUXT_PUBLIC_SUPABASE_ANON_KEY
const SLUG = env.NUXT_PUBLIC_ACCOUNT_SLUG || 'test'

// ── ガード: ローカル以外には絶対に触らない ──
let host = ''
try { host = new URL(SUPABASE_URL).hostname } catch { /* 下で弾く */ }
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
  console.error(`Supabase URL がローカルではないので中止します: ${SUPABASE_URL || '(未設定)'}`)
  process.exit(1)
}
// DB は LOCAL_DB_URL（ルート .env）優先、無ければ API ポート+1（supabase CLI の割当）
const u = new URL(SUPABASE_URL)
const DB_URL = process.env.LOCAL_DB_URL || `postgresql://postgres:postgres@127.0.0.1:${Number(u.port || 54321) + 1}/postgres`
if (!/@(127\.0\.0\.1|localhost):/.test(DB_URL)) {
  console.error('LOCAL_DB_URL がローカルではないので中止します')
  process.exit(1)
}

const psql = (sql) => execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8' }).trim()

// 1) 対象の作業員
const workerId = psql(
  `select w.id from workers w join accounts a on a.id = w.account_id where a.slug = '${SLUG}' and w.name = '${WORKER_NAME}' limit 1`,
)
if (!workerId) {
  console.error(`作業員「${WORKER_NAME}」（テナント ${SLUG}）が無い。supabase/seed.sql が入っているか確認してください`)
  process.exit(1)
}

// 2) ログイン（auth ユーザー）が無ければ GoTrue の signup で作る（token 列などを手で埋めずに済む）
if (!psql(`select id from auth.users where email = '${EMAIL}'`)) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })
  if (!r.ok) {
    console.error(`signup に失敗: ${r.status} ${(await r.text()).slice(0, 200)}`)
    process.exit(1)
  }
}

// 3) パスワード・確認済み・身元（app_metadata）と、作業員との紐付けを揃える（E2E の liff.worker-login と同じ形）
psql(
  `update auth.users set ` +
  `encrypted_password = extensions.crypt('${PASS}', extensions.gen_salt('bf')), ` +
  `email_confirmed_at = coalesce(email_confirmed_at, now()), ` +
  `raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('account_slug', '${SLUG}', 'worker_id', '${workerId}', 'role', 'worker') ` +
  `where email = '${EMAIL}'`,
)
psql(`update workers set auth_user_id = (select id from auth.users where email = '${EMAIL}') where id = '${workerId}'`)

// 4) 実際にログインできることを確かめる
const t = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
}).then(x => x.json()).catch(() => null)
if (!t?.access_token) {
  console.error(`ログインの確認に失敗: ${JSON.stringify(t).slice(0, 200)}`)
  process.exit(1)
}
console.log(`OK: ${WORKER_NAME}（${SLUG}）のログインを用意しました → ${EMAIL}`)
console.log('   npm run dev:liff で http://localhost:3000 を開けば自動でこの作業員としてログインします')
