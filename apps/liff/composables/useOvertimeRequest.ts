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

  /**
   * 取消できるか（2026-09-20 設計 A-1・確認事項1=A）: 当日の通常申請は締切（16:00）まで。
   * 締切後に取り消すと再申請できず詰むので、取消も締切で閉じる（EF でも同じ判定）。
   * 締切後の実績修正(late)は出し直せるので可。当日以外（過去日の late・前日から残った pending）も可。
   */
  function canCancel(date: string | null | undefined, isLate = false): boolean {
    if (!date) return false
    if (isLate) return true
    if (date !== todayStr()) return true
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

  /**
   * 申請中/承認済みの中身（フォームに入れ直す用）。無ければ null。
   * 2026-09-13 辻さん: 2現場ある日に先に1現場で出すと2現場目が出せなかった → 締切前の変更・追加のため。
   */
  async function activeRequest(
    _workerId: string | null | undefined, date: string,
  ): Promise<{ startTime: string | null; endTime: string | null; breakMinutes: number | null; reason: string; siteNames: string[] } | null> {
    if (!date) return null
    try {
      return (await call('overtime-status', { date })).request ?? null
    } catch (e) {
      console.error('[overtime] 申請内容を取得できませんでした:', e)
      return null
    }
  }

  /**
   * 日報画面が要る残業の状態を1回で取る（A-1・2026-09-24）。
   *  isApproved / approvedAdjustment / activeRequest を別々に呼ぶと同じ EF を毎回叩くので、
   *  日報画面はこれを使う。★読めない時は none（=上限を外さない）に倒す＝fail-closed。
   */
  async function snapshot(date: string): Promise<{
    status: 'none' | 'pending' | 'approved' | 'rejected'
    isLate: boolean
    adjustment: { startTime: string | null; endTime: string | null; breakMinutes: number | null } | null
    reportedEndTime: string | null
  }> {
    const empty = { status: 'none' as const, isLate: false, adjustment: null, reportedEndTime: null }
    if (!date) return empty
    try {
      const j = await call('overtime-status', { date })
      return {
        status: j.status ?? 'none',
        isLate: !!j.isLate,
        adjustment: j.adjustment ?? null,
        reportedEndTime: j.request?.reportedEndTime ?? null,
      }
    } catch (e) {
      console.error('[overtime] 状況を取得できませんでした:', e)
      return empty
    }
  }

  /**
   * 承認待ちの間に日報で入力された終了時刻を申請へ記録する（A-1・2026-09-24）。
   *  日報には定時までしか保存しないので、定時を超えた入力はここに置き、承認時にこの時刻で日報が書き換わる。
   *  endTime=null は「定時内に戻した」＝記録を消す。
   * ★失敗を握りつぶさない。呼び出し側はこれが失敗したら**日報の提出を止める**
   *  （記録できないまま定時で保存すると、入力した残業がどこにも残らない＝今回直したい取りこぼしそのもの）。
   */
  async function reportEndTime(date: string, endTime: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await call('overtime-report-end', { date, endTime })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // 却下された時の管理者コメント（「理由を教えて」等）。却下以外は null。
  async function decisionNote(_workerId: string | null | undefined, date: string): Promise<string | null> {
    if (!date) return null
    try {
      return (await call('overtime-status', { date })).decisionNote ?? null
    } catch (e) {
      console.error('[overtime] コメントを取得できませんでした:', e)
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
      useUsageLog().logFeatureUsage('overtime_requested')   // 効果測定（ベストエフォート）
      return { ok: true }
    } catch (e: any) {
      const m = String(e?.message ?? 'failed')
      // ★既に申請済み＝成功を装わない（以前は EF が deduped:true で ok を返し、画面が「申請しました」と出していた）
      if (m.includes('already_requested')) return { ok: false, error: 'already-requested' }
      return { ok: false, error: m }
    }
  }

  /**
   * 締切後の「実績修正の申請」(late)。16:00締切は通常申請(requestOvertime)に残したまま、
   * 締切を過ぎた後で実際の残業実績を申告して修正する導線。必ず承認が要る。
   * 既存の有効申請があればEFがその行を上書き（再承認のため pending に戻す）、無ければ late 新規。
   * ★canRequest の締切ガードは通さない（この関数は締切後に使う）。理由は必須。
   * ★worker_id は渡さない。EF が検証済みの身元から決める。
   */
  async function requestLateCorrection(
    _workerId: string | null | undefined, date: string, requestedEndTime: string | null, reason: string,
    siteNames: string[] = [],
    requestedStartTime: string | null = null,
    requestedBreakMinutes: number | null = null,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!date) return { ok: false, error: 'no-worker-or-date' }
    if (!reason || !reason.trim()) return { ok: false, error: 'reason-required' }
    try {
      await call('overtime-late-request', {
        date, requestedEndTime, requestedStartTime,
        ...(requestedBreakMinutes === null ? {} : { requestedBreakMinutes }),
        reason, siteNames,
      })
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  /**
   * 締切前の申請内容の変更・追加。有効申請(pending/approved)があればEFが上書きして
   * 再承認のため pending に戻す。無ければ新規。締切は EF でも検証する。
   * ★worker_id は渡さない。EF が検証済みの身元から決める。
   */
  async function updateRequest(
    _workerId: string | null | undefined, date: string, requestedEndTime: string | null, reason: string,
    siteNames: string[] = [],
    requestedStartTime: string | null = null,
    requestedBreakMinutes: number | null = null,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!date) return { ok: false, error: 'no-worker-or-date' }
    if (!canRequest(date)) return { ok: false, error: 'deadline-passed' }
    try {
      await call('overtime-update', {
        date, requestedEndTime, requestedStartTime,
        ...(requestedBreakMinutes === null ? {} : { requestedBreakMinutes }),
        reason, siteNames,
      })
      return { ok: true }
    } catch (e: any) {
      const m = String(e?.message ?? 'failed')
      return { ok: false, error: m.includes('deadline_passed') ? 'deadline-passed' : m }
    }
  }

  // 誤った申請の取り消し（pending のみ削除＝承認済みは消さない）。締切後の当日通常申請は EF が deadline_passed で弾く。
  async function cancelRequest(_workerId: string | null | undefined, date: string, isLate = false): Promise<{ ok: boolean; error?: string }> {
    if (!date) return { ok: false, error: 'no-worker-or-date' }
    if (!canCancel(date, isLate)) return { ok: false, error: 'deadline-passed' }
    try {
      await call('overtime-cancel', { date })
      return { ok: true }
    } catch (e: any) {
      const m = String(e?.message ?? 'failed')
      return { ok: false, error: m.includes('deadline_passed') ? 'deadline-passed' : m.includes('not_found') ? 'not-found' : m }
    }
  }

  /** 当日の申請の取消可否（EF の判定。status が pending でなければ false） */
  async function canCancelToday(_workerId: string | null | undefined, date: string): Promise<boolean> {
    if (!date) return false
    try { return (await call('overtime-status', { date })).canCancel === true } catch { return false }
  }

  return { canRequest, canCancel, canCancelToday, status, isApproved, approvedAdjustment, activeRequest, decisionNote, snapshot, reportEndTime, myRecent, requestOvertime, requestLateCorrection, updateRequest, cancelRequest }
}
