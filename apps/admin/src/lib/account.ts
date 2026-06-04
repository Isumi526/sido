// ============================================================
//  lib/account.ts
//  アカウント（テナント）識別
//  VITE_ACCOUNT_SLUG で切り替え: local=test / Vercel=production
// ============================================================
import { supabase } from './supabase'

export const ACCOUNT_SLUG = import.meta.env.VITE_ACCOUNT_SLUG || 'sample-construction'

let _accountId: string | null = null
let _accountName: string | null = null

export async function getAccountId(): Promise<string> {
  if (_accountId) return _accountId
  const { data } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('slug', ACCOUNT_SLUG)
    .single()
  _accountId   = data?.id ?? ''
  _accountName = data?.name ?? null
  return _accountId
}

// アカウント（会社）名を取得。サイト名表示などに使用。
export async function getAccountName(): Promise<string | null> {
  if (_accountName) return _accountName
  const { data } = await supabase
    .from('accounts')
    .select('name')
    .eq('slug', ACCOUNT_SLUG)
    .single()
  _accountName = data?.name ?? null
  return _accountName
}
