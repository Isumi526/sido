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
import { computed, ref } from 'vue'

export const unreadNotifCount = ref(0)
export const unreadScheduleCount = ref(0)

// ★「やること」と「お知らせ」を分ける（2026-08-30 ユーザー指示）。
//  お知らせ = 読めば済むもの。開いた時点で消える。
//  やること = ユーザーに行動してもらうもの。行動されるまで消えない。
//  この2つを1つのリストに混ぜると、読み飛ばした瞬間に「やること」が消えて
//  誰も対応しないまま残る（＝送り出し資料が確認されない）。
//  ベルのバッジは合計を出す（気づく入口は1つでいい）。
export const totalBadgeCount = computed(() => unreadNotifCount.value + pendingDocCount.value)

/** お知らせ側の kind（読めば済むもの）。ここに無い kind は「やること」扱いにしない＝既存互換 */
export const INFO_KINDS = ['schedule', 'report_reject', 'overtime_decision', 'expense_reject', 'chat_mention'] as const

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
  // ★site_document は「やること」側で状態から数えるので、お知らせの未読には入れない
  //  （両方に出ると合計が二重になる）。
  const info = rows.filter((r: any) => (r.kind ?? 'schedule') !== 'site_document')
  unreadNotifCount.value = info.length
  unreadScheduleCount.value = rows.filter((r: any) => (r.kind ?? 'schedule') === 'schedule').length
}

// ── 未承認の送り出し資料（承認するまで消えない印）──
// ★お知らせ(schedule_notifications)は「読んだら消える」ので、読んで放置すると
//  気づけなくなる。承認という行為が済むまで残す必要があるものは、通知の既読ではなく
//  「まだ承認していない」という状態そのものを数える（2026-08-30 ユーザー指示）。
export const pendingDocCount = ref(0)
/** まだ承認していない資料が残っている現場の id（現場一覧に印を出す用） */
export const pendingDocSiteIds = ref<string[]>([])
/** 「やること」タブに出す明細 */
export type PendingDocItem = { attachmentId: string; name: string | null; siteId: string; siteName: string; createdAt: string }
export const pendingDocItems = ref<PendingDocItem[]>([])

export async function refreshPendingDocBadge(): Promise<void> {
  const supabase = useSupabase()
  const { profile, getIdToken } = useLiff()
  const config = useRuntimeConfig()
  const reset = () => { pendingDocCount.value = 0; pendingDocSiteIds.value = []; pendingDocItems.value = [] }
  try {
    const idToken = await getIdToken().catch(() => null)
    const devLineUserId = config.public.appEnv === 'development' ? (profile.value?.userId ?? '') : ''
    const { data, error } = await supabase.functions.invoke('site-document-consent', {
      body: {
        action: 'pending-count',
        ...(idToken ? { line_id_token: idToken } : {}),
        ...(devLineUserId ? { dev_line_user_id: devLineUserId } : {}),
      },
    })
    if (error || !data?.ok) return reset()
    pendingDocCount.value = Number(data.pending ?? 0)
    pendingDocSiteIds.value = (data.sites ?? []) as string[]
    pendingDocItems.value = (data.items ?? []) as PendingDocItem[]
  } catch (e) {
    console.error('[docBadge] 未承認資料の件数を取得できませんでした:', e)
    reset()
  }
}
