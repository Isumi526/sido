// ============================================================
//  shared/billing-trial.ts — 無償期間（トライアル）満了日の計算(純関数・単一ソース)
//  admin/liff/supabase functions で共用。sync:shared で各アプリへ .gen 生成。
//
//  ★無償期間の長さは「45日固定」ではない（2026-09-03 訂正）。
//   2026-08-30 時点の決定は45日固定だったが、2026-09-01 の弁護士打合せで
//   「契約成立月の翌月末日まで」（最短1か月強〜最長2か月）に上書きされている
//   （弁護士向け連絡事項 1-2）。例：9/1契約→10/31まで、9/28契約でも10/31まで。
// ============================================================

/**
 * 無償満了日＝契約成立日の月の「翌月末日」。
 * ★契約日が月末（例: 8/31）でも、翌々月に繰り上がらないよう年月だけで計算する
 *  （日付そのものに1ヶ月足すと 8/31 + 1ヶ月 = 存在しない日になるJS Dateの罠を避ける）。
 * @param contractStartedAt 'YYYY-MM-DD'（契約成立日）
 * @returns 'YYYY-MM-DD'（無償満了日）
 */
export function computeTrialEndsAt(contractStartedAt: string): string {
  const [y, m] = contractStartedAt.split('-').map(Number)
  // 翌月の「その次の月の0日目」＝翌月の末日。月は0始まりなので m(1始まり)+1 が翌月、
  // その次の月(m+2)の day=0 で翌月末日になる。
  const end = new Date(Date.UTC(y, m + 1, 0))
  const yyyy = end.getUTCFullYear()
  const mm = String(end.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(end.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** 満了日の何日前かを計算する（告知タイミング判定に使う。今日以降＝正の値） */
export function daysUntil(dateStr: string, todayStr: string): number {
  const a = new Date(`${dateStr}T00:00:00Z`).getTime()
  const b = new Date(`${todayStr}T00:00:00Z`).getTime()
  return Math.round((a - b) / 86400000)
}
