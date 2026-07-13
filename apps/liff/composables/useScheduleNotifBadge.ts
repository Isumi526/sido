// ============================================================
//  useScheduleNotifBadge.ts — 予定追加の未読通知バッジ（HOME/ハンバーガー共通）
//  admin側 lib/navBadges.ts と同じ「モジュールスコープの共有ref」パターン。
//  useSchedules()はコンポーネント呼び出しごとに独立したrefを持つ(共有されない)ため、
//  バッジ表示専用にモジュール単位で1つだけ状態を持つ。
//  ★ワーカーID解決は useSchedules() ではなく useCurrentUser() を使う。
//   useSchedules() は内部で useI18n() を呼んでおり、vue-i18n は「setup()の中で
//   同期的に呼ばれること」を要求する。テンプレートの@click/watch等コンポーネント
//   instance文脈を保持しないタイミングで(2回目以降)呼ぶと
//   "Must be called at the top of a `setup` function" でサイレントに失敗し、
//   ハンバーガーを開き直してもバッジが更新されない不具合になっていた(2026-07-13・
//   実機テストで発覚)。useCurrentUser()はi18nに依存しないためこの制約を受けない。
// ============================================================
import { ref } from 'vue'

export const unreadScheduleCount = ref(0)

export async function refreshScheduleNotifBadge(): Promise<void> {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolve } = useCurrentUser()

  const accountId = await getAccountId()
  if (!accountId) { unreadScheduleCount.value = 0; return }
  const user = await resolve()
  const workerId = user?.worker_id ?? null
  if (!workerId) { unreadScheduleCount.value = 0; return }

  const { count } = await supabase.from('schedule_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('worker_id', workerId).is('read_at', null)
  unreadScheduleCount.value = count ?? 0
}
