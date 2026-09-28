// ============================================================
//  shared/recurring-invoice.ts — 協力会社請求の「毎月定額」（ひな形→毎月自動登録）の日付の規則（2026-09-27）
//  正本はここ。`npm run sync:shared` で admin / EF に配布する（画面の「次回登録日」と EF の作成判定を必ず同じにする）。
//
//  出所（尾崎さん・SEED 2026-09-25/27）: 「毎月定額で請求となっているものを固定で登録したい」
//   →「ボタンを押さずに毎月自動で登録される仕様希望。金額や内容に変更がある場合のみ、登録後にその場で修正したい」
//
//  ★「その月を作ったか」はひな形の last_generated_period で持つ（請求の行では持たない）。
//   請求が来なかった月に自動登録の請求を削除しても、翌日に同じ月が作り直されないようにするため。
//   cron が止まっていた日があっても、その月の登録日を過ぎていれば次の実行で作られる（取りこぼさない）。
//  ★遡って複数月分は作らない。作るのは「今月分」だけ（数か月止まっていた時にまとめて未払いが湧かないように）。
// ============================================================

export type RecurringTemplateDates = {
  active: boolean
  /** 毎月何日付で登録するか（1〜31。その月に無い日は月末に寄せる） */
  day_of_month: number
  /** 最初に作る月 'YYYY-MM' */
  start_period: string
  /** 最後に作る月 'YYYY-MM'（null＝無期限） */
  end_period: string | null
  /** 最後に作った月 'YYYY-MM'（null＝まだ無い） */
  last_generated_period: string | null
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function periodOf(ymd: string): string {
  return ymd.slice(0, 7)
}

/** 'YYYY-MM' の n か月後（負で前） */
export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  const ny = Math.floor(idx / 12)
  const nm = idx - ny * 12 + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

/** その月の日数 */
function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** その月の登録日 'YYYY-MM-DD'（29〜31日でその月に無ければ月末） */
export function invoiceDateFor(period: string, dayOfMonth: number): string {
  const d = Math.min(Math.max(1, Math.floor(dayOfMonth)), daysInMonth(period))
  return `${period}-${String(d).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' に n 日足す */
export function addDays(ymd: string, n: number): string {
  const t = new Date(`${ymd}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/**
 * 今日（JST の 'YYYY-MM-DD'）時点で今月分を作るべきか。作るべきならその月と登録日を返す。
 * 作らない理由も返す（画面と E2E で「なぜ作られなかったか」を説明できるように）。
 */
export function dueToday(t: RecurringTemplateDates, todayYmd: string):
  | { due: true; period: string; invoiceDate: string }
  | { due: false; reason: 'inactive' | 'before_start' | 'ended' | 'already_generated' | 'before_day'; period: string; invoiceDate: string } {
  const period = periodOf(todayYmd)
  const invoiceDate = invoiceDateFor(period, t.day_of_month)
  if (!t.active) return { due: false, reason: 'inactive', period, invoiceDate }
  if (period < t.start_period) return { due: false, reason: 'before_start', period, invoiceDate }
  if (t.end_period && period > t.end_period) return { due: false, reason: 'ended', period, invoiceDate }
  if (t.last_generated_period && period <= t.last_generated_period) return { due: false, reason: 'already_generated', period, invoiceDate }
  if (todayYmd < invoiceDate) return { due: false, reason: 'before_day', period, invoiceDate }
  return { due: true, period, invoiceDate }
}

/**
 * 次に自動登録される日（画面の表示用）。止めている・終わっている時は null。
 * 今月分がまだで登録日前なら今月、それ以外は次の月以降で最初に作られる月。
 */
export function nextInvoiceDate(t: RecurringTemplateDates, todayYmd: string): string | null {
  if (!t.active) return null
  let period = periodOf(todayYmd)
  if (period < t.start_period) period = t.start_period
  if (t.last_generated_period && period <= t.last_generated_period) period = shiftPeriod(t.last_generated_period, 1)
  if (t.end_period && period > t.end_period) return null
  return invoiceDateFor(period, t.day_of_month)
}
