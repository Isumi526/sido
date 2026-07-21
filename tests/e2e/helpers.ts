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

// psql 直接接続用（auth.users 等 REST 非公開のテーブルを操作するテスト向け）。
// ハードコード54322を避け、SUPABASE_URL のポートから逆算する（supabase CLI の既定割当＝ API port + 1 = DB port）。
// このプロジェクトのローカルスタックは 56321/56322 に固定（他プロジェクトと共存のため）なので
// 決め打ちすると環境が変わった時にサイレントに間違った(または存在しない)DBへ繋ぎにいく。
// 明示的に SUPABASE_DB_URL が設定されていればそちらを優先。
function deriveDbUrl(): string {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL
  try {
    const u = new URL(SUPABASE_URL)
    const apiPort = Number(u.port || 80)
    return `postgresql://postgres:postgres@${u.hostname}:${apiPort + 1}/postgres`
  } catch {
    return 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  }
}
export const DB_URL = deriveDbUrl()

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

// フロント(ブラウザ=JSTローカル時刻)基準の「今日」(YYYY-MM-DD)。
// new Date().toISOString().slice(0,10) はUTC日付を返すため、深夜0-9時JSTは
// フロントの「今日」と1日ズレる(2026-07-21未明のE2E実行で判明)。日付シードは必ずこちらを使う。
export function todayJST(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 「昨日の正午(JSTローカル)」のISO timestamp。固定オフセット(例:30時間前)で計算すると
// 深夜0-6時JSTの実行時に「一昨日」になってしまう(2026-07-21未明のE2E実行で判明)ため、
// 暦日ベースで昨日の日付を出してから正午に固定する。
export function yesterdayNoonJST(): string {
  const now = new Date()
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0)
  return y.toISOString()
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

// service_role キー（RLS バイパス）。RLS を入れた表（purchase_orders 等）の
// シード/検証/後始末や、auth admin API（app_metadata 付与）に使う。ローカル専用。
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''
const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }

/** service_role で PostgREST を叩く（RLS バイパス・テスト専用） */
export async function restSrv(pathAndQuery: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...srvHeaders, ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST(srv) ${res.status} ${pathAndQuery}: ${text}`)
  return text ? JSON.parse(text) : null
}

/** auth admin API（service_role）。app_metadata 付与等に使う。 */
export async function authAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    ...init,
    headers: { ...srvHeaders, ...(init.headers || {}) },
  })
}

/** test アカウントの id を返す */
export async function getAccountId(): Promise<string> {
  const rows = await rest(`accounts?slug=eq.${encodeURIComponent(ACCOUNT_SLUG)}&select=id`)
  if (!rows?.length) throw new Error(`account not found: ${ACCOUNT_SLUG}`)
  return rows[0].id
}

// 現場マスタの責任者候補（現場管理者以上=admin/office/site_manager）のキャッシュ。
// 複数specがそれぞれ専用ワーカーを作ると無駄に増えるため、プロセス内で使い回す。
let _respWorkerId: string | null | undefined

/**
 * 現場マスタの追加/編集フォームは責任者(現場管理者以上)が必須(a472f7e)。
 * REST で直接 site を作る spec が admin UI の編集モーダルで保存(.btn-save)まで行う場合、
 * responsible_worker_id が無いと save() が「責任者を選択してください」で弾いて保存が完了しない。
 * 既存の候補を探し、無ければテスト専用の候補を1体作って使い回す（他specの実行順に依存しない）。
 */
export async function ensureResponsibleWorkerId(accountId: string): Promise<string> {
  if (_respWorkerId) return _respWorkerId
  const existing = await rest(`workers?account_id=eq.${accountId}&active=eq.true&permission_role=in.(admin,office,site_manager)&select=id&limit=1`)
  if (existing?.[0]?.id) { _respWorkerId = existing[0].id; return _respWorkerId! }
  const created = await rest('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: 'E2E責任者候補(共通)', role: 'site', permission_role: 'site_manager', unit_price: 20000, active: true, sort_order: 997 }),
  })
  _respWorkerId = created?.[0]?.id
  return _respWorkerId!
}

/** dev-user-id（LIFF devモード用ユーザー）の users.id を返す */
export async function getDevUserId(): Promise<string | null> {
  const accountId = await getAccountId()
  const rows = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  return rows?.[0]?.id ?? null
}

/**
 * 現場情報共有(site_shares・Part B・2026-07-17): LIFF devユーザーに指定現場の閲覧権を付与する。
 * sites/index.vue・chats/index.vue・site-chat/[id].vue が site_shares 基準に絞り込むようになった
 * ため、これらのページ/機能をテストするE2Eは対象現場ごとに本関数で共有登録しておく必要がある
 * （responsible_worker_id で現場責任者になっている場合は不要＝そちらは別途自動で見える）。
 */
export async function grantSiteShare(siteId: string): Promise<void> {
  const accountId = await getAccountId()
  const userId = await getDevUserId()
  if (!userId) { console.warn('[e2e] grantSiteShare: dev-user-id の users行が見つかりません'); return }
  await rest('site_shares', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, site_id: siteId, user_id: userId }),
  })
}

/** upsert（merge-duplicates）して representation を返す */
export async function upsert(table: string, onConflict: string, body: unknown): Promise<any[]> {
  return rest(`${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  })
}
