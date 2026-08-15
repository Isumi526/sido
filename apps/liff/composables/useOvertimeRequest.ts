// ============================================================
//  useOvertimeRequest — 残業申請（架空残業対策）
//  - 当日16:00までに「固定終了を超える終了時刻」で残業を申請。管理者が admin で承認。
//    承認された worker×date のみ 日報の終了時刻を固定終了超で入力できる（report.vue が参照）。
//  - 早朝入り・実際に取った休憩も同じ申請に乗る（2026-08-10 大塚さん）。
//  - 締切は当日16:00固定（全現場一律・曜日/祝日例外なし・#80bd で15:00→16:00に変更）。
//  - 金額/集計には触れない（保存済み時刻から workerHours が従来どおり料率算出）。
//
//  ★2026-08-15: テーブル直叩きをやめて Edge Function 経由にした。
//   overtime_requests は公開キー(anon)だけで全テナント分が読め、
//   任意の worker_id で申請を作れる状態だった（誰がいつ残業を申請したかが漏れ、
//   他人名義の申請も作れた）。anon には身元が無いのでRLSでは絞れない。
//   ★ここに supabase.from('overtime_requests') を書き足さないこと。
//    1箇所でも直叩きが残ると anon の権限を落とせず、穴が塞がらない。
// ============================================================
// todayStr は shared/schedule-core.ts の JSTローカル基準版を使う（UTC基準の
// toISOString().split('T')[0] は深夜0-9時JSTに前日を返し、申請可否判定がズレる）。
import { todayStr } from '~/composables/schedule-core.gen'

export const OVERTIME_DEADLINE_HOUR = 16  // 当日この時刻まで申請可（16:00・#80bd で15:00→16:00）

const EDGE_FN = 'attendance-log'

export function useOvertimeRequest() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    const res = await fetch(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `失敗しました(${res.status})`)
    return json
  }

  // 申請可能か: 対象日付が「今日」かつ 現在時刻が締切より前。
  function canRequest(date: string | null | undefined): boolean {
    if (!date) return false
    if (date !== todayStr()) return false
    return new Date().getHours() < OVERTIME_DEADLINE_HOUR
  }

  // worker×date の残業申請ステータス（none/pending/approved/rejected・最新1件）。
  async function status(_workerId: string | null | undefined, date: string): Promise<'none' | 'pending' | 'approved' | 'rejected'> {
    if (!date) return 'none'
    try {
      return (await call('overtime-status', { date })).status ?? 'none'
    } catch (e) {
      // ★黙って 'approved' に倒さない。読めない時は「承認されていない」側に倒す＝
      //  架空残業の入力を許さない方向（fail-closed）。
      console.error('[overtime] 状況を取得できませんでした:', e)
      return 'none'
    }
  }

  // 残業が承認済みか（report.vue の終了時刻上限解放に使う）。
  async function isApproved(workerId: string | null | undefined, date: string): Promise<boolean> {
    return (await status(workerId, date)) === 'approved'
  }

  /**
   * 承認済みの申請内容（その日だけ日報の入力制限を緩める材料）。
   *  - startTime    … 早朝入り。現場の固定開始より前を選べるようになる
   *  - endTime      … 従来の残業（固定終了より後を選べる）
   *  - breakMinutes … 実際に取った休憩。0 なら休憩なしで通した
   * ★承認されていない申請は返さない（EF側でも status='approved' に絞っている）。
   */
  async function approvedAdjustment(
    _workerId: string | null | undefined, date: string,
  ): Promise<{ startTime: string | null; endTime: string | null; breakMinutes: number | null } | null> {
    if (!date) return null
    try {
      return (await call('overtime-status', { date })).adjustment ?? null
    } catch (e) {
      console.error('[overtime] 承認内容を取得できませんでした:', e)
      return null
    }
  }

  // 直近の自分の申請一覧（履歴表示用・新しい順）。
  async function myRecent(_workerId: string | null | undefined, limit = 20): Promise<any[]> {
    try {
      return (await call('overtime-recent', { limit })).items ?? []
    } catch (e) {
      console.error('[overtime] 履歴を取得できませんでした:', e)
      return []
    }
  }

  /**
   * 残業を申請（pending を作成）。締切前・既に pending/approved があれば二重作成しない。
   * ★worker_id は渡さない。EF が検証済みの身元から決める（他人名義の申請を作れない）。
   */
  async function requestOvertime(
    _workerId: string | null | undefined, date: string, requestedEndTime: string | null, reason: string,
    siteNames: string[] = [],
    requestedStartTime: string | null = null,
    requestedBreakMinutes: number | null = null,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!date) return { ok: false, error: 'no-worker-or-date' }
    if (!canRequest(date)) return { ok: false, error: 'deadline-passed' }
    try {
      await call('overtime-request', {
        date, requestedEndTime, requestedStartTime,
        ...(requestedBreakMinutes === null ? {} : { requestedBreakMinutes }),
        reason, siteNames,
      })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  // 誤った申請の取り消し（pending のみ削除＝承認済みは消さない）。
  async function cancelRequest(_workerId: string | null | undefined, date: string): Promise<{ ok: boolean; error?: string }> {
    if (!date) return { ok: false, error: 'no-worker-or-date' }
    try {
      await call('overtime-cancel', { date })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  return { canRequest, status, isApproved, approvedAdjustment, myRecent, requestOvertime, cancelRequest }
}
