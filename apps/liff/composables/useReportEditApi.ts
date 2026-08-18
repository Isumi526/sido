// ============================================================
//  useReportEditApi — 日報の申請まわり（report-edit-log EF）の薄いラッパ
//
//  ★なぜ切り出したか（2026-08-18）:
//   「承認待ちの日」を取る処理が report.vue と history.vue に別々に書かれていて、
//   未送信日スキャン（useExpense.getNextUnsubmittedDateById）からは呼べなかった。
//   その結果、スキャンは承認待ちを知らないまま「まだ出していない日」と判定し、
//   **提出しても同じ日が出続ける**状態になっていた。
//   （2026-08-18 大塚さん「なんか、15日が一生でてくる」— 8/15を提出済みだが承認待ちで、
//     daily_reports に行が無いためスキャンが毎回8/15を返していた）
//
//  ★身元はEF側で検証される。ここで名乗らない。
//   EF は report_user_id = caller.userId で絞るので、他人の申請は返らない。
// ============================================================
const EDGE_FN = 'report-edit-log'

export function useReportEditApi() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function call(payload: Record<string, unknown>): Promise<any | null> {
    const efUrl = config.public.edgeFunctionUrl
    if (!efUrl) return null
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    // 開発モードは LINE ID token が発行されない。EF 側はローカル接続時しか受け付けない
    const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
    try {
      const res = await fetch(`${efUrl}/${EDGE_FN}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) return null
      return json
    } catch { return null }
  }

  /**
   * 承認待ちの日付（YYYY-MM-DD）。取れなければ空配列。
   * ★空に倒すのは安全側。ここで落ちても「承認待ちを飛ばせない」だけで、
   *  未送信日が消えるより害が小さい。
   */
  async function pendingDates(): Promise<string[]> {
    const j = await call({ action: 'pending-dates' })
    return ((j?.dates ?? []) as any[]).map(d => String(d?.date ?? d)).filter(Boolean)
  }

  return { pendingDates }
}
