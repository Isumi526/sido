// ============================================================
//  admin.estimate-excel.spec.ts
//  見積Excel連携：空テンプレ → 書き出し → 積算 → 取り込み → 工種別生成
//
//  ★何を守るか（2026-09-09〜10 に実装・実物のExcelから設計）
//   既存のExcelを捨てさせない前提の機能なので、**Excelの体裁を壊さないこと**が
//   一番の要件になる。過去に踏んだ壊れ方:
//     - 画像/図形が落ち、[Content_Types].xml の Default宣言まで消えて
//       Excelが「修復または削除」を要求する（＝静かに壊れる）
//     - ふりがな(<rPh>)を本文と一緒に読んで名称が汚れる
//     - 1セルに複数のドロップダウンを付けてファイルが壊れる
//   なので「読める」「書ける」だけでなく **元ファイルとバイト単位で比べて
//   触っていない部分が変わっていないこと** まで見る。
//
//  ★工種別への組み替えが本題。
//   全体見積は場所軸（（壁面工事）→ ■軽鉄工事 → 明細）で並ぶが、
//   発注は工種ごとに業者が分かれるため工種軸へ集め直す必要がある。
//   同じ工種が複数の場所に散っているのを1シートに集められるかを見る。
// ============================================================
import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
// jszip は admin の依存（ルートには無い）。テストはルートから走るので解決先を指定する。
const JSZip = createRequire(join(process.cwd(), 'apps/admin/package.json'))('jszip')

const SRC = '/Users/ism526/Documents/sido/0603　銀座りシャール見積もり.xlsx'

test.skip(!existsSync(SRC), '見本のExcelがこの環境に無いためスキップ')

/** ブラウザ内でライブラリを動かす。実際に画面が使うコードパスをそのまま通す。 */
async function runInPage<T>(page: any, b64: string, fn: string): Promise<T> {
  await page.goto('/estimate-excel', { waitUntil: 'networkidle' })
  return page.evaluate(async ([data, code]: string[]) => {
    const bin = atob(data)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    const mods = await Promise.all([
      import('/src/lib/xlsxCells.ts'),
      import('/src/lib/estimateExcel.ts'),
    ])
    // eslint-disable-next-line no-new-func
    return await new Function('cells', 'est', 'buf', `return (async () => { ${code} })()`)(mods[0], mods[1], buf)
  }, [b64, fn])
}

const b64 = () => readFileSync(SRC).toString('base64')

// ── E-2: テンプレ v2（工事区分・部位列＋単価表・候補表）を scripts/make-estimate-template.py で作る（見本から）。
//  作れない環境（python3/openpyxl 無し）では v2 依存の test だけスキップ。
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const TPL_V2 = join(process.cwd(), 'tests/e2e/.artifacts/seed-v2-template.xlsx')
function buildTemplateV2(): boolean {
  try {
    mkdirSync(join(process.cwd(), 'tests/e2e/.artifacts'), { recursive: true })
    execFileSync('python3', [join(process.cwd(), 'scripts/make-estimate-template.py'), SRC, TPL_V2], { stdio: 'pipe', timeout: 120000 })
    return existsSync(TPL_V2)
  } catch { return false }
}
const b64v2 = () => readFileSync(TPL_V2).toString('base64')

