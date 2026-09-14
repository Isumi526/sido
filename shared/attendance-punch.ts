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
/**
 * その日の実打刻。checkin/checkout は「その日の外枠」（最初の出勤・最後の退勤）。
 * shifts はその日の出退勤の「回」を出勤順に並べたもの（昼勤＋夜勤なら2つ）。
 * ★行に出す時は punchForRow() で「その行の作業時刻に近い回」を選ぶ。外枠をそのまま出すと、
 *  昼勤行にも夜勤行にも 09:30〜14:13 が並び「出勤 −10時間30分」のような嘘のズレが出る
 *  （2026-09-11 辻さん・9/9 昼勤09:30-14:00＋夜勤20:00-翌4:30 の実障害）。
 */
export type Punch = { checkin?: string; checkout?: string; shifts?: Punch[] }

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
 * 打刻ログを出退勤の「回」に組み、「作業員×日付」ごとに畳む。
 *  - 出勤が来たら新しい回を開く。退勤は、その作業員の開いている直前の回を閉じる。
 *  - 回が属する日＝出勤した日（JST）。★日跨ぎの退勤（翌4:31）は出勤した日の回に入る。
 *    退勤の日付で畳むと、夜勤の退勤が翌日に付き、その日の外枠が昼勤の退勤(14:13)で止まる。
 *  - 開いている回が無いのに退勤が来たら（前日の出勤が取得範囲の外など）退勤だけの回にする。
 *  - checkin/checkout（外枠）は 最初の回の出勤・最後の退勤。1回だけの日は従来と同じ値になる。
 *  呼び出し側は checked_at の昇順で渡すこと。
 *  ★日跨ぎの退勤を拾うため、取得範囲は表示したい期間より前後1日ずつ広げて渡すこと
 *   （usePunches.loadRange / admin reports.vue 参照）。
 */
export function foldPunches(logs: PunchLog[]): Record<string, Punch> {
  const map: Record<string, Punch> = {}
  // 作業員ごとの「開いている回」
  const open = new Map<string, Punch>()
  for (const log of logs) {
    const t = jstTimeOf(log.checked_at)
    if (log.type === 'checkin') {
      const key = punchKey(log.worker_id, jstDateOf(log.checked_at))
      const day = map[key] ?? (map[key] = { shifts: [] })
      const shift: Punch = { checkin: t }
      day.shifts!.push(shift)
      open.set(log.worker_id, shift)
    } else if (log.type === 'checkout') {
      const cur = open.get(log.worker_id)
      if (cur && !cur.checkout) {
        cur.checkout = t
      } else {
        // 対になる出勤が無い退勤。その日の回として残す（無いものを隠さない）
        const key = punchKey(log.worker_id, jstDateOf(log.checked_at))
        const day = map[key] ?? (map[key] = { shifts: [] })
        day.shifts!.push({ checkout: t })
      }
      open.delete(log.worker_id)
    }
  }
  for (const day of Object.values(map)) Object.assign(day, frameOf(day.shifts ?? []))
  return map
}

/** 複数の回の外枠（最初の出勤・最後の退勤）。片方も無ければその側は undefined */
function frameOf(shifts: Punch[]): Punch {
  const out: Punch = {}
  for (const sh of shifts) {
    if (sh.checkin && !out.checkin) out.checkin = sh.checkin
    if (sh.checkout) out.checkout = sh.checkout
  }
  return out
}

/**
 * 日報の1行（作業時刻 plannedStart〜plannedEnd）に出す実打刻を選ぶ。
 *  - その日の回が1つ以下、または作業時刻が無い … 外枠をそのまま（従来どおり）
 *  - 2回以上 … 作業時刻の前後2時間の窓に「出勤」が入る回だけを集めて、その外枠を出す
 *    （昼に一度出て戻った日＝両方の回が窓に入るので外枠のまま。昼勤＋夜勤＝それぞれ自分の回だけ）
 *  - 窓に1つも入らなければ外枠（無いものを隠さない）
 */
export function punchForRow(
  day: Punch | null | undefined,
  plannedStart: string | null | undefined,
  plannedEnd: string | null | undefined,
): Punch | null {
  if (!day) return null
  const shifts = day.shifts ?? []
  if (shifts.length < 2) return { checkin: day.checkin, checkout: day.checkout }
  const ps = toMinutes(plannedStart)
  if (ps === null) return { checkin: day.checkin, checkout: day.checkout }
  const pe = toMinutes(plannedEnd)
  // 作業時間の長さ（分）。終了が無い/読めない時は8時間とみなす。日跨ぎは +24h で正に直す
  let dur = pe === null ? 8 * 60 : pe - ps
  if (dur <= 0) dur += 24 * 60
  const MARGIN = 2 * 60
  const picked = shifts.filter((sh) => {
    const d = punchDiffMinutes(sh.checkin ?? sh.checkout, plannedStart)
    return d !== null && d >= -MARGIN && d <= dur + MARGIN
  })
  if (!picked.length) return { checkin: day.checkin, checkout: day.checkout }
  return frameOf(picked)
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

/**
 * 直近ログの取得窓（時間）。「出勤中か」を判定するために遡る長さ。
 *  ★2026-09-14 夜のみ現場（20:30〜翌6:00）対応: 20時間固定だと、夕方に出勤した回を翌日の
 *   夕方（20時間超）に開くと出勤が窓から落ち、退勤できない／「未打刻」に見える。
 *   窓は 30 時間まで広げ、代わりに isOpenShiftCurrent で「まだその回の続きか」を判定する
 *   （日勤の出勤を翌日まで引きずらないため。窓を広げるだけだと退勤忘れの翌朝に出勤ボタンが出ない）。
 */
export const RECENT_LOG_HOURS = 30

/**
 * 未退勤の出勤（open shift）を「まだ続いている回」とみなすか。
 *  - 出勤から 20 時間以内 … 続いている（従来の窓）
 *  - 夕方以降（JST 17:00〜）の出勤は 30 時間以内 … 続いている（夜のみ現場。翌日の昼過ぎまで退勤を受ける）
 *  それ以外（例: 日勤の出勤を翌朝まで閉じ忘れ）は新しい回として扱う＝出勤フォームに戻す。
 */
export function isOpenShiftCurrent(checkinIso: string, now: Date = new Date()): boolean {
  const ageH = (now.getTime() - new Date(checkinIso).getTime()) / 3600000
  if (ageH < 0) return true
  if (ageH <= 20) return true
  const hour = Number(jstTimeOf(checkinIso).slice(0, 2))
  return hour >= 17 && ageH <= RECENT_LOG_HOURS
}
