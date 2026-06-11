// ============================================================
//  lib/account.ts
//  アカウント（テナント）識別 — マルチテナント対応
//  解決順: ログインユーザーの app_metadata.account_slug を優先
//          → 無ければビルド時 env VITE_ACCOUNT_SLUG（後方互換）
//  これにより 1デプロイで全テナントを捌ける（ユーザーごとに所属accountが決まる）。
//  既存の slug固定デプロイ（VITE_ACCOUNT_SLUG 設定済み）は metadata 無しでも従来通り動く。
// ============================================================
import { supabase } from './supabase'
import { currentUser } from './auth'

const FALLBACK_SLUG = import.meta.env.VITE_ACCOUNT_SLUG || 'sample-construction'

/** 現在のテナント slug を解決する（ログインユーザーの app_metadata 優先・無ければビルド時env） */
export function getAccountSlug(): string {
  const meta = (currentUser.value?.app_metadata ?? {}) as Record<string, unknown>
  const fromUser = typeof meta.account_slug === 'string' ? meta.account_slug : ''
  return fromUser || FALLBACK_SLUG
}

// 後方互換: ビルド時の固定値。新規コードは getAccountSlug() を使うこと。
export const ACCOUNT_SLUG = FALLBACK_SLUG

let _accountId: string | null = null
let _accountName: string | null = null
let _resolvedSlug: string | null = null

/** 解決済み slug が変わっていたらキャッシュを捨てる（ログインユーザー切替に追従） */
function ensureFresh(slug: string) {
  if (_resolvedSlug !== slug) {
    _accountId = null
    _accountName = null
    _resolvedSlug = slug
  }
}

export async function getAccountId(): Promise<string> {
  const slug = getAccountSlug()
  ensureFresh(slug)
  if (_accountId) return _accountId
  const { data } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('slug', slug)
    .single()
  _accountId   = data?.id ?? ''
  _accountName = data?.name ?? null
  return _accountId
}

// アカウント（会社）名を取得。サイト名表示などに使用。
export async function getAccountName(): Promise<string | null> {
  const slug = getAccountSlug()
  ensureFresh(slug)
  if (_accountName) return _accountName
  await getAccountId()
  return _accountName
}
