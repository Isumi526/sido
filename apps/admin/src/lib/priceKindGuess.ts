// ============================================================
//  priceKindGuess.ts — 受領見積の行が「材工一体」か「材料のみ」かを推定する
//
//  ★判定ロジックの出所（議事録 §2.3 の手書きメモ）:
//    「見積書に人工（労務費）の記載が無く、かつ価格が定価より高い場合に材工一体と判定」
//    材料だけを買うなら定価×掛率で仕入れるので定価は超えない。
//    定価を超えているのに労務の行が無い＝手間が単価に溶けている、という読み。
//
//  ★あくまで「推定」。勝手に確定しない:
//    - 人が既に区分を選んでいる行（price_kind あり）には**一切触れない**
//    - 返すのは候補と根拠だけ。適用するかは画面で人が押す
//    区分を取り違えると材工共と材料のみを横並びで比較して誤選定するため、
//    自動確定は業務上まずい（Q3 で手動フラグを入れたのと同じ理由）。
// ============================================================

export type PriceKind = 'material_labor' | 'labor' | 'material'

export type GuessLine = {
  item_name: string
  unit_price: number | null
  price_kind: string | null
}

export type Guess = {
  kind: PriceKind
  /** 画面に出す根拠。「なぜそう推定したか」が見えないと人が判断できない */
  reason: string
}

/** 表記ゆれを吸収して定価を引くためのキー（全半角・空白・大小文字を潰す） */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** その見積（1業者ぶんの明細）に労務の行があるか */
export function hasLaborLine(lines: readonly GuessLine[]): boolean {
  return lines.some((l) => l.price_kind === 'labor')
}

/**
 * 1行ぶんの推定。推定できない時は null（＝画面には何も出さない）。
 *
 * @param line      対象行
 * @param lines     同じ見積の全行（労務行の有無を見るのに要る）
 * @param listPriceOf 名称→定価。定価が無ければ null を返す関数
 */
export function guessPriceKind(
  line: GuessLine,
  lines: readonly GuessLine[],
  listPriceOf: (name: string) => number | null,
): Guess | null {
  // ★人が選んだ区分は尊重する。上書き提案もしない（Q3の手動フラグと衝突させない）
  if (line.price_kind) return null

  const price = Number(line.unit_price)
  if (!Number.isFinite(price) || price <= 0) return null

  const list = listPriceOf(normalizeName(line.item_name))
  // 定価が分からなければ「定価より高い」を判定できない＝推定しない（憶測で決めない）
  if (list == null || !(list > 0)) return null

  const diffPct = Math.round(((price - list) / list) * 100)
  const labor = hasLaborLine(lines)

  if (!labor && price > list) {
    return {
      kind: 'material_labor',
      reason: `人工の記載なし＋定価比 ${diffPct >= 0 ? '+' : ''}${diffPct}%`,
    }
  }
  if (price <= list) {
    return {
      kind: 'material',
      reason: `定価以下（定価比 ${diffPct >= 0 ? '+' : ''}${diffPct}%）＝材料のみの仕入と読める`,
    }
  }
  // 労務の行がある見積で定価超え＝材工が分かれて書かれている可能性が高い。
  // どちらとも言い切れないので推定しない。
  return null
}
