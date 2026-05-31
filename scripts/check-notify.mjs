#!/usr/bin/env node
// ============================================================
//  scripts/check-notify.mjs
//  日報通知 ON/OFF をローカルから確認・切替する検証スクリプト（Docker不要）
//
//  Edge Function の isReportNotifyEnabled() と同じロジックで、
//  settings.notify_report_enabled を読んで「通知する/しない」を判定する。
//
//  使い方:
//    node scripts/check-notify.mjs                 # test アカウントの判定を表示
//    node scripts/check-notify.mjs sido            # sido アカウントの判定を表示
//    node scripts/check-notify.mjs test --set off  # test を OFF にして判定表示
//    node scripts/check-notify.mjs test --set on   # test を ON  にして判定表示
//
//  接続先は apps/admin/.env の VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を使用
//  （settings テーブルは RLS 無効なので anon キーで読み書き可）。
// ============================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── .env 読み込み（apps/admin/.env → 環境変数で上書き可）──────
function loadEnv(path) {
  try {
    const text = readFileSync(path, 'utf8')
    const out = {}
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch {
    return {}
  }
}

const env = loadEnv(resolve(__dirname, '../apps/admin/.env'))
const SUPABASE_URL = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('❌ SUPABASE_URL / ANON_KEY が見つかりません（apps/admin/.env を確認）')
  process.exit(1)
}

// ── 引数 ──────────────────────────────────────────────────
const args = process.argv.slice(2)
const slug = args.find(a => !a.startsWith('--')) || 'test'
const setIdx = args.indexOf('--set')
const setVal = setIdx >= 0 ? args[setIdx + 1] : null   // 'on' | 'off'

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
}

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function main() {
  // account_id を解決
  const accounts = await rest(`accounts?slug=eq.${encodeURIComponent(slug)}&select=id`)
  if (!accounts?.length) {
    console.error(`❌ account が見つかりません: slug=${slug}`)
    process.exit(1)
  }
  const accountId = accounts[0].id

  // --set 指定があれば先に書き込み（admin のトグルと同じ upsert）
  if (setVal) {
    const value = setVal === 'off' ? 'false' : 'true'
    await rest(`settings?on_conflict=key,account_id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        key: 'notify_report_enabled',
        value,
        label: '日報通知（送信・編集）',
        account_id: accountId,
        updated_at: new Date().toISOString(),
      }),
    })
    console.log(`📝 ${slug} の notify_report_enabled を '${value}' に設定しました`)
  }

  // 現在値を読む
  const rows = await rest(
    `settings?account_id=eq.${accountId}&key=eq.notify_report_enabled&select=value`,
  )
  const raw = rows?.[0]?.value ?? null

  // Edge Function と同じ判定: 未設定(null) は ON、'false' のみ OFF
  const enabled = raw !== 'false'

  console.log('──────────────────────────────')
  console.log(`アカウント        : ${slug}`)
  console.log(`設定値(DB)        : ${raw === null ? '(未設定 → ON扱い)' : `'${raw}'`}`)
  console.log(`日報 送信通知      : ${enabled ? '✅ 通知する' : '🚫 通知しない'}`)
  console.log(`日報 編集通知      : ${enabled ? '✅ 通知する' : '🚫 通知しない'}`)
  console.log('──────────────────────────────')
  console.log(enabled
    ? '→ submit-report / notify-edit は LINE 送信します'
    : '→ submit-report / notify-edit は { skipped: "notify_disabled" } で送信しません')
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
