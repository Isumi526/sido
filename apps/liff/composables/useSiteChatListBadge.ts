// ============================================================
//  useSiteChatListBadge.ts — チャット一覧(/chats)ナビの未読件数バッジ
//  site_chat_messages には既読管理カラムが無いため、site_chat_last_read
//  (account_id, site_id, actor_key=workers.id) の最終既読時刻より新しい
//  メッセージ件数を「未読」として数える（未既読レコードなら全件未読扱い）。
//  useSiteChatMentionBadge.ts と同じ「モジュールスコープの共有ref」パターン。
//  ※ accountId/workerId は呼び出し元が既に解決済みの値を渡す（useSiteChatMentionBadge.ts
//    と同じ理由＝深いasync文脈からuseAccount()等を新規に呼ぶと壊れるため）。
// ============================================================
import { ref } from 'vue'

export const unreadChatCount = ref(0)

export async function refreshSiteChatListBadge(): Promise<void> {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolveMyWorkerId } = useSchedules()

  const accountId = await getAccountId()
  if (!accountId) { unreadChatCount.value = 0; return }
  const workerId = await resolveMyWorkerId()
  if (!workerId) { unreadChatCount.value = 0; return }

  const { data: sites } = await supabase.from('sites').select('id').eq('account_id', accountId).eq('active', true)
  const siteIds = ((sites ?? []) as { id: string }[]).map((s) => s.id)
  if (!siteIds.length) { unreadChatCount.value = 0; return }

  const { data: lastReads } = await supabase.from('site_chat_last_read')
    .select('site_id, last_read_at').eq('account_id', accountId).eq('actor_key', workerId)
  const lastReadBySite: Record<string, string> = {}
  for (const r of (lastReads ?? []) as { site_id: string; last_read_at: string }[]) lastReadBySite[r.site_id] = r.last_read_at

  const { data: msgs } = await supabase.from('site_chat_messages')
    .select('site_id, created_at').eq('account_id', accountId).is('deleted_at', null)
    .in('site_id', siteIds).order('created_at', { ascending: false }).limit(1000)

  let unread = 0
  for (const m of (msgs ?? []) as { site_id: string; created_at: string }[]) {
    const lastRead = lastReadBySite[m.site_id]
    if (!lastRead || m.created_at > lastRead) unread++
  }
  unreadChatCount.value = unread
}

// チャット詳細(site-chat/[id].vue)を開いた時に既読化する。
// accountId/workerIdは呼び出し元(ページのload())が既に解決済みの値をそのまま渡す
// （refreshSiteChatListBadge()を再利用せず直接再取得するのも同じ理由＝深いasync文脈から
//   useAccount()/useSchedules()を新規に呼ぶと壊れるため。useSiteChatMentionBadge.tsと同型）。
export async function markSiteChatRead(accountId: string, workerId: string, siteId: string): Promise<void> {
  if (!accountId || !workerId || !siteId) return
  const supabase = useSupabase()
  await supabase.from('site_chat_last_read')
    .upsert({ account_id: accountId, site_id: siteId, actor_key: workerId, last_read_at: new Date().toISOString() }, { onConflict: 'account_id,site_id,actor_key' })

  const { data: sites } = await supabase.from('sites').select('id').eq('account_id', accountId).eq('active', true)
  const siteIds = ((sites ?? []) as { id: string }[]).map((s) => s.id)
  if (!siteIds.length) { unreadChatCount.value = 0; return }
  const { data: lastReads } = await supabase.from('site_chat_last_read')
    .select('site_id, last_read_at').eq('account_id', accountId).eq('actor_key', workerId)
  const lastReadBySite: Record<string, string> = {}
  for (const r of (lastReads ?? []) as { site_id: string; last_read_at: string }[]) lastReadBySite[r.site_id] = r.last_read_at

  const { data: msgs } = await supabase.from('site_chat_messages')
    .select('site_id, created_at').eq('account_id', accountId).is('deleted_at', null)
    .in('site_id', siteIds).order('created_at', { ascending: false }).limit(1000)

  let unread = 0
  for (const m of (msgs ?? []) as { site_id: string; created_at: string }[]) {
    const lastRead = lastReadBySite[m.site_id]
    if (!lastRead || m.created_at > lastRead) unread++
  }
  unreadChatCount.value = unread
}
