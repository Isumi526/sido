// ============================================================
//  scripts/add-dev-update.mjs
//  本番の dev_updates（管理画面トップの更新履歴）に1件追加する。
//  /ship で本番反映した内容をここに追記する用途。
//
//  使い方:
//    node scripts/add-dev-update.mjs "<1行要約>" ["<該当ページ link>"]
//    例: node scripts/add-dev-update.mjs "経費管理を新設" "/expenses"
//
//  接続先は本番（apps/admin/.env の VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。
//  dev_updates は RLS 無効のため anon キーで INSERT 可能。
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

const [, , title, link] = process.argv
if (!title) {
  console.error('usage: node scripts/add-dev-update.mjs "<1行要約>" ["<link>"]')
  process.exit(1)
}

// 本番接続情報（apps/admin/.env が本番向き。env で上書き可）
const env = loadEnv(resolve(ROOT, 'apps/admin/.env'))
const URL = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) { console.error('✗ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が取得できません (apps/admin/.env)'); process.exit(1) }
if (!URL.includes('nrzzesbtvswoiouhldvi')) {
  console.error(`⚠ 接続先が本番ではない可能性: ${URL}`)
}

const res = await fetch(`${URL}/rest/v1/dev_updates`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ title, link: link || null }),
})
const text = await res.text()
if (!res.ok) { console.error(`✗ INSERT 失敗 (HTTP ${res.status}): ${text}`); process.exit(1) }
console.log(`✓ dev_updates に追加: "${title}"${link ? ` (${link})` : ''}`)
