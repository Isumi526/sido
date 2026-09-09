// ============================================================
//  lib/estimateExcel.ts
//  見積Excel（株式会社シードの様式）の取り込みと、工種別シートの生成。
//
//  ★構造（実物 0603 銀座りシャール見積もり.xlsx から確認・2026-09-09）
//   「全体見積」シートは B列の書き方で3層を表している:
//      （壁面工事）  … 場所（大分類）
//      ■軽鉄工事    … 工種（中分類）
//      壁面 外周LGS間仕切 … 作業内容（明細）
//
//   ★同じ工種が複数の場所に現れる。実例では
//     軽鉄工事 = 壁面(r5〜) と 天井(r39〜) の2箇所、塗装工事も2箇所。
//   発注は工種ごとに業者が分かれるため、**場所軸で並んだ明細を工種軸へ集め直す**
//   必要がある。これが今まで手コピーでやっていた作業の正体。
//
//  ★工種別シートには「全体見積」を参照する数式が1本も無い（実物で確認）。
//   だから片方を直すともう片方が古いままになる。生成で置き換える。
//
//  ★フォーマットは会社ごとに違う。ここをハードコードせず設定として持つのは、
//   2社目のテンプレを見たときに「設定で足りるのか、作り込みが要るのか」を
//   即座に判定できるようにするため。1社目で決め打ちすると何も学べない。
// ============================================================
import { XlsxTemplate, type CellValue } from './xlsxCells'

/** 明細1行。Excelの列と1対1に対応する。 */
export type EstimateRow = {
  location: string      // 場所（（壁面工事）など・括弧は外して保持）
  trade: string         // 工種（■を外した名前。例: 軽鉄工事）
  name: string          // 名称
  spec: string          // 形状・詳細
  w: number | null      // W(t)
  d: number | null      // D(＠)
  h: number | null      // H(L)
  quantity: number | null
  unit: string
  costUnitPrice: number | null   // 単価原価
  sourceRow: number     // 全体見積の元の行番号（書き戻しの照合用）
}

/** 会社ごとのフォーマット定義。SEED以外を足す時はこの形を増やす。 */
export type EstimateFormat = {
  id: string
  label: string
  /** 明細が並ぶシート */
  mainSheet: string
  /** 明細の走査範囲 */
  firstRow: number
  lastRow: number
  /** 列の割り当て（A1のアルファベット） */
  col: {
    name: string; spec: string; w: string; d: string; h: string
    quantity: string; unit: string; costUnitPrice: string
  }
  /** 場所・工種の見出しをB列の書き方で見分ける */
  locationPattern: RegExp
  tradePattern: RegExp
  /** 工種名 → 工種別シート名 */
  tradeSheets: Record<string, string>
  /** 工種別シートの明細行の範囲（合計式が参照している範囲） */
  tradeSheetRows: { first: number; last: number }
  /** 工種別シート側の列割り当て */
  tradeCol: { name: string; spec: string; w: string; d: string; h: string; quantity: string; unit: string; costUnitPrice: string }
}

export const SEED_FORMAT: EstimateFormat = {
  id: 'seed-v1',
  label: '株式会社シード（内訳書様式）',
  mainSheet: '全体見積',
  firstRow: 3,
  lastRow: 107,
  col: { name: 'B', spec: 'C', w: 'D', d: 'E', h: 'F', quantity: 'N', unit: 'O', costUnitPrice: 'P' },
  locationPattern: /^（(.+)）$/,
  tradePattern: /^■(.+)$/,
  // 「項目」シートが参照しているシート名に合わせる（数式で表紙まで繋がっている）
  tradeSheets: {
    '仮設工事': '仮設工事',
    '解体工事': '解体工事 (2)',
    '軽鉄工事': '軽鉄工事 (3)',
    '壁面表装工事': '壁面表装工事 (4)',
    '床表装工事': '床表装工事 (5)',
    '塗装工事': '塗装工事 (6)',
    '造作工事': '造作工事 (7)',
    '什器工事': '什器工事 (8)',
    '建具工事': '建具工事 (9)',
    '金物工事': '金物工事',
    '左官工事': '左官工事 (11)',
    'タイル工事': 'タイル工事 (13)',
    'ガラス工事': 'ガラス工事 (12)',
    'サイン工事': 'サイン工事 (13)',
    '電気工事': '電気工事 (14)',
    '空調工事': '空調工事 (15)',
    '給排水衛生工事': '給排水衛生工事 (16)',
    '施工管理': '施工管理 (17)',
    '諸経費': '諸経費工事 (18)',
  },
  tradeSheetRows: { first: 3, last: 26 },
  tradeCol: { name: 'B', spec: 'C', w: 'D', d: 'E', h: 'F', quantity: 'N', unit: 'O', costUnitPrice: 'P' },
}

