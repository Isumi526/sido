// ============================================================
//  useSiteChatMentionBadge.ts — 現場チャットの未読メンション通知バッジ（HOME/ハンバーガー共通）
//  useScheduleNotifBadge.ts と同じ「モジュールスコープの共有ref」パターン。
//  ※ accountId/workerId は呼び出し元が既に解決済みの値を渡す（この関数の内部で
//    useSchedules()/useAccount() を新規に呼ぶと、setup直下ではない深いasync文脈からの
//    呼び出し時に「Must be called at the top of a setup function」で壊れるため）。
// ============================================================
import { ref } from 'vue'

export const unreadMentionCount = ref(0)

export async function refreshSiteChatMentionBadge(): Promise<void> {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolveMyWorkerId } = useSchedules()

  const accountId = await getAccountId()
  if (!accountId) { unreadMentionCount.value = 0; return }
  const workerId = await resolveMyWorkerId()
  if (!workerId) { unreadMentionCount.value = 0; return }

  const { count } = await supabase.from('site_chat_mentions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('worker_id', workerId).is('read_at', null)
  unreadMentionCount.value = count ?? 0
}

// 現場のチャットを開いた時、その現場ぶんの自分あて未読メンションを既読化する。
// accountId/workerIdは呼び出し元(ページのload())が既に解決済みの値をそのまま渡す
// （refreshSiteChatMentionBadge()を再利用せず直接再取得するのも同じ理由＝深いasync文脈から
//   useSchedules()等を新規に呼ぶと壊れるため）。
export async function markSiteChatMentionsRead(accountId: string, workerId: string, siteId: string): Promise<void> {
  if (!accountId || !workerId) return
  const supabase = useSupabase()
  await supabase.from('site_chat_mentions')
    .update({ read_at: new Date().toISOString() })
    .eq('account_id', accountId).eq('worker_id', workerId).eq('site_id', siteId).is('read_at', null)
  const { count } = await supabase.from('site_chat_mentions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('worker_id', workerId).is('read_at', null)
  unreadMentionCount.value = count ?? 0
}
