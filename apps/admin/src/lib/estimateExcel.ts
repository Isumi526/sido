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
import { XlsxTemplate, colLetter, type CellValue } from './xlsxCells'

/** 明細1行。Excelの列と1対1に対応する。 */
export type EstimateRow = {
  location: string      // 場所（（壁面工事）など・括弧は外して保持）
  trade: string         // 工種（■を外した名前。例: 軽鉄工事）
  /** 工種の出所: 'column'＝行の「工事区分」列（E-2・明示）／'heading'＝■見出しからの推定（旧様式の互換） */
  tradeSource: 'column' | 'heading' | ''
  part: string          // 部位（天井／壁／床。空＝なし）。E-2 で「部位」列から読む
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
    /** E-2: 行ごとの「工事区分」「部位」列（SEED テンプレ v2 で明示）。無い様式では省略＝■見出しから推定 */
    trade?: string; part?: string
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
  // ★E-2（2026-09-20）: AA=工事区分・AB=部位 を行ごとに持つ（テンプレ v2・scripts/make-estimate-template.py と対）。
  //  Q〜Y は金額の数式列で埋まっているので、その外側。入っていればそちらを正とし、空なら ■見出しから推定（v1 の見積もそのまま読める）。
  col: { name: 'B', spec: 'C', w: 'D', d: 'E', h: 'F', quantity: 'N', unit: 'O', costUnitPrice: 'P', trade: 'AA', part: 'AB' },
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
/** 名称（B列）の入力規則を見分ける印。候補表の A 列を参照している規則だけ（AA/AB 列の規則は B/C 列を参照）。
 *  v1 テンプレの式 `OFFSET('候補表'!$A$2,…)`／アプリが書いた式 `'候補表'!$A$2:$A$n` のどちらにも当たる */
export const NAME_DV_MATCH = /候補表'?!\$A\$2/

const num = (v: CellValue): number | null =>
  typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : null)
const str = (v: CellValue): string => (v == null ? '' : String(v)).trim()

