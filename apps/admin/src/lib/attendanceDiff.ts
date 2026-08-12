// ============================================================
//  lib/attendanceDiff.ts
//  「実際に打刻した時刻」と「人件費の根拠になっている作業時刻」のズレを出す。
//
//  出所（2026-08-10 大塚さんとの電話・逐語）:
//   「実際打った打刻時間と、関係者が打った8時半6時っていうのと、本人たちが実際…
//     それが出てくればそれでいいじゃないの？」
//   「（出退勤の画面と日報の画面が）別じゃなくて一緒でいい」＝日報一覧で見る。
//
//  ★比較の基準は「日報の作業時刻」。現場マスタの固定勤務時刻ではない。
//   理由: 人件費を動かしているのは日報の作業時刻の方だから。
//   「払っている時間 vs 実際に居た時間」を突き合わせるのが目的で、
//   マスタと比べると『日報が編集されてマスタと違う』ケースを取り逃す。
//
//  ★このズレは表示専用。人件費の計算には一切使わない。
//   同じ電話で「人件費は管理者が決めた時間ベースで今までと変わらず／作業員は時間を触れない」
//   と明言されており、実打刻を計算に流すと給与の根拠が静かに入れ替わる。
// ============================================================

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