/** 入力規則を書き換える対象シート（明細が並ぶシート）。 */
const MAIN_SHEET_FOR_DV = SEED_FORMAT.mainSheet

const num = (v: CellValue): number | null =>
  typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null)
const str = (v: CellValue): string => (v == null ? '' : String(v)).trim()

/** 「全体見積」を読み、場所・工種を明細に展開して返す。 */
export async function parseEstimate(t: XlsxTemplate, fmt: EstimateFormat = SEED_FORMAT): Promise<EstimateRow[]> {
  const cells = await t.readSheet(fmt.mainSheet)
  const at = (col: string, row: number) => cells.get(`${col}${row}`) ?? null

  const rows: EstimateRow[] = []
  let location = ''
  let trade = ''
  for (let r = fmt.firstRow; r <= fmt.lastRow; r++) {
    const b = str(at(fmt.col.name, r))
    if (!b) continue
    const loc = fmt.locationPattern.exec(b)
    if (loc) { location = loc[1]; trade = ''; continue }
    const tr = fmt.tradePattern.exec(b)
    if (tr) { trade = tr[1]; continue }
    // 明細行。数量も原価も無い行（メモだけ等）は拾わない。
    const quantity = num(at(fmt.col.quantity, r))
    const cost = num(at(fmt.col.costUnitPrice, r))
    if (quantity == null && cost == null) continue
    rows.push({
      location, trade, name: b,
      spec: str(at(fmt.col.spec, r)),
      w: num(at(fmt.col.w, r)), d: num(at(fmt.col.d, r)), h: num(at(fmt.col.h, r)),
      quantity, unit: str(at(fmt.col.unit, r)),
      costUnitPrice: cost,
      sourceRow: r,
    })
  }
  return rows
}

/** 明細を工種ごとにまとめる（場所をまたいで集め直す＝手コピーの代替）。 */
export function groupByTrade(rows: EstimateRow[]): Map<string, EstimateRow[]> {
  const m = new Map<string, EstimateRow[]>()
  for (const r of rows) {
    if (!r.trade) continue
    const a = m.get(r.trade) ?? []
    a.push(r)
    m.set(r.trade, a)
  }
  return m
}

export type GenerateResult = {
  written: { trade: string; sheet: string; count: number }[]
  /** 行数が足りずに書けなかった分。黙って捨てると金額が合わなくなるので必ず返す。 */
  overflow: { trade: string; sheet: string; capacity: number; needed: number }[]
  /** 対応するシートが無い工種 */
  unknownTrades: string[]
}

/**
 * 工種別シートを生成する。
 * ★入りきらない行は書かずに overflow として返す。
 *  合計式が `=J3+J4+…` と行を1つずつ手書きしているため、
 *  勝手に行を足すと式の外に落ちて **合計に入らないまま体裁だけ整う**（最悪の壊れ方）。
 */
export async function writeTradeSheets(
  t: XlsxTemplate, rows: EstimateRow[], fmt: EstimateFormat = SEED_FORMAT,
): Promise<GenerateResult> {
  const grouped = groupByTrade(rows)
  const res: GenerateResult = { written: [], overflow: [], unknownTrades: [] }
  const { first, last } = fmt.tradeSheetRows
  const capacity = last - first + 1
  const c = fmt.tradeCol

  for (const [trade, items] of grouped) {
    const sheet = fmt.tradeSheets[trade]
    if (!sheet || !t.has(sheet)) { res.unknownTrades.push(trade); continue }

    const fit = items.slice(0, capacity)
    if (items.length > capacity) {
      res.overflow.push({ trade, sheet, capacity, needed: items.length })
    }

    const values: Record<string, CellValue> = {}
    for (let i = 0; i < capacity; i++) {
      const row = first + i
      const it = fit[i]
      // 余った行は明示的に空にする（前回の生成結果が残らないように）
      values[`${c.name}${row}`]  = it ? it.name : null
      values[`${c.spec}${row}`]  = it ? (it.spec || null) : null
      values[`${c.w}${row}`]     = it ? it.w : null
      values[`${c.d}${row}`]     = it ? it.d : null
      values[`${c.h}${row}`]     = it ? it.h : null
      values[`${c.quantity}${row}`] = it ? it.quantity : null
      values[`${c.unit}${row}`]  = it ? (it.unit || null) : null
      values[`${c.costUnitPrice}${row}`] = it ? it.costUnitPrice : null
    }
    await t.writeCells(sheet, values)
    res.written.push({ trade, sheet, count: fit.length })
  }
  return res
}