/** 部位の値（天井／壁／床）。表記ゆれ（壁面・天井面・床面・全角空白）を吸収し、それ以外は '' */
export const PARTS = ['天井', '壁', '床'] as const
export function normalizePart(v: string | null | undefined): string {
  const t = (v ?? '').replace(/[\s　]/g, '')
  if (!t) return ''
  if (t.startsWith('天井')) return '天井'
  if (t.startsWith('壁')) return '壁'
  if (t.startsWith('床')) return '床'
  return ''
}
/** 作業内容の名前から部位を推定（単価履歴に部位が無い過去データの補い）。「壁面 PB貼」→壁、「天井LGS下地組」→天井 */
export function guessPart(name: string): string {
  const t = (name ?? '').replace(/[\s　]/g, '')
  if (/天井/.test(t)) return '天井'
  if (/床/.test(t)) return '床'
  if (/壁/.test(t)) return '壁'
  return ''
}
/** 「■軽鉄工事」「軽鉄工事」→ 軽鉄工事 */
export const tradeKey = (v: string | null | undefined): string => (v ?? '').replace(/[\s　]/g, '').replace(/^■/, '')

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
    // E-2: 行の「工事区分」列が入っていればそれを正とする（見出しからの推定はしない）。空なら旧様式の互換で見出し
    const colTrade = fmt.col.trade ? tradeKey(str(at(fmt.col.trade, r))) : ''
    const rowTrade = colTrade || trade
    const part = fmt.col.part ? normalizePart(str(at(fmt.col.part, r))) : ''
    rows.push({
      location, trade: rowTrade, tradeSource: colTrade ? 'column' : (trade ? 'heading' : ''), part, name: b,
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
  /** E-2: 1工種だけ抜き出す時に指定（大塚「軽鉄工事だけに絞った項目が欲しい」）。省略＝全工種 */
  opts: { trades?: string[] } = {},
): Promise<GenerateResult> {
  const grouped = groupByTrade(rows)
  const res: GenerateResult = { written: [], overflow: [], unknownTrades: [] }
  const { first, last } = fmt.tradeSheetRows
  const capacity = last - first + 1
  const c = fmt.tradeCol
  const only = opts.trades?.length ? new Set(opts.trades.map(tradeKey)) : null

  for (const [trade, items] of grouped) {
    if (only && !only.has(tradeKey(trade))) continue
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
  /** E-2: 工種（相見積依頼の trade_name）と部位（estimate_quote_lines.part）。候補を区分＋部位で絞る鍵。無ければ名前から推定 */
  tradeName?: string | null
  part?: string | null
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

export type PriceSheetResult = {
  priceRows: number; candidates: number
  /** E-2: 区分（＋部位）別の候補列を書いた数と、名称の入力規則を「行の区分で絞る式」に切り替えたか */
  tradeColumns: number; filteredValidation: boolean
}

/** 候補表の「区分|部位」列の見出し。空の部位は末尾が '|' */
export const candidateHeader = (trade: string, part: string) => `${tradeKey(trade)}|${part}`
/** 候補表で区分なし（単価履歴に工種が無い）名前を置く列の見出し */
export const NO_TRADE_HEADER = '（区分なし）|'

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
  fmt: EstimateFormat = SEED_FORMAT,
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

  // ── E-2: 区分（＋部位）別の候補列（B列以降・見出し行1＝「区分|部位」）──
  //  大塚「軽鉄工事だけに絞った項目が欲しい」「天井の項目と壁の項目と分かれているとありがたい」。
  //  1セルに付けられるドロップダウンは1つなので、名称の入力規則を「その行の工事区分・部位の列」を
  //  指す式にする（下）。列は Excel の MATCH で見出しから引くので、並び順は問わない。
  //  ★単価履歴の工種（tradeName）で振り分け、部位は履歴の part → 無ければ名前の語で推定。
  //   部位なし（'|'）の列にはその区分の全件を入れる（部位を選ばない行の候補）。
  const tradeNames = opts.trades.map(tradeKey)
  const byTrade = new Map<string, Set<string>>()   // header → names
  const put = (header: string, name: string) => { if (!byTrade.has(header)) byTrade.set(header, new Set()); byTrade.get(header)!.add(name) }
  for (const tr of tradeNames) { put(candidateHeader(tr, ''), '__init__'); for (const pt of PARTS) put(candidateHeader(tr, pt), '__init__') }
  put(NO_TRADE_HEADER, '__init__')
  const seenName = new Map<string, { trade: string; part: string }>()
  for (const p of rows) {
    const tr = tradeKey(p.tradeName ?? '')
    const known = tr && tradeNames.includes(tr) ? tr : ''
    const pt = normalizePart(p.part ?? '') || guessPart(p.workName)
    const cur = seenName.get(p.workName)
    // 同じ名前は最初に見つかった区分を採る（履歴の工種が割れている時は上の行＝最新が勝つ）
    if (!cur) seenName.set(p.workName, { trade: known, part: pt })
  }
  for (const nm of opts.extraNames ?? []) if (!seenName.has(nm)) seenName.set(nm, { trade: '', part: guessPart(nm) })
  for (const [name, { trade, part }] of seenName) {
    if (!trade) { put(NO_TRADE_HEADER, name); continue }
    put(candidateHeader(trade, ''), name)
    if (part) put(candidateHeader(trade, part), name)
  }
  // 列の並び（テンプレ v2・make-estimate-template.py と対）: A=全候補／B=区分一覧／C=部位一覧／D〜=「区分|部位」別
  cand['B1'] = '区分一覧'; cand['C1'] = '部位一覧'
  for (let i = 0; i < MAX; i++) { cand[`B${2 + i}`] = tradeNames[i] ?? null; cand[`C${2 + i}`] = PARTS[i] ?? null }
  let col = 4   // D
  for (const [header, set] of byTrade) {
    const list = [...set].filter((n) => n !== '__init__').sort((a, b) => a.localeCompare(b, 'ja'))
    const L = colLetter(col)
    cand[`${L}1`] = header
    for (let i = 0; i < MAX; i++) cand[`${L}${2 + i}`] = list[i] ?? null
    col++
  }
  await t.writeCells('候補表', cand)
  // AA/AB 列のドロップダウン（テンプレ側の promptTitle が「区分一覧」「部位一覧」）を実件数ぴったりの直接参照に
  await t.replaceValidationSource(MAIN_SHEET_FOR_DV, '区分一覧', `'候補表'!$B$2:$B$${Math.max(2, tradeNames.length + 1)}`)
  await t.replaceValidationSource(MAIN_SHEET_FOR_DV, '部位一覧', `'候補表'!$C$2:$C$${PARTS.length + 1}`)

  // ★名称のドロップダウン。
  //  v1（工事区分列なし）: 「実件数ぴったりの直接参照」。Excel の入力補完（打ち込むと絞り込まれる）は
  //   直接の範囲参照でしか効かず、OFFSET 等の動的範囲では効かないことを実測で確認している。
  //  v2（工事区分列あり・E-2）: その行の Q（区分）・R（部位）で候補表の列を引く式に切り替える。
  //   INDIRECT+ADDRESS で「単純な範囲参照」に解決させ、区分が空・未登録なら全候補（A列）に落とす。
  //   ★入力補完がこの式で効くかは実機 Excel で確認（効かなければ v1 の直接参照へ戻す判断）。
  const lastRow = Math.max(2, all.length + 1)
  const hasTradeColumn = await mainSheetHasTradeColumn(t, fmt)
  let filtered = false
  if (hasTradeColumn && fmt.col.trade && fmt.col.part) {
    const Q = fmt.col.trade, R = fmt.col.part
    const key = (row: number) => `$${Q}${row}&"|"&$${R}${row}`
    const n = await t.replaceValidationSourceBySqref(MAIN_SHEET_FOR_DV, NAME_DV_MATCH, (firstRow) =>
      `IFERROR(INDIRECT("'候補表'!"&ADDRESS(2,MATCH(${key(firstRow)},'候補表'!$1:$1,0))&":"&ADDRESS(${MAX + 1},MATCH(${key(firstRow)},'候補表'!$1:$1,0))),'候補表'!$A$2:$A$${lastRow})`)
    filtered = n > 0
  }
  if (!filtered) await t.replaceValidationSource(MAIN_SHEET_FOR_DV, NAME_DV_MATCH, `'候補表'!$A$2:$A$${lastRow}`)

  return { priceRows: rows.length, candidates: all.length, tradeColumns: byTrade.size, filteredValidation: filtered }
}

/** 全体見積に「工事区分」列があるか（テンプレ v2）。見出し行（明細の上）に「工事区分」と書いてあるかで判定 */
export async function mainSheetHasTradeColumn(t: XlsxTemplate, fmt: EstimateFormat = SEED_FORMAT): Promise<boolean> {
  if (!fmt.col.trade) return false
  const cells = await t.readSheet(fmt.mainSheet)
  for (let r = 1; r < fmt.firstRow; r++) {
    if (str(cells.get(`${fmt.col.trade}${r}`) ?? null).replace(/[\s　]/g, '') === '工事区分') return true
  }
  return false
}
