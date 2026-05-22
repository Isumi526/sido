// ============================================================
//  _shared/resolveGroupId.ts
//  accountSlug から settings.notify_group_id を引く
//  設定なしの場合は fallback を返す
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

export async function resolveGroupIds(
  accountSlug: string | null | undefined,
  fallback: string[],
): Promise<string[]> {
  if (!accountSlug) return fallback

  const { data: account } = await supabase
    .from('accounts').select('id').eq('slug', accountSlug).maybeSingle()
  if (!account) return fallback

  const { data: setting } = await supabase
    .from('settings').select('value')
    .eq('account_id', account.id).eq('key', 'notify_group_id').maybeSingle()

  return setting?.value ? [setting.value] : fallback
}
