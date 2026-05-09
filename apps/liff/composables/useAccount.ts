// ============================================================
//  apps/liff / composables/useAccount.ts
//  アカウント（テナント）識別
//  NUXT_PUBLIC_ACCOUNT_SLUG で切り替え
//  local=test / Vercel=seed
// ============================================================

export const useAccount = () => {
  const config    = useRuntimeConfig()
  const slug      = (config.public as any).accountSlug as string || 'sample-construction'
  const accountId = useState<string | null>('account_id', () => null)

  async function getAccountId(): Promise<string | null> {
    if (accountId.value) return accountId.value
    const supabase = useSupabase()
    const { data } = await supabase
      .from('accounts')
      .select('id')
      .eq('slug', slug)
      .single()
    accountId.value = data?.id ?? null
    return accountId.value
  }

  return { getAccountId, slug }
}
