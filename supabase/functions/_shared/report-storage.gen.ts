// ⚠️ AUTO-GENERATED from shared/report-storage.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/report-storage.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/report-storage.ts
//  日報を daily_reports に保存する形へ整える。
//
//  ★正典。LIFF と Edge Function(submit-daily-report) の両方がここを使う
//   （scripts/sync-shared.mjs で LIFF へ配布、EF は shared から直接 import）。
//
//  ★なぜ共有するのか:
//   保存は「クライアントで整形 → EF が書く」形にすると、EF が受け取った JSON を
//   検証せず書くことになる。かといって EF に複製すると LIFF と二重管理になり、
//   整形規則がズレた時に「保存された形」と「読む側の期待」が食い違う。
//   同じ関数を両方から呼ぶ形にして、ズレようが無いようにする。
//
//  ★ここはホワイトリスト。列挙し忘れたフィールドは黙って消える。
//   経費の項目を増やす時は必ずここも直すこと。
// ============================================================
import { mergeOtherExpenses, splitOtherExpenses } from './expense-flatten.gen.ts'
import { resolveActiveSiteId } from './site-similarity.gen.ts'
import { laborBreakdownForReport } from './worker-hours.gen.ts'

/** 添付ファイルの実体を持つキー。保存する JSON からは落とす（URLだけ残す） */
const FILE_KEYS = [
  'vehicleFiles', 'trainFiles', 'hotelFiles', 'leopalaceFiles',
  'otherFiles', 'entertainmentFiles', 'garbagePhotos',
]

function stripItemFiles(items: any[] | undefined): any[] | undefined {
  return Array.isArray(items) ? items.map(({ files, ...rest }: any) => rest) : items
}

/** 本日のガソリン代（明細リスト）：金額のある明細だけ・_id は除去 */
export function normalizeGasolineItems(items: any[] | undefined): any[] {
  return (items ?? [])
    .filter((it: any) => Number(it?.yen) > 0)
    .map((it: any) => ({
      yen: Math.round(Number(it.yen) || 0),
      payee: it.payee?.trim() || null,
      registrationNumber: it.registrationNumber?.trim() || null,
      liters: Number(it.liters) > 0 ? Number(it.liters) : null,
      fuelType: it.fuelType === 'diesel' ? 'diesel' : (it.fuelType === 'regular' ? 'regular' : null),
      tategae: !!it.tategae,
      fileUrls: Array.isArray(it.fileUrls) ? it.fileUrls : [],
      // ★ここはホワイトリスト。列挙し忘れたフィールドは黙って消える。
      noReceiptReason: it.noReceiptReason?.trim() || null,
    }))
}

/**
 * 現場配列を保存形に整える。
 *  - 添付ファイルの実体を落とす（URLは残す）
 *  - 「その他」に統合されている経費を、科目=接待交際費だけ entertainments へ戻す
 *  - 現場マスタへ正規化名一致で site_id を解決して刻む
 *
 * ★site_id を刻むのが肝。現場名の文字列で集計すると表記ゆれ・現場マージで孤児になる。
 *  解決できなければ既存の site_id を保持（マージ/非アクティブ化後の安定性）、
 *  それも無ければ null（＝名前フォールバック。誤った現場に配賦するよりまし）。
 */
export function sanitizeSitesForStorage(
  sites: any[],
  activeSites: Array<{ id: string; name: string }> = [],
  reportDate?: string | null,
): any[] {
  // ★工数(hoursNormal 等)を実時間から計算し直してから保存する（2026-08-30）。
  //  これまでフォームの既定値（hoursNormal: 8）がそのまま保存されており、本番の
  //  作業員行の77%が「一律8時間」という嘘の値を持っていた。
  //  表示・集計は全部この計算をやり直しているので実害は出ていなかったが、
  //  保存値を素直に読んだ人が必ず間違える地雷になる。保存する値と集計する値を一致させる。
  //  （2時間の作業が8時間に見える／短い作業が0時間に見える、という指摘の出所でもある）
  const isSunday = reportDate ? new Date(`${reportDate}T00:00:00+09:00`).getDay() === 0 : false
  const laborMap = laborBreakdownForReport(sites ?? [], isSunday)

  return (sites ?? []).map((site: any) => {
    const exp = { ...(site?.expenses ?? {}) }
    for (const k of FILE_KEYS) delete exp[k]
    if (exp.parkings) exp.parkings = stripItemFiles(exp.parkings)
    if (exp.highways) exp.highways = stripItemFiles(exp.highways)
    if (exp.trains)   exp.trains   = stripItemFiles(exp.trains)
    if (exp.others)   exp.others   = stripItemFiles(exp.others)
    if (exp.entertainments) exp.entertainments = stripItemFiles(exp.entertainments)
    // 入力は「その他」1本に統合済み（2026-07-31）。保存時にここで科目=接待交際費だけを
    // entertainments へ戻す。現場別集計は entertainments を接待交際費列・others をホーム列に
    // 集計しているため、この振り分けをやめると金額が別の列へ移動する（集計は触らない方針）。
    if (exp.others || exp.entertainments) {
      const split = splitOtherExpenses(mergeOtherExpenses(exp.others, exp.entertainments))
      exp.others = split.others
      exp.entertainments = split.entertainments
    }
    if (exp.hotels) exp.hotels = stripItemFiles(exp.hotels)
    const resolved = resolveActiveSiteId(site, activeSites)
    const site_id = resolved ?? (site?.site_id ?? null)
    const workers = Array.isArray(site?.workers)
      ? site.workers.map((w: any) => (w?.workerName ? { ...w, ...(laborMap.get(w) ?? {}) } : w))
      : site?.workers
    return { ...site, workers, expenses: exp, site_id }
  })
}

