// ============================================================
//  apps/liff / composables/useSupabase.ts
//  Supabase クライアントのシングルトン
// ============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export const useSupabase = (): SupabaseClient => {
  if (_client) return _client

  const config = useRuntimeConfig()
  const url = config.public.supabaseUrl as string
  const key = config.public.supabaseAnonKey as string

  if (!url || !key) {
    throw new Error(`Supabase env vars not set (URL=${url ? 'ok' : 'missing'}, KEY=${key ? 'ok' : 'missing'})`)
  }

  _client = createClient(url, key)
  return _client
}