test.describe('見積Excel連携', () => {
  test('★全体見積の3層（場所/工種/明細）を分解できる', async ({ page }) => {
    const r = await runInPage<any>(page, b64(), `
      const t = await cells.XlsxTemplate.load(buf)
      const rows = await est.parseEstimate(t)
      return {
        count: rows.length,
        first: rows[0],
        locations: [...new Set(rows.map(x => x.location))],
      }
    `)
    expect(r.count, '明細が拾える').toBeGreaterThan(30)
    // ★ふりがな(<rPh>)が混ざっていないこと。混ざると「壁面 外周LGS間仕切ヘキメンガイシュウ」になる
    expect(r.first.name, 'ふりがなが混ざっていない').toBe('壁面　外周LGS間仕切')
    expect(r.first.location).toBe('壁面工事')
    expect(r.first.trade).toBe('軽鉄工事')
    expect(r.first.quantity).toBe(197)
    expect(r.first.costUnitPrice).toBe(2700)
    expect(r.locations).toContain('天井工事')
  })

  test('★同じ工種が複数の場所に散っていても1つに集約される', async ({ page }) => {
    const r = await runInPage<any>(page, b64(), `
      const t = await cells.XlsxTemplate.load(buf)
      const rows = await est.parseEstimate(t)
      const g = est.groupByTrade(rows)
      const k = g.get('軽鉄工事') ?? []
      return { count: k.length, locations: [...new Set(k.map(x => x.location))].sort() }
    `)
    // 実物では 壁面工事(r5〜) と 天井工事(r39〜) の2箇所に軽鉄工事がある。
    // 並び順は問わない（集められていることが要件）。
    expect(new Set(r.locations), '★2つの場所から集めている').toEqual(new Set(['壁面工事', '天井工事']))
    expect(r.count).toBe(18)
  })

  test('★工種別シートを生成しても、触っていない部分は1バイトも変わらない', async ({ page }) => {
    const out = await runInPage<string>(page, b64(), `
      const t = await cells.XlsxTemplate.load(buf)
      const rows = await est.parseEstimate(t)
      await est.writeTradeSheets(t, rows)
      await t.forceRecalcOnLoad()
      const u8 = await t.toUint8Array()
      let s = ''
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
      return btoa(s)
    `)
    const a = await JSZip.loadAsync(readFileSync(SRC))
    const b = await JSZip.loadAsync(Buffer.from(out, 'base64'))
    const na = Object.keys(a.files).filter((n) => !a.files[n].dir)
    // ★b側はフォルダ項目も落とさずに見る。jszip は 'xl/' のようなフォルダ項目を
    //  勝手に足すが、Excelが書いた xlsx には無く Content-Type 宣言も無い。
    //  余計な差分を持ち込まないことまで固定する。
    const nbAll = Object.keys(b.files)
    const nb = nbAll.filter((n) => !b.files[n].dir)

    // ★画像・図形・スタイルが消えていないこと（消えるとExcelが修復を要求する）
    expect(nb.sort(), '元のエントリが1つも欠けていない').toEqual(na.sort())
    expect(nbAll.sort(), '元に無いエントリが増えていない').toEqual(na.sort())
    expect(nb, '表紙の画像が残っている').toContain('xl/media/image1.jpeg')

    const changed: string[] = []
    for (const n of na) {
      const x = await a.files[n].async('uint8array')
      const y = await b.files[n].async('uint8array')
      if (Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) changed.push(n)
    }
    // 変わるのは書き込んだ工種別シートと、再計算指定を入れた workbook.xml だけ
    expect(changed.every((n) => n.startsWith('xl/worksheets/sheet') || n === 'xl/workbook.xml'),
      `想定外のエントリが変わった: ${changed.join(', ')}`).toBe(true)
    expect(changed.length, '変更は書き込んだ分だけ').toBeLessThanOrEqual(8)
  })

  test('★入りきらない行は黙って捨てず overflow として返す', async ({ page }) => {
    const r = await runInPage<any>(page, b64(), `
      const t = await cells.XlsxTemplate.load(buf)
      const rows = await est.parseEstimate(t)
      // 枠(24行)を超える工種を人工的に作る
      const many = [...rows]
      for (let i = 0; i < 30; i++) many.push({ ...rows[0], name: '増やした行' + i, sourceRow: 200 + i })
      const res = await est.writeTradeSheets(t, many)
      return { overflow: res.overflow, written: res.written.map(w => w.count) }
    `)
    expect(r.overflow.length, '★あふれを報告する').toBeGreaterThan(0)
    expect(r.overflow[0].needed).toBeGreaterThan(r.overflow[0].capacity)
    // ★枠を超えて書き込まない（合計式が行を手書きで並べているため、はみ出すと合計から外れる）
    expect(Math.max(...r.written), '枠を超えて書いていない').toBeLessThanOrEqual(24)
  })

  test('★単価表は作業内容の昇順で、業者ごとに最新1件になる', async ({ page }) => {
    const r = await runInPage<any>(page, b64(), `
      const rows = [
        { workName: '天井 下地組', unitPrice: 2300, vendorName: 'グランディール', quotedOn: '2025-05-07' },
        // ★古い方を先に置く。「最初に見たものを採る」実装だと 9999 が残って落ちる
        { workName: '天井 下地組', unitPrice: 9999, vendorName: 'ジング',        quotedOn: '2020-01-01' },
        { workName: '天井 下地組', unitPrice: 1200, vendorName: 'ジング',        quotedOn: '2025-09-20' },
        { workName: '壁面 PB貼',   unitPrice: 1400, vendorName: 'ジング',        quotedOn: '2025-09-20' },
      ]
      const latest = est.latestPerVendor(rows)
      return {
        latest: latest.map(x => x.vendorName + ':' + x.unitPrice).sort(),
        label: est.priceLabel(rows[2]),
      }
    `)
    // ★同じ業者×作業内容は最新だけ（古い9999は消える）
    expect(r.latest).toEqual(['グランディール:2300', 'ジング:1200', 'ジング:1400'])
    // ★選択肢に業者・単価・提示日が並ぶ（打ち合わせ②「比較比べてここが一番安いなとか」）
    expect(r.label).toContain('ジング')
    expect(r.label).toContain('1,200')
    expect(r.label).toContain('2025-09-20')
  })

  test('画面が開き、単価履歴の件数が出る', async ({ page }) => {
    await page.goto('/estimate-excel', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('見積Excel連携')
    await expect(page.getByTestId('ee-price-count')).toBeVisible({ timeout: 15000 })
  })

  test('★名称のドロップダウンは「実件数ぴったりの直接参照」になる', async ({ page }) => {
    const r = await runInPage<any>(page, b64(), `
      const t = await cells.XlsxTemplate.load(buf)
      // テンプレの体裁だけ借りて、候補を書き込む
      if (!t.has('候補表')) return { skipped: true }
      const prices = [
        { workName: '天井 下地組', unitPrice: 1200, vendorName: 'ジング', quotedOn: '2025-09-20' },
        { workName: '壁面 PB貼',   unitPrice: 1400, vendorName: 'ジング', quotedOn: '2025-09-20' },
      ]
      const res = await est.writePriceSheets(t, prices, { locations: ['（壁面工事）'], trades: ['■軽鉄工事'] })
      // 書き換え後の参照を、同じ条件でもう一度当てて件数を数える
      const hit = await t.replaceValidationSource('全体見積', '候補表', "'候補表'!$A$2:$A$" + (res.candidates + 1))
      return { candidates: res.candidates, hit }
    `)
    if (r.skipped) return
    // ★Excelの入力補完は直接の範囲参照でしか効かない（OFFSET等の数式では効かない）。
    //  書き換えが当たっていること＝参照が実件数ぴったりに保たれていること。
    expect(r.hit, '名称の入力規則を書き換えている').toBe(1)
    expect(r.candidates, '場所1＋工種1＋作業内容2').toBe(4)
  })

  // ── E-2（2026-09-20・設計書 §5 段階 E-2・確認事項1=A 仮置き）──
  test('★E-2: 行の「工事区分」「部位」列が入っていればそれを正とし、空なら■見出しから推定する', async ({ page }) => {
    const r = await runInPage<any>(page, b64(), `
      const t = await cells.XlsxTemplate.load(buf)
      const before = await est.parseEstimate(t)
      // 明細の先頭2行に工事区分・部位を書く（テンプレ v2 の列 Q/R）。3行目はわざと別の区分にして列が勝つことを見る
      const rows0 = before.slice(0, 3)
      const w = {}
      w['AA' + rows0[0].sourceRow] = '■' + rows0[0].trade; w['AB' + rows0[0].sourceRow] = '天井'
      w['AA' + rows0[1].sourceRow] = rows0[1].trade;       w['AB' + rows0[1].sourceRow] = '壁面'
      w['AA' + rows0[2].sourceRow] = '塗装工事';            w['AB' + rows0[2].sourceRow] = 'なし'
      await t.writeCells('全体見積', w)
      const after = await est.parseEstimate(t)
      return {
        headingTrade: rows0[2].trade,
        r0: { trade: after[0].trade, part: after[0].part, src: after[0].tradeSource },
        r1: { trade: after[1].trade, part: after[1].part, src: after[1].tradeSource },
        r2: { trade: after[2].trade, part: after[2].part, src: after[2].tradeSource },
        r3src: after[3].tradeSource,
        count: after.length, countBefore: before.length,
      }
    `)
    expect(r.count).toBe(r.countBefore)
    expect(r.r0.src).toBe('column'); expect(r.r0.part).toBe('天井'); expect(r.r0.trade).not.toMatch(/^■/)
    expect(r.r1.src).toBe('column'); expect(r.r1.part, '「壁面」→壁に正規化').toBe('壁')
    expect(r.r2.src).toBe('column'); expect(r.r2.trade, '列が見出しより優先').toBe('塗装工事'); expect(r.r2.part, '「なし」は空').toBe('')
    expect(r.r2.trade).not.toBe(r.headingTrade)
    expect(r.r3src, '列が空の行は見出しから').toBe('heading')
  })

  test('★E-2: 候補表に区分（＋部位）別の列ができ、工事区分列があるテンプレでは名称の入力規則が行の区分で絞る式になる', async ({ page }) => {
    test.skip(!buildTemplateV2(), 'テンプレ v2 をこの環境では作れない（python3/openpyxl）')
    const r = await runInPage<any>(page, b64v2(), `
      const t = await cells.XlsxTemplate.load(buf)
      if (!t.has('候補表')) return { skipped: true }
      const prices = [
        { workName: '天井 下地組',   unitPrice: 1200, vendorName: 'ジング', quotedOn: '2025-09-20', tradeName: '軽鉄工事' },
        { workName: '壁面 PB貼',     unitPrice: 1400, vendorName: 'ジング', quotedOn: '2025-09-20', tradeName: '軽鉄工事', part: '壁' },
        { workName: '天井 塗装 EP',  unitPrice: 900,  vendorName: 'ペンキ屋', quotedOn: '2025-09-20', tradeName: '■塗装工事' },
        { workName: '雑工事 その他', unitPrice: 500,  vendorName: 'よろず', quotedOn: '2025-09-20' },
      ]
      // v1 相当（AA2 の「工事区分」見出しを消す）→ 従来の直接参照
      await t.writeCells('全体見積', { AA2: null, AB2: null })
      const res1 = await est.writePriceSheets(t, prices, { locations: ['（壁面工事）'], trades: ['■軽鉄工事', '■塗装工事'] })
      // v2（見出しを戻す）→ 行の区分で絞る式
      await t.writeCells('全体見積', { AA2: '工事区分', AB2: '部位' })
      const res2 = await est.writePriceSheets(t, prices, { locations: ['（壁面工事）'], trades: ['■軽鉄工事', '■塗装工事'] })
      const cand = await t.readSheet('候補表')
      const col = (h) => { for (const [ref, v] of cand) if (/^[A-Z]+1$/.test(ref) && v === h) return ref.replace(/1$/, ''); return null }
      const list = (h) => { const c = col(h); if (!c) return null; const out = []; for (let r = 2; r < 40; r++) { const v = cand.get(c + r); if (v) out.push(v) } return out }
      // 入力規則の中身（名称＝行の区分で絞る式／AA・AB＝実件数ぴったり）
      const sheetXml = await t.debugSheetXml('全体見積')
      const dvs = [...sheetXml.matchAll(/<dataValidation\\b[^>]*sqref="([^"]+)"[^>]*>([\\s\\S]*?)<\\/dataValidation>/g)].map(m => ({ sqref: m[1], f: (/<formula1>([\\s\\S]*?)<\\/formula1>/.exec(m[2]) || [])[1] || '' }))
      return {
        v1: res1.filteredValidation, v2: res2.filteredValidation, cols: res2.tradeColumns, dvs,
        keitetsuAll: list('軽鉄工事|'), keitetsuTenjo: list('軽鉄工事|天井'), keitetsuKabe: list('軽鉄工事|壁'),
        tosoTenjo: list('塗装工事|天井'), none: list('（区分なし）|'), tradeList: list('区分一覧'), partList: list('部位一覧'),
      }
    `)
    if (r.skipped) return
    expect(r.v1, '工事区分列が無いテンプレは従来の直接参照').toBe(false)
    expect(r.v2, '工事区分列があるテンプレは行の区分で絞る式').toBe(true)
    const nameDv = r.dvs.find((d: any) => d.sqref.startsWith('B3'))
    expect(nameDv?.f, '名称の規則は AA/AB を鍵に候補表の列を引き、外れたら全候補へ').toMatch(/^IFERROR\(INDIRECT\(.*\$AA3&amp;"\|"&amp;\$AB3.*'候補表'!\$A\$2:\$A\$\d+\)$/)
    expect(r.dvs.find((d: any) => d.sqref.startsWith('AA3'))?.f, '工事区分の規則は区分一覧ぴったり').toBe("'候補表'!$B$2:$B$3")
    expect(r.dvs.find((d: any) => d.sqref.startsWith('AB3'))?.f, '部位の規則は天井/壁/床').toBe("'候補表'!$C$2:$C$4")
    expect([...r.keitetsuAll].sort(), '区分の全件（部位なし列）').toEqual(['壁面 PB貼', '天井 下地組'].sort())
    expect(r.keitetsuTenjo, '部位は名前から推定').toEqual(['天井 下地組'])
    expect(r.keitetsuKabe, '履歴の part を優先').toEqual(['壁面 PB貼'])
    expect(r.tosoTenjo, '■付きの trade_name も寄せる').toEqual(['天井 塗装 EP'])
    expect(r.none, '工種が無い履歴は区分なし列').toEqual(['雑工事 その他'])
    expect(r.tradeList).toEqual(['軽鉄工事', '塗装工事'])
    expect(r.partList).toEqual(['天井', '壁', '床'])
  })

  test('★E-2: 1工種だけ抜き出せる（他の工種別シートは触らない）', async ({ page }) => {
    const r = await runInPage<any>(page, b64(), `
      const t = await cells.XlsxTemplate.load(buf)
      const rows = await est.parseEstimate(t)
      const trades = [...est.groupByTrade(rows).keys()].filter(tr => est.SEED_FORMAT.tradeSheets[tr] && t.has(est.SEED_FORMAT.tradeSheets[tr]))
      const pick = trades[0]; const other = trades[1]
      const otherSheet = est.SEED_FORMAT.tradeSheets[other]
      const beforeOther = await t.readSheet(otherSheet)
      const res = await est.writeTradeSheets(t, rows, est.SEED_FORMAT, { trades: [pick] })
      const afterOther = await t.readSheet(otherSheet)
      const same = [...beforeOther].every(([k, v]) => afterOther.get(k) === v) && beforeOther.size === afterOther.size
      const pickSheet = await t.readSheet(est.SEED_FORMAT.tradeSheets[pick])
      const expectedFirst = est.groupByTrade(rows).get(pick)[0].name
      return { pick, other, written: res.written.map(w => w.trade), same, first: pickSheet.get('B' + est.SEED_FORMAT.tradeSheetRows.first), expectedFirst }
    `)
    expect(r.written, '選んだ1工種だけ').toEqual([r.pick])
    expect(r.same, '他の工種別シートは1セルも変わらない').toBe(true)
    expect(r.first, '選んだ工種の明細が書かれる').toBe(r.expectedFirst)
  })
})
