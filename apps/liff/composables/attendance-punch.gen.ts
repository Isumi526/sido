// ⚠️ AUTO-GENERATED from shared/attendance-punch.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/attendance-punch.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/attendance-punch.ts
//  「実際に打刻した時刻（出退勤ログ）」を日報と突き合わせるための共有ロジック。
//
//  出所（2026-08-10 大塚さんとの電話・逐語）:
//   「実際打った打刻時間と、関係者が打った8時半6時っていうのと、本人たちが実際…
//     それが出てくればそれでいいじゃないの？」
//   「（出退勤の画面と日報の画面が）別じゃなくて一緒でいい」＝日報側で見る。
//
//  ★このズレは表示専用。人件費の計算には一切使わない。
//   同じ電話で「人件費は管理者が決めた時間ベースで今までと変わらず／作業員は時間を触れない」
//   「管理者が一番目に決めた時間がマスタ」と明言されている。実打刻を計算に流すと
//   給与の根拠が静かに入れ替わる。
//
//  ★admin と liff の両方から使う（admin: 日報一覧のズレチップ / liff: 日報入力・履歴）。
//   編集したら `npm run sync:shared` で *.gen.ts を再生成すること。
// ============================================================

const TZ = 'Asia/Tokyo'

/** ISO文字列 → JSTの YYYY-MM-DD（daily_reports.date と突き合わせる） */
export function jstDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
}

/** ISO文字列 → JSTの HH:MM */
export function jstTimeOf(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/**
 * JSTの日付範囲を UTC(Z) の ISO に直す。
 * ★フィルタ値に '+' を含めると URL 上でスペース解釈され timestamp パースエラーになるので
 *  必ず toISOString() を通す（admin 側で実際に踏んだ）。
 */
export function jstRangeToUtc(fromDate: string, toDate: string): { lo: string; hi: string } {
  return {
    lo: new Date(`${fromDate}T00:00:00+09:00`).toISOString(),
    hi: new Date(`${toDate}T23:59:59+09:00`).toISOString(),
  }
}

export type PunchLog = { worker_id: string; type: string; checked_at: string; siteName: string | null }
export type Punch = { checkin?: string; checkout?: string }

/**
 * 突き合わせキー。作業員×日付。
 * ★2026-08-27 の出退勤モデル変更で現場名を外した。打刻が現場に紐づかなくなり
 *  （1日＝最初の出勤・最後の退勤の2回）、現場ごとの実打刻は存在しなくなったため。
 *  日報が1日に複数現場を持つ場合、その日の実打刻（外枠）を各現場行に同じものとして出す。
 */
export function punchKey(workerId: string, date: string): string {
  return `${workerId}|${date}`
}

/**
 * 打刻ログを「作業員×日付」ごとに畳む。
 * ★出勤は最早・退勤は最遅を採る（昼に一度出て戻った日でも、その日の在場時間の外枠になる）。
 *  呼び出し側は checked_at の昇順で渡すこと。
 */
export function foldPunches(logs: PunchLog[]): Record<string, Punch> {
  const map: Record<string, Punch> = {}
  for (const log of logs) {
    const key = punchKey(log.worker_id, jstDateOf(log.checked_at))
    const entry = map[key] ?? (map[key] = {})
    const t = jstTimeOf(log.checked_at)
    if (log.type === 'checkin') { if (!entry.checkin) entry.checkin = t }
    else if (log.type === 'checkout') { entry.checkout = t }
  }
  return map
}

/** "HH:MM" → 分。読めなければ null */
export function toMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * 実打刻 − 作業時刻（分）。どちらか読めなければ null。
 * ★日跨ぎ補正: 深夜1時の退勤を「17時間早い」と読ませない（夜勤・残業で普通に起きる）。
 */
export function punchDiffMinutes(actual: string | null | undefined, planned: string | null | undefined): number | null {
  const a = toMinutes(actual), p = toMinutes(planned)
  if (a === null || p === null) return null
  let d = a - p
  if (d < -12 * 60) d += 24 * 60
  else if (d > 12 * 60) d -= 24 * 60
  return d
}

/** "+1時間5分" / "−28分" / "±0"。差が出せなければ空文字 */
export function punchDiffLabel(actual: string | null | undefined, planned: string | null | undefined): string {
  const d = punchDiffMinutes(actual, planned)
  if (d === null) return ''
  if (d === 0) return '±0'
  const sign = d > 0 ? '+' : '−'
  const abs = Math.abs(d)
  const h = Math.floor(abs / 60), mm = abs % 60
  return `${sign}${h ? `${h}時間` : ''}${mm || !h ? `${mm}分` : ''}`
}

/**
 * 表示するほどのズレか（15分以上）。
 * ★実運用ではほぼ全員が数分ズレる。数分のチップが全行に並ぶと、本当に見るべき
 *  「2時間半のズレ」がその中に埋もれる（2026-08-12 実データを見て運用者が判断）。
 *  「丸めて同じ」と見なせる範囲は黙る。
 */
export function isPunchDiffWorthShowing(actual: string | null | undefined, planned: string | null | undefined): boolean {
  const d = punchDiffMinutes(actual, planned)
  return d !== null && Math.abs(d) >= 15
}

/** 30分以上ズレているか（申請漏れに気づくための強調しきい値） */
export function isPunchDiffBig(actual: string | null | undefined, planned: string | null | undefined): boolean {
  const d = punchDiffMinutes(actual, planned)
  return d !== null && Math.abs(d) >= 30
}
