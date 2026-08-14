// ============================================================
//  lib/pendingEditDiff.ts
//  保留中の日報編集について「保存された差分」が空の時に、
//  payload（変更後）と現在の daily_reports（変更前）をその場で比べて概要を出す。
//
//  ★なぜ要るか（2026-08-12 本番で発覚）:
//   差分は LIFF が「申請した瞬間」に計算して diffs 列に保存する設計だった。
//   ところが本番のコードは computeDiff に出張フラグとガソリン代を渡しておらず、
//   出張を付け直しただけの編集は diffs が空になっていた。
//   結果、承認画面に「表示できる差分がありません」とだけ出て、
//   運用者が『なんの修正か こちら側がわからん』まま承認を迫られていた。
//   実際には経費が 0→15,098円 増えているものまで空表示だった。
//
//   ★申請時に確定して保存する方式は、計算漏れがあると永久に取り返せない。
//    payload は残っているので、表示のたびに比べれば過去の申請も救える。
//
//  ★これは「概要」であって LIFF の行単位の差分の置き換えではない。
//   保存された差分がある時はそちらを優先し、これは空の時だけ出す。
//   両者を1つに統一するのは別チケット（i18n の扱いを決める必要がある）。
// ============================================================

/** daily_reports 行（変更前） */
export interface ReportRow {
  is_working?: boolean | null
  leave_type?: string | null
  is_business_trip?: boolean | null
  note?: string | null
  sites?: any[] | null
  gasoline_items?: any[] | null
}

/** 保留の payload（変更後）。列名は daily_reports に合わせてある */
export type PendingPayload = ReportRow

/** sites[].expenses.*[] と gasoline_items[] の yen を全部足す */
export function totalExpenseYen(r: ReportRow | null | undefined): number {
  let sum = 0
  for (const site of (r?.sites ?? [])) {
    const exp = site?.expenses ?? {}
    for (const v of Object.values(exp)) {
      if (Array.isArray(v)) for (const item of v) sum += Number((item as any)?.yen) || 0
      else sum += Number((v as any)) || 0   // 旧形式のスカラー（hotelYen 等）
    }
  }
  for (const g of (r?.gasoline_items ?? [])) sum += Number((g as any)?.yen) || 0
  return sum
}

/** 経費配列キー → 承認画面で使う呼び名 */
const EXPENSE_KEY_LABELS: Record<string, string> = {
  parkings: '駐車場代', highways: '高速代', trains: '電車', hotels: '宿泊費',
  others: 'その他', entertainments: 'その他雑経費',
}

/**
 * 「領収書が無い理由」が申告された明細（例: 「駐車場代: レジ故障でレシートが出なかった」）。
 * ★承認者がこれを読めないと、証憑なしを通してよいか判断できない。
 *  作業員に書かせておいて承認画面に出さないなら、書かせる意味が無い。
 */
export function noReceiptReasons(r: ReportRow | null | undefined): string[] {
  const out: string[] = []
  const push = (label: string, item: any) => {
    const reason = String(item?.noReceiptReason ?? '').trim()
    if (reason) out.push(`${label}: ${reason}`)
  }
  for (const site of (r?.sites ?? [])) {
    for (const [key, v] of Object.entries(site?.expenses ?? {})) {
      if (!Array.isArray(v)) continue
      for (const item of v) push(EXPENSE_KEY_LABELS[key] ?? key, item)
    }
  }
  for (const g of (r?.gasoline_items ?? [])) push('ガソリン代', g)
  return out
}

/** 領収書の枚数（fileUrls の総数） */
export function receiptCount(r: ReportRow | null | undefined): number {
  let n = 0
  for (const site of (r?.sites ?? [])) {
    for (const v of Object.values(site?.expenses ?? {})) {
      if (Array.isArray(v)) for (const item of v) n += ((item as any)?.fileUrls ?? []).length
    }
  }
  for (const g of (r?.gasoline_items ?? [])) n += ((g as any)?.fileUrls ?? []).length
  return n
}

const yen = (v: number) => '¥' + Math.round(v).toLocaleString()
const workLabel = (isWorking?: boolean | null, leave?: string | null) =>
  leave === 'paid_leave' ? '有給' : (isWorking ? '稼働あり' : '稼働なし')

/**
 * 変更前後を比べて日本語の概要行を返す。差が無ければ空配列。
 * ★「変わっていない」と「比べられなかった」を混同しない。before が無い時は呼ばない側で判断する。
 */
export function summarizePendingEdit(before: ReportRow | null, after: PendingPayload | null): string[] {
  if (!before || !after) return []
  const lines: string[] = []

  const wb = workLabel(before.is_working, before.leave_type)
  const wa = workLabel(after.is_working, after.leave_type)
  if (wb !== wa) lines.push(`稼働: ${wb} → ${wa}`)

  const tb = !!before.is_business_trip
  const ta = !!after.is_business_trip
  if (tb !== ta) lines.push(`出張: ${tb ? 'あり' : 'なし'} → ${ta ? 'あり' : 'なし'}（出張手当に影響）`)

  const eb = totalExpenseYen(before)
  const ea = totalExpenseYen(after)
  if (eb !== ea) lines.push(`経費合計: ${yen(eb)} → ${yen(ea)}（${ea > eb ? '+' : '−'}${yen(Math.abs(ea - eb))}）`)

  const rb = receiptCount(before)
  const ra = receiptCount(after)
  if (rb !== ra) lines.push(`領収書: ${rb}枚 → ${ra}枚`)

  const nb = (before.note ?? '').trim()
  const na = (after.note ?? '').trim()
  if (nb !== na) lines.push('備考が変更されています')

  return lines
}
