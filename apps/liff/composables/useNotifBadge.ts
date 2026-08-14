// ============================================================
//  useNotifBadge.ts — アプリ内通知（お知らせ）の未読バッジ
//  admin側 lib/navBadges.ts と同じ「モジュールスコープの共有ref」パターン。
//  useSchedules()はコンポーネント呼び出しごとに独立したrefを持つ(共有されない)ため、
//  バッジ表示専用にモジュール単位で1つだけ状態を持つ。
//
//  ★2つ数える理由（1つにまとめない）:
//   unreadNotifCount   … 全種別の未読 ＝ ヘッダーのベル／お知らせ一覧／ホーム
//   unreadScheduleCount… 予定通知(kind='schedule')だけの未読 ＝ 予定管理の導線
//   予定管理のバッジに日報の差し戻しまで混ぜると「予定を見に行っても何も無い」
//   になる。バッジは押した先に用があることを約束するものなので、種別で分ける。
//   取得は1クエリ。未読行の kind だけ引いて手元で数える（未読は多くて数十件）。
//
//  ★ワーカーID解決は useSchedules() ではなく useCurrentUser() を使う。
//   useSchedules() は内部で useI18n() を呼んでおり、vue-i18n は「setup()の中で
//   同期的に呼ばれること」を要求する。テンプレートの@click/watch等コンポーネント
//   instance文脈を保持しないタイミングで(2回目以降)呼ぶと
//   "Must be called at the top of a `setup` function" でサイレントに失敗し、
//   ハンバーガーを開き直してもバッジが更新されない不具合になっていた(2026-07-13・
//   実機テストで発覚)。useCurrentUser()はi18nに依存しないためこの制約を受けない。
//   ★このファイルの中から useI18n() を呼ぶ関数を新たに足さないこと。
// ============================================================
import { ref } from 'vue'

export const unreadNotifCount = ref(0)
export const unreadScheduleCount = ref(0)

export async function refreshNotifBadge(): Promise<void> {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolve } = useCurrentUser()

  const reset = () => { unreadNotifCount.value = 0; unreadScheduleCount.value = 0 }

  const accountId = await getAccountId()
  if (!accountId) return reset()
  // ★代理入力中でも「自分宛」のまま。通知は宛先が本人であることが意味なので、
  //   代理先の未読を自分のバッジに出すと誰の用事か分からなくなる。
  const user = await resolve()
  const workerId = user?.worker_id ?? null
  if (!workerId) return reset()

  const { data } = await supabase.from('schedule_notifications')
    .select('kind')
    .eq('account_id', accountId).eq('worker_id', workerId).is('read_at', null)

  const rows = data ?? []
  unreadNotifCount.value = rows.length
  unreadScheduleCount.value = rows.filter((r: any) => (r.kind ?? 'schedule') === 'schedule').length
}
