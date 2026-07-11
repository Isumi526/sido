// ============================================================
//  useScheduleNotifBadge.ts — 予定追加の未読通知バッジ（HOME/ハンバーガー共通）
//  admin側 lib/navBadges.ts と同じ「モジュールスコープの共有ref」パターン。
//  useSchedules()はコンポーネント呼び出しごとに独立したrefを持つ(共有されない)ため、
//  バッジ表示専用にモジュール単位で1つだけ状態を持つ。
// ============================================================
import { ref } from 'vue'

export const unreadScheduleCount = ref(0)

export async function refreshScheduleNotifBadge(): Promise<void> {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolveMyWorkerId } = useSchedules()

  const accountId = await getAccountId()
  if (!accountId) { unreadScheduleCount.value = 0; return }
  const workerId = await resolveMyWorkerId()
  if (!workerId) { unreadScheduleCount.value = 0; return }

  const { count } = await supabase.from('schedule_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('worker_id', workerId).is('read_at', null)
  unreadScheduleCount.value = count ?? 0
}
