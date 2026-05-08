// ============================================================
//  apps/liff / composables/useSupabase.ts
//  Supabase クライアントのシングルトン
// ============================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const useSupabase = (): SupabaseClient => {
  const config = useRuntimeConfig()
  const client = useState<SupabaseClient | null>('supabase', () => null)

  if (!client.value) {
    client.value = createClient(
      config.public.supabaseUrl as string,
      config.public.supabaseAnonKey as string,
    )
  }

  return client.value!
}
