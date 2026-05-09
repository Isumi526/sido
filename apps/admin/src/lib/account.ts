// ============================================================
//  apps/admin / src/lib/account.ts
//  アカウント（テナント）識別
//  VITE_ACCOUNT_SLUG で切り替え: local=test / Vercel=seed
// ============================================================
import { supabase } from './supabase'

export const ACCOUNT_SLUG = import.meta.env.VITE_ACCOUNT_SLUG || 'sample-construction'

let _accountId: string | null = null

export async function getAccountId(): Promise<string> {
  if (_accountId) return _accountId
  const { data } = await supabase
    .from('accounts')
    .select('id')
    .eq('slug', ACCOUNT_SLUG)
    .single()
  _accountId = data?.id ?? ''
  return _accountId
}
