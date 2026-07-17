// ============================================================
//  composables/useMySiteIds.ts
//  自分(=users.id)が閲覧できる現場idの一覧を返す。
//  現場情報一覧(sites/index.vue)・現場チャット一覧(chats/index.vue)・
//  現場チャット詳細(site-chat/[id].vue)の絞り込みで共通利用する単一ソース(Part B・2026-07-17)。
//  対象＝(1) site_shares で明示共有登録された現場 ＋ (2) 自分がresponsible_worker_id(現場責任者)
//  になっている現場（責任者は共有登録が無くても必ず見える・2026-07-17ユーザー指示）。
// ============================================================
export const useMySiteIds = () => {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolve } = useCurrentUser()

  async function resolve_(): Promise<string[]> {
    const accountId = await getAccountId()
    if (!accountId) return []
    const me = await resolve()
    if (!me?.id) return []

    const [{ data: shares }, { data: managed }] = await Promise.all([
      supabase.from('site_shares').select('site_id').eq('account_id', accountId).eq('user_id', me.id),
      me.worker_id
        ? supabase.from('sites').select('id').eq('account_id', accountId).eq('responsible_worker_id', me.worker_id)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ])

    const ids = new Set<string>()
    for (const r of (shares ?? []) as { site_id: string }[]) ids.add(r.site_id)
    for (const s of (managed ?? []) as { id: string }[]) ids.add(s.id)
    return [...ids]
  }

  return { resolveMySiteIds: resolve_ }
}