/** 日報の保存に載せる現場名（新規現場は customSiteName を採用）。__unset__/空は除く */
export function siteNamesToRegister(sites: any[]): string[] {
  const names = new Set<string>()
  for (const s of (sites ?? [])) {
    if (s?.siteName === '__unset__') continue   // 現場未設定はマスタ登録しない（あとで紐付け）
    const raw = s?.siteName === '__other__' ? s?.customSiteName : s?.siteName
    const name = (raw ?? '').trim()
    if (name && name !== '__other__') names.add(name)
  }
  return [...names]
}

/**
 * 承認された残業申請（実績修正）を、既に保存されている日報の作業員行へ書き込む。
 *
 * ★なぜここに置くか（2026-09-14 辻さん「前日より以前の休憩を修正したい」）:
 *  承認された休憩は LIFF の日報画面（report.vue applyApprovedBreak）が「開いて保存した時」に
 *  作業員行へ乗せている。送信済みの過去日はもう開かれないので、承認しても労働時間が変わらない。
 *  承認時に EF がこの関数で同じ形に書き込み、sanitizeSitesForStorage で工数を計算し直す。
 *  report.vue と規則をそろえる：
 *   - 休憩は「一番早い現場の行」に承認分・他の行は 0（1日の休憩は1つの申請で決まる）
 *   - breaks=[{start, minutes}] + breakSnapshot=true（0分でも要素を残して既定計算に落ちない）
 *   - start は既存の breaks[0].start を保ち、無ければ 12:00
 *  時刻は実績修正(late)の時だけ：早出は一番早い行の startTime、終了は一番遅い行の endTime を置き換える。
 *  （締切前の通常申請の終了時刻は「希望」であって実績ではないので書かない）
 *
 * @returns 書き換えた行数（0 なら本人の行が無い＝呼び出し側は何もしない）
 */
export function applyApprovedOvertimeToSites(
  sites: any[],
  workerId: string,
  adj: { breakMinutes: number | null; startTime: string | null; endTime: string | null; isLate: boolean },
): number {
  const rows: Array<{ w: any; start: number; end: number }> = []
  for (const s of (sites ?? [])) {
    for (const w of (Array.isArray(s?.workers) ? s.workers : [])) {
      if (!w || w.workerId !== workerId) continue
      rows.push({ w, start: parseMinLoose(w.startTime, 8 * 60), end: parseMinLoose(w.endTime, 17 * 60 + 30) })
    }
  }
  if (!rows.length) return 0
  const byStart = [...rows].sort((a, b) => a.start - b.start)
  if (adj.breakMinutes !== null && adj.breakMinutes !== undefined) {
    byStart.forEach(({ w }, idx) => {
      const minutes = idx === 0 ? adj.breakMinutes as number : 0
      const start = (Array.isArray(w.breaks) && w.breaks[0]?.start) ? w.breaks[0].start : '12:00'
      w.breaks = [{ start, minutes }]
      w.breakMinutes = minutes
      w.breakSnapshot = true
    })
  }
  if (adj.isLate) {
    if (adj.startTime) byStart[0].w.startTime = adj.startTime
    if (adj.endTime) {
      const last = [...rows].sort((a, b) => b.end - a.end)[0]
      last.w.endTime = adj.endTime
    }
  }
  return rows.length
}

function parseMinLoose(hhmm: unknown, fallback: number): number {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm)) return fallback
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
