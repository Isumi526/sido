// ============================================================
//  utils/date-label.ts — 曜日つきの日付の表示（2026-10-02 II-2）
//  英語表示でも「9/30（水）」と日本語の曜日が出ていたのを、言語に合わせて出す。
//   日本語: 9/30（水）  ／  英語: Wed 9/30
//  ★computed の中で呼べば言語の切り替えに追従する（currentLocale がリアクティブな言語を読む）
// ============================================================
import { currentLocale } from '~/utils/i18n-global'

const WD_JA = ['日', '月', '火', '水', '木', '金', '土']
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 曜日の短い名前（水 / Wed） */
export function weekdayShort(d: Date): string {
  return (currentLocale() === 'en' ? WD_EN : WD_JA)[d.getDay()]
}

/** 'YYYY-MM-DD' か Date → 9/30（水） / Wed 9/30 */
export function mdWithWeekday(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00`) : date
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  return currentLocale() === 'en' ? `${weekdayShort(d)} ${md}` : `${md}（${weekdayShort(d)}）`
}

/** 年つき: 2026-09-30（水） / Wed 2026-09-30 */
export function ymdWithWeekday(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00`)
  return currentLocale() === 'en' ? `${weekdayShort(d)} ${ymd}` : `${ymd}（${weekdayShort(d)}）`
}

/** 月日（年なし）: 10月2日（金） / Fri Oct 2 */
export function longMdWithWeekday(d: Date): string {
  if (currentLocale() === 'en') {
    return `${weekdayShort(d)} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }
  return `${d.getMonth() + 1}月${d.getDate()}日（${weekdayShort(d)}）`
}
