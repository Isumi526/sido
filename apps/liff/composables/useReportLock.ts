// ============================================================
//  useReportLock — 日報・経費の「過去3日ロック」の判定
//  - ロック窓: 対象日付が「当日含む過去3日」より前（=3日以上前）ならロック対象。
//    （当日／前日／前々日は編集可。4日前以降は期限切れ扱い）
//    ※境界はルールブック「当日含む直近3日」に合わせる。LOCK_AFTER_DAYS で一元管理。
//  - 適用開始日: LOCK_START_DATE（この日付以降の日報のみロック対象）。それより前（=移行前の
//    過去日報）は常に編集自由。運用開始日にロックを遡及させないためのグランドファザリング。
//  - ロックは UX/運用ガード（クライアント判定）でありセキュリティ境界ではない。
//
//  ★「解錠の許可申請」は廃止済み（2026-08-03）。
//   過去日もそのまま編集でき、理由必須＋内容の承認待ちになる二段構えに置き換わった
//   （daily_report_pending_edits）。それに伴い、この composable が持っていた
//   report_edit_grants への読み書き（grantStatus / isLocked / approvedDates /
//   grantsByDate / requestGrant / cancelRequest）は呼び出し元を失い、
//   テンプレートから一度も参照されない死にコードになっていた。
//   2026-08-15 に削除。★公開キー(anon)で全テナントの申請履歴が読めていた穴を
//   閉じるにあたり、生きていない経路を残したまま権限だけ剥がすと
//   「動かないコードが残る」ので、コードごと落とす。
//   管理画面（承認履歴の閲覧）は authenticated で従来どおり動く。
// ============================================================
import { todayStr } from '~/composables/schedule-core.gen'

export const LOCK_AFTER_DAYS = 3

// この日付（YYYY-MM-DD）以降の日報のみロック対象。これより前は常に編集可（移行前データを遡及ロックしない）。
export const LOCK_START_DATE = '2026-07-01'

function diffDaysFromToday(date: string): number {
  const d = new Date(date + 'T00:00:00').getTime()
  const today = new Date(todayStr() + 'T00:00:00').getTime()
  return Math.floor((today - d) / 86400000)
}

export function useReportLock() {
  /**
   * 対象日付がロック窓（3日以上前）か。
   * LOCK_START_DATE より前の日付はロック対象外（移行前の過去日報は遡及ロックしない）。
   * ★DBを見ない純粋判定。日報画面が「期限切れの提出」として扱うかの分岐に使う。
   */
  function isPastLockWindow(date: string | null | undefined): boolean {
    if (!date) return false
    if (date < LOCK_START_DATE) return false
    return diffDaysFromToday(date) >= LOCK_AFTER_DAYS
  }

  return { isPastLockWindow }
}