/** 確定した原価を「全体見積」へ書き戻す（単価候補から選んだ結果の反映）。 */
export async function writeCosts(
  t: XlsxTemplate, rows: EstimateRow[], fmt: EstimateFormat = SEED_FORMAT,
): Promise<void> {
  const values: Record<string, CellValue> = {}
  for (const r of rows) values[`${fmt.col.costUnitPrice}${r.sourceRow}`] = r.costUnitPrice
  await t.writeCells(fmt.mainSheet, values)
}


// ============================================================
//  単価表・候補表の書き込み（アプリ → Excel）
// ============================================================

/** 単価履歴の1件（estimate_price_history ビュー由来）。 */
export type PriceRow = {
  workName: string          // 作業内容（名寄せ後の正式名称）
  unitPrice: number         // 原価
  vendorName: string        // 業者名
  quotedOn: string          // 提示日 YYYY-MM-DD
  quantity?: number | null  // その見積が何数量に対するものか
  unit?: string | null
}

/** 単価表シートに出す1行の表示ラベル。ドロップダウンにそのまま並ぶ。 */
export function priceLabel(p: PriceRow): string {
  const qty = p.quantity != null && p.quantity > 0 ? `　${p.quantity}${p.unit ?? ''}` : ''
  return `${p.vendorName}　¥${p.unitPrice.toLocaleString()}　${p.quotedOn}${qty}`
}

/**
 * 業者×作業内容ごとに最新の1件へ絞る。
 *
 * ★なぜ最新だけか（2026-07-26 打ち合わせ2）
 *   「各業者ごとに最新の履歴さえ見れればいい？」→「うん、まあでも過去も残っとった方がいい」
 *   ＝ 選ぶ時に同じ業者が何行も並ぶのは邪魔。遡りたい時は単価表シートを見れば足りる。
 *   ★ただし数量で単価は動く（「千平米やったら…九十万でいいですよ」）ため、
 *    ラベルに数量を出して人が判断できるようにしてある。
 */
export function latestPerVendor(rows: PriceRow[]): PriceRow[] {
  const best = new Map<string, PriceRow>()
  for (const r of rows) {
    const key = `${r.workName}|${r.vendorName}`
    const cur = best.get(key)
    if (!cur || r.quotedOn > cur.quotedOn) best.set(key, r)
  }
  return [...best.values()]
}

export type PriceSheetResult = { priceRows: number; candidates: number }

/**
 * 単価表シートと候補表シートを書き出す。
 *
 * ★単価表は「作業内容の昇順」でなければならない。
 *  発注先の絞り込みが OFFSET+MATCH+COUNTIF で連続範囲を切り出す仕組みのため、
 *  同じ作業内容が飛び飛びに並ぶと候補が欠ける。
 * ★候補表は場所・工種・作業内容を1本にまとめる。
 *  Excel は1セルに1つしかドロップダウンを付けられないため（重ねるとファイルが壊れる）。
 */
export async function writePriceSheets(
  t: XlsxTemplate,
  prices: PriceRow[],
  opts: { locations: string[]; trades: string[]; extraNames?: string[]; maxRows?: number },
): Promise<PriceSheetResult> {
  const MAX = opts.maxRows ?? 499
  const rows = latestPerVendor(prices)
    .sort((a, b) => a.workName.localeCompare(b.workName, 'ja') || a.unitPrice - b.unitPrice)
    .slice(0, MAX)

  const values: Record<string, CellValue> = {}
  for (let i = 0; i < MAX; i++) {
    const r = 2 + i
    const p = rows[i]
    values[`A${r}`] = p ? p.workName : null
    values[`B${r}`] = p ? p.unitPrice : null
    values[`C${r}`] = p ? p.vendorName : null
    values[`D${r}`] = p ? p.quotedOn : null
    values[`E${r}`] = p ? priceLabel(p) : null
  }
  await t.writeCells('単価表', values)

  // 候補表：場所 → 工種 → 作業内容（重複排除）
  const names = [...new Set([...rows.map((r) => r.workName), ...(opts.extraNames ?? [])])]
    .sort((a, b) => a.localeCompare(b, 'ja'))
  const all = [...opts.locations, ...opts.trades, ...names]
  const cand: Record<string, CellValue> = {}
  for (let i = 0; i < MAX; i++) cand[`A${2 + i}`] = all[i] ?? null
  await t.writeCells('候補表', cand)

  // ★名称のドロップダウンを「実件数ぴったりの直接参照」へ書き換える。
  //  Excel の入力補完（打ち込むと絞り込まれる機能）は直接の範囲参照でしか効かない。
  //  OFFSET 等の数式で作った動的範囲では効かないことを実測で確認している。
  const lastRow = Math.max(2, all.length + 1)
  await t.replaceValidationSource(MAIN_SHEET_FOR_DV, '候補表', `'候補表'!$A$2:$A$${lastRow}`)

  return { priceRows: rows.length, candidates: all.length }
}
