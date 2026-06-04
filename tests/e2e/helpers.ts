// ============================================================
//  tests/e2e/helpers.ts
//  E2E 共通：環境変数の読み込みと Supabase REST ヘルパー
//  接続先は【ローカルスタック】（apps/admin/.env.local が優先）。
//  RLS 無効テーブル（contractors / users / daily_reports 等）は
//  publishable(anon)キーで読み書きできるので、シード・後始末に使う。
//  admin 認証は実ログイン（auth.setup.ts）で行う。
// ============================================================
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch { return {} }
}

// Playwright は repo ルートを cwd に実行される。.env.local（ローカル）を優先。
const env = {
  ...loadEnv(resolve(process.cwd(), 'apps/admin/.env')),
  ...loadEnv(resolve(process.cwd(), 'apps/admin/.env.local')),
}

export const SUPABASE_URL  = process.env.SUPABASE_URL      || env.VITE_SUPABASE_URL
export const ANON_KEY      = process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
export const ACCOUNT_SLUG  = process.env.ACCOUNT_SLUG      || env.VITE_ACCOUNT_SLUG || 'test'

// admin 実ログイン用（ID=e2e → e2e@email.com）
export const ADMIN_LOGIN_ID   = process.env.ADMIN_LOGIN_ID   || 'e2e'
export const ADMIN_LOGIN_PASS = process.env.ADMIN_LOGIN_PASS || 'e2e-pass-1234'
export const ADMIN_LOGIN_EMAIL = `${ADMIN_LOGIN_ID}@email.com`

// 各アプリの URL（ローカル前提。必要なら env で上書き）
export const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3002'
export const LIFF_URL  = process.env.LIFF_URL  || 'http://localhost:3000'

const headers = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
}

export async function rest(pathAndQuery: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST ${res.status} ${pathAndQuery}: ${text}`)
  return text ? JSON.parse(text) : null
}

/** test アカウントの id を返す */
export async function getAccountId(): Promise<string> {
  const rows = await rest(`accounts?slug=eq.${encodeURIComponent(ACCOUNT_SLUG)}&select=id`)
  if (!rows?.length) throw new Error(`account not found: ${ACCOUNT_SLUG}`)
  return rows[0].id
}

/** dev-user-id（LIFF devモード用ユーザー）の users.id を返す */
export async function getDevUserId(): Promise<string | null> {
  const accountId = await getAccountId()
  const rows = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  return rows?.[0]?.id ?? null
}

/** upsert（merge-duplicates）して representation を返す */
export async function upsert(table: string, onConflict: string, body: unknown): Promise<any[]> {
  return rest(`${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  })
}
