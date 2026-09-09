// ============================================================
//  lib/xlsxCells.ts
//  既存の .xlsx を「テンプレート」として扱い、セルの値だけを読み書きする。
//
//  ★なぜ専用の実装が要るか（2026-09-09・実測で確認した罠）
//   見積Excelは 28シート・数式・罫線・結合セル・印刷範囲・表紙の画像で出来ていて、
//   これは会社の資産そのもの（元請けから様式を指定されることもある）。
//   汎用ライブラリで読んで書き直すと、この体裁が壊れる:
//     - xlsx(SheetJS) の community 版は数式・書式を保持しない
//     - openpyxl / ExcelJS 系は **画像と図形を落とす**。しかも
//       [Content_Types].xml の `<Default Extension="jpeg">` まで一緒に消えるため、
//       パーツが全部揃っていても Excel が「修復または削除」を要求する＝静かに壊れる。
//   そこで「zip の中の、値を書き換えるセルの XML だけを差し替え、
//   他のバイトには一切触らない」方式にした。壊しようがないのが利点。
//
//  ★書き込みは inlineStr を使う（sharedStrings.xml を触らない）
//   共有文字列表に足すと索引の張り替えが必要になり、他のセルを壊しうる。
//   inlineStr なら1セルの中で完結する。Excel は両方を受け付ける。
//
//  ★このモジュールはシートを追加しない。
//   単価表シート・分類表シート・ドロップダウンは「テンプレ登録時に1回だけ」
//   仕込んでおく運用にした（会社ごとに1回）。実行時は値の読み書きだけになる。
// ============================================================
import JSZip from 'jszip'

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export type CellValue = string | number | null

/** A1 形式 → {col, row}。col は 1 始まり。 */
export function parseRef(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) throw new Error(`セル参照が不正です: ${ref}`)
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col, row: Number(m[2]) }
}

