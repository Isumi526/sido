// ============================================================
//  apps/admin/scripts/xlsx-roundtrip.test.mts
//  見積Excel の書き出し→取り込みの往復で、Excel が「修復」を求める壊れ方をしないことを確かめる（2026-10-02 見積E-6b）。
//
//  ★本物の見積Excel（会社の様式）は公開リポジトリに置けないので、同じ「壊れやすい部品」を持つ小さな見本を
//   ここで組み立てて使う: 数式・書式（s属性）・共有文字列・入力規則（ドロップダウン）・図形＋画像。
//  ★確かめること（lib/xlsxCells.ts を実際に通す）:
//   1. 書き込んだ後も、包みの宣言・行き先が揃っている（scripts/check-xlsx-package.mjs）
//   2. 書き換えたシート以外のパーツは1バイトも変わっていない（図形・画像・書式・共有文字列）
//   3. 書き換えたシートでも、数式・書式・入力規則・図形への参照が残っている
//   4. 書いた値が読み戻せる
//   5. 検査が「壊れた包み」を本当に見つける（宣言を1行消すと落ちる）
//  実行: cd apps/admin && node --experimental-strip-types scripts/xlsx-roundtrip.test.mts（CI: .github/workflows/xlsx-check.yml）
// ============================================================
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { XlsxTemplate } from '../src/lib/xlsxCells.ts'
// @ts-expect-error 型の無い .mjs
import { checkXlsxPackage } from '../../../scripts/check-xlsx-package.mjs'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b10000000049454e44ae426082', 'hex')
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function contentTypes(withPng = true): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>${withPng ? '\n<Default Extension="png" ContentType="image/png"/>' : ''}
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`
}

/** 見積Excelと同じ壊れやすい部品を持つ、小さな見本 */
async function buildFixture(withPng = true): Promise<Uint8Array> {
  const z = new JSZip()
  z.file('[Content_Types].xml', contentTypes(withPng))
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets><sheet name="全体見積" sheetId="1" r:id="rId1"/><sheet name="単価表" sheetId="2" r:id="rId2"/></sheets></workbook>`)
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`)
  z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN}"><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="0" numFmtId="3"/></cellXfs></styleSheet>`)
  z.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${MAIN}" count="2" uniqueCount="2"><si><t>名称</t></si><si><t>石膏ボード</t></si></sst>`)
  z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN}" xmlns:r="${R}"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c></row>
<row r="2"><c r="B2" s="1"><f>C2*2</f><v>0</v></c><c r="C2"><v>0</v></c></row>
<row r="3"><c r="A3" s="1"/><c r="N3" s="1"/></row>
</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="A3:A5"><formula1>単価表!$A$2:$A$3</formula1></dataValidation></dataValidations><drawing r:id="rId1"/></worksheet>`)
  z.file('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`)
  z.file('xl/worksheets/sheet2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN}"><sheetData><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3400</v></c></row></sheetData></worksheet>`)
  z.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="100" cy="100"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="logo"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`)
  z.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/image" Target="../media/image1.png"/></Relationships>`)
  z.file('xl/media/image1.png', PNG)
  return z.generateAsync({ type: 'uint8array' })
}

async function partsOf(bytes: Uint8Array): Promise<Map<string, Buffer>> {
  const z = await JSZip.loadAsync(bytes)
  const out = new Map<string, Buffer>()
  for (const name of Object.keys(z.files)) if (!z.files[name].dir) out.set(name, Buffer.from(await z.files[name].async('uint8array')))
  return out
}

let failed = 0
async function check(title: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`✓ ${title}`) } catch (e) { failed++; console.error(`✗ ${title}\n  ${(e as Error).message}`) }
}

const src = await buildFixture()
const tpl = await XlsxTemplate.load(src)
await tpl.writeCells('全体見積', { A3: '石膏ボード', N3: 12 })
await tpl.replaceValidationSource('全体見積', /単価表/, '単価表!$A$2:$A$9')
const out = await tpl.toUint8Array()

await check('見本そのものの包みが正しい（検査の前提）', async () => {
  assert.deepEqual(checkXlsxPackage(Buffer.from(src)), [])
})
await check('書き込んだ後も、包みの宣言・行き先が揃っている', async () => {
  assert.deepEqual(checkXlsxPackage(Buffer.from(out)), [])
})
await check('書き換えたシート以外は1バイトも変わっていない（図形・画像・書式・共有文字列・宣言）', async () => {
  const a = await partsOf(src)
  const b = await partsOf(out)
  assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort(), 'パーツの顔ぶれが同じ')
  for (const [name, buf] of a) {
    if (name === 'xl/worksheets/sheet1.xml') continue
    assert.ok(buf.equals(b.get(name)!), `${name} が変わった`)
  }
})
await check('書き換えたシートでも、数式・書式・入力規則・図形への参照が残っている', async () => {
  const xml = (await partsOf(out)).get('xl/worksheets/sheet1.xml')!.toString('utf8')
  assert.match(xml, /<c r="B2" s="1"><f>C2\*2<\/f>/, '数式と書式')
  assert.match(xml, /<dataValidation [^>]*sqref="A3:A5"><formula1>単価表!\$A\$2:\$A\$9<\/formula1>/, '入力規則（範囲を差し替えた）')
  assert.match(xml, /<drawing r:id="rId1"\/>/, '図形への参照')
  assert.match(xml, /<c r="A3" s="1"/, '書いたセルの書式が残る')
})
await check('書いた値が読み戻せる', async () => {
  const back = await (await XlsxTemplate.load(out)).readSheet('全体見積')
  assert.equal(back.get('A3'), '石膏ボード')
  assert.equal(Number(back.get('N3')), 12)
  assert.equal(back.get('A1'), '名称')
})
await check('検査が壊れた包みを見つける（画像の種類の宣言を消すと落ちる）', async () => {
  const broken = await buildFixture(false)
  const problems = checkXlsxPackage(Buffer.from(broken)) as string[]
  assert.ok(problems.some((p) => p.includes('xl/media/image1.png')), `見つけた問題: ${JSON.stringify(problems)}`)
})

if (failed) { console.error(`\n${failed} 件失敗`); process.exit(1) }
console.log('\nすべて OK')
