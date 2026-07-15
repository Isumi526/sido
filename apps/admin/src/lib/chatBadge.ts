// ============================================================
//  chatBadge.ts — チャット一覧ナビの未読件数バッジ共有ストア
//  site_chat_messages には既読管理カラムが無いため、site_chat_last_read
//  (account_id, site_id, actor_key=admin authユーザーid) の最終既読時刻より
//  新しいメッセージ件数を「未読」として数える（未既読レコードなら全件未読扱い）。
//  navBadges.ts と同じ「module-scoped ref + refresh関数」パターン。
// ============================================================
import { ref } from 'vue'
import { supabase } from './supabase'
import { getAccountId } from './account'
import { currentUser } from './auth'

export const unreadChatCount = ref(0)

export async function refreshChatBadge() {
  const accountId = await getAccountId()
  const actorKey = currentUser.value?.id
  if (!accountId || !actorKey) { unreadChatCount.value = 0; return }

  const [{ data: sites }, { data: lastReads }] = await Promise.all([
    supabase.from('sites').select('id').eq('account_id', accountId).eq('active', true),
    supabase.from('site_chat_last_read').select('site_id, last_read_at').eq('account_id', accountId).eq('actor_key', actorKey),
  ])
  const siteIds = ((sites ?? []) as { id: string }[]).map((s) => s.id)
  if (!siteIds.length) { unreadChatCount.value = 0; return }
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

// チャット詳細を開いた時に既読化（site-chat-detail.vue から呼ぶ）
export async function markSiteChatRead(siteId: string) {
  const accountId = await getAccountId()
  const actorKey = currentUser.value?.id
  if (!accountId || !actorKey || !siteId) return
  await supabase.from('site_chat_last_read')
    .upsert({ account_id: accountId, site_id: siteId, actor_key: actorKey, last_read_at: new Date().toISOString() }, { onConflict: 'account_id,site_id,actor_key' })
  await refreshChatBadge()
}