/** 1 始まりの列番号 → A, B, … AA */
export function colLetter(col: number): string {
  let s = ''
  let n = col
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

export const cellRef = (col: number, row: number) => `${colLetter(col)}${row}`

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** xlsx を開いて、シート名 → シートXMLのパス を解決する。 */
export class XlsxTemplate {
  private constructor(
    private zip: JSZip,
    private sheetPath: Map<string, string>,
    private sharedStrings: string[],
  ) {}

  static async load(data: ArrayBuffer | Uint8Array | Blob): Promise<XlsxTemplate> {
    const zip = await JSZip.loadAsync(data as any)
    const wbXml = await zip.file('xl/workbook.xml')!.async('string')
    const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')

    const idToTarget = new Map<string, string>()
    for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1]
      const target = /Target="([^"]+)"/.exec(m[0])?.[1]
      if (id && target) idToTarget.set(id, target)
    }
    const sheetPath = new Map<string, string>()
    for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
      const name = /name="([^"]+)"/.exec(m[0])?.[1]
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1]
      if (!name || !rid) continue
      const t = idToTarget.get(rid)
      if (!t) continue
      // Target は "worksheets/sheet1.xml"（xl 相対）か "/xl/worksheets/sheet1.xml"（絶対）
      const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`
      sheetPath.set(decodeXmlAttr(name), path)
    }

    // 読み取り用に共有文字列を展開（書き込みでは使わない）
    const shared: string[] = []
    const ssFile = zip.file('xl/sharedStrings.xml')
    if (ssFile) {
      const ss = await ssFile.async('string')
      for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        // ★<rPh> はふりがな。ここを外さないと「（壁面工事）ヘキメンコウジ」のように
        //  本文とルビが連結されて読めてしまう（取り込んだ名称が全部汚れる）。
        const body = si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
        let text = ''
        for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += unescapeXml(t[1])
        shared.push(text)
      }
    }
    return new XlsxTemplate(zip, sheetPath, shared)
  }

  sheetNames(): string[] { return [...this.sheetPath.keys()] }
  has(sheet: string): boolean { return this.sheetPath.has(sheet) }

  private pathOf(sheet: string): string {
    const p = this.sheetPath.get(sheet)
    if (!p) throw new Error(`シートが見つかりません: ${sheet}（存在するのは ${this.sheetNames().join(' / ')}）`)
    return p
  }

  /** シート全体を {A1: 値} で読む。数式セルは「計算結果」ではなく数式を返さず、値(<v>)を返す。 */
  async readSheet(sheet: string): Promise<Map<string, CellValue>> {
    const xml = await this.zip.file(this.pathOf(sheet))!.async('string')
    const out = new Map<string, CellValue>()
    for (const m of xml.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = m[1] ?? m[2] ?? ''
      const body = m[3] ?? ''
      const ref = /r="([^"]+)"/.exec(attrs)?.[1]
      if (!ref) continue
      const t = /t="([^"]+)"/.exec(attrs)?.[1]
      if (t === 'inlineStr') {
        let s = ''
        const plain = body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
        for (const x of plain.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += unescapeXml(x[1])
        if (s) out.set(ref, s)
        continue
      }
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      if (v == null) continue
      if (t === 's') { const s = this.sharedStrings[Number(v)]; if (s) out.set(ref, s) }
      else if (t === 'str' || t === 'e') out.set(ref, unescapeXml(v))
      else out.set(ref, Number(v))
    }
    return out
  }

  /**
   * セルに値を書く。**書式は既存セルのものをそのまま引き継ぐ**（s= 属性を温存）。
   * null を渡すと空にする（数式セルに null を書くと数式も消える点に注意）。
   */
  async writeCells(sheet: string, values: Record<string, CellValue>): Promise<void> {
    const path = this.pathOf(sheet)
    let xml = await this.zip.file(path)!.async('string')

    // 行ごとにまとめる（同じ行への複数セルを1回の書き換えで処理する）
    const byRow = new Map<number, { ref: string; col: number; value: CellValue }[]>()
    for (const [ref, value] of Object.entries(values)) {
      const { col, row } = parseRef(ref)
      const arr = byRow.get(row) ?? []
      arr.push({ ref, col, value })
      byRow.set(row, arr)
    }

    for (const [rowNum, cells] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
      cells.sort((a, b) => a.col - b.col)
      const rowRe = new RegExp(`<row\\b[^>]*\\br="${rowNum}"[^>]*(?:/>|>[\\s\\S]*?</row>)`)
      const rowM = rowRe.exec(xml)
      if (!rowM) { xml = insertRow(xml, rowNum, cells); continue }

      let rowXml = rowM[0]
      if (rowXml.endsWith('/>')) rowXml = rowXml.slice(0, -2) + '></row>'   // 空行 → 開閉タグへ

      for (const { ref, col, value } of cells) {
        const cellRe = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`)
        const cm = cellRe.exec(rowXml)
        const style = cm ? /\bs="(\d+)"/.exec(cm[0])?.[1] : undefined
        const next = buildCell(ref, value, style)
        if (cm) {
          rowXml = rowXml.slice(0, cm.index) + next + rowXml.slice(cm.index + cm[0].length)
        } else {
          rowXml = insertCellInRow(rowXml, col, next)
        }
      }
      xml = xml.slice(0, rowM.index) + rowXml + xml.slice(rowM.index + rowM[0].length)
    }
    this.zip.file(path, xml)
  }

  /**
   * 開いた時に全再計算させる（workbook.xml の calcPr に fullCalcOnLoad を立てる）。
   *
   * ★なぜ要るか: このモジュールは値だけを差し替えるので、数式セルに入っている
   *  「前回の計算結果(<v>)」と calcChain.xml は古いまま残る。原価(P列)を書き換えても
   *  金額(J列)が前の値のまま見えることがあり、**数字が合っていないのに整って見える**。
   *  取り込み〜生成のたびに呼ぶこと。
   */
  async forceRecalcOnLoad(): Promise<void> {
    const f = this.zip.file('xl/workbook.xml')
    if (!f) return
    let xml = await f.async('string')
    if (/<calcPr\b[^>]*\/>/.test(xml)) {
      xml = xml.replace(/<calcPr\b([^>]*)\/>/, (m, attrs) =>
        /fullCalcOnLoad/.test(attrs) ? m : `<calcPr${attrs} fullCalcOnLoad="1"/>`)
    } else {
      xml = xml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
    }
    this.zip.file('xl/workbook.xml', xml)
  }

  /** 保存。zip の他のエントリには一切触っていないので、画像も図形も数式もそのまま残る。 */
  async toBlob(): Promise<Blob> {
    this.dropFolderEntries()
    return this.zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  }
  async toUint8Array(): Promise<Uint8Array> {
    this.dropFolderEntries()
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  }

  /** JSZip が勝手に足すディレクトリ項目を落とす。
   *  Excel が書く xlsx には無く、[Content_Types].xml にも宣言が無いため、
   *  出力を元ファイルとバイト単位で揃えておく（余計な差分を持ち込まない）。 */
  private dropFolderEntries(): void {
    for (const [name, f] of Object.entries(this.zip.files)) {
      // ★zip.remove(name) はフォルダ配下を再帰的に消す。'xl/' に対して呼ぶと
      //  ブック全体が消える（実際に踏んだ）。files から直接落とすこと。
      if ((f as any).dir) delete (this.zip as any).files[name]
    }
  }
}

// ── XML 組み立て ─────────────────────────────────────────────
function buildCell(ref: string, value: CellValue, style?: string): string {
  const s = style ? ` s="${style}"` : ''
  if (value === null || value === '') return `<c r="${ref}"${s}/>`
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`
  // ★inlineStr。sharedStrings.xml を触らずに済ませるため。
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`
}

/** 行の中の、列順が保たれる位置にセルを挿す（Excel は列順が崩れた行を嫌う）。 */
function insertCellInRow(rowXml: string, col: number, cellXml: string): string {
  let insertAt = rowXml.lastIndexOf('</row>')
  for (const m of rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)) {
    if (parseRef(m[1]).col > col) { insertAt = m.index!; break }
  }
  return rowXml.slice(0, insertAt) + cellXml + rowXml.slice(insertAt)
}

/** 行そのものが無い場合に、行番号順を保って挿入する。 */
function insertRow(xml: string, rowNum: number, cells: { ref: string; value: CellValue }[]): string {
  const body = cells.map((c) => buildCell(c.ref, c.value)).join('')
  const rowXml = `<row r="${rowNum}">${body}</row>`
  let insertAt = -1
  for (const m of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g)) {
    if (Number(m[1]) > rowNum) { insertAt = m.index!; break }
  }
  if (insertAt >= 0) return xml.slice(0, insertAt) + rowXml + xml.slice(insertAt)
  const close = xml.lastIndexOf('</sheetData>')
  if (close < 0) throw new Error('sheetData が見つかりません')
  return xml.slice(0, close) + rowXml + xml.slice(close)
}

function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
function decodeXmlAttr(s: string): string { return unescapeXml(s) }
