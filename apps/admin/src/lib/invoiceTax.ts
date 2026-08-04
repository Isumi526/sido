// 下請け請求の消費税計算を1か所に集約する。
//
// 経緯: tax_mode（内税/外税）を足した時、モーダル側の合計だけを分岐させて一覧側の
// grand_total を直し忘れ、同じ画面で「モーダルは110,000・一覧は121,000」と食い違った
// （2026-08-01 レビューでNG）。同じ規則を2か所に書くと必ずまたズレるので、
// 一覧・モーダル・将来の集計は全部ここを通す。
//
// amount の意味は tax_mode で変わる:
//   exclusive … amount は税抜。消費税は amount × rate を「足す」。
//   inclusive … amount は税込。消費税は amount から「割り戻す」（足すと二重計上）。

export type TaxMode = 'exclusive' | 'inclusive'

export type TaxableItem = {
  amount: number | string | null
  tax_rate: number | string | null
}

/** DBやAI応答から来た値を安全に TaxMode へ寄せる（不明なら従来挙動の exclusive） */
export function normalizeTaxMode(v: unknown): TaxMode {
  return v === 'inclusive' ? 'inclusive' : 'exclusive'
}

/** 明細 amount の素の合計。inclusive なら税込額、exclusive なら税抜額。 */
export function sumAmount(items: readonly TaxableItem[] | null | undefined): number {
  return (items ?? []).reduce((s, it) => s + (Number(it.amount) || 0), 0)
}

/** 消費税額。inclusive は amount − amount/(1+rate) の合計（割り戻し）。 */
export function taxTotalOf(items: readonly TaxableItem[] | null | undefined, mode: TaxMode): number {
  const list = items ?? []
  if (mode === 'inclusive') {
    return Math.round(list.reduce((s, it) => {
      const amt = Number(it.amount) || 0
      const rate = (Number(it.tax_rate) || 0) / 100
      return s + (rate > 0 ? amt - amt / (1 + rate) : 0)
    }, 0))
  }
  return Math.round(list.reduce((s, it) => s + (Number(it.amount) || 0) * (Number(it.tax_rate) || 0) / 100, 0))
}

/** 税抜計。inclusive は割り戻した額、exclusive は amount の合計そのもの。 */
export function netTotalOf(items: readonly TaxableItem[] | null | undefined, mode: TaxMode): number {
  const sub = sumAmount(items)
  return mode === 'inclusive' ? sub - taxTotalOf(items, mode) : sub
}

/**
 * 明細1行を「原価」として積む時の額（＝税抜）。
 *
 * 集計は請求書をまたいで行ごとに合算するため、内税と外税の行が1つの合計に混ざる。
 * netTotalOf は「1枚ぶんの明細＋その1枚のmode」しか表せないので、行単位のこれを使う。
 * 原価は税抜で揃える（消費税は原価ではなく預り/仮払）。
 */
export function netAmountOf(item: TaxableItem, mode: TaxMode): number {
  const amt = Number(item.amount) || 0
  if (mode !== 'inclusive') return amt
  const rate = (Number(item.tax_rate) || 0) / 100
  return rate > 0 ? amt / (1 + rate) : amt
}

/** 税込計。inclusive は amount の合計がそのまま税込。一覧の「請求金額(税込)」もこれ。 */
export function grossTotalOf(items: readonly TaxableItem[] | null | undefined, mode: TaxMode): number {
  const sub = sumAmount(items)
  return mode === 'inclusive' ? sub : sub + taxTotalOf(items, mode)
}
