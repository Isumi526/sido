// ============================================================
//  admin.estimate-drawing-extract.spec.ts
//  案件情報の図面から材料（メーカー品番）を抽出して明細に流し込む
//
//  これまでは独立ページ /drawing-materials でしか使えず、
//  ・案件に紐づかない ・出口がCSV書き出しだけ（見積への反映は手動）
//  だったため、抽出した品番を明細に手で打ち直していた。
//
//  ★全件を自動投入しない。実図面には「(仮)」の品番や、中止になったのに
//   綴じられたままの詳細図が混ざる（NOW/HERE北新宿の図面で確認済み: F-5/F-11/F-14 が中止）。
//   機械的に入れると中止項目を過大計上するので、人が選んだ行だけを入れる。
//
//  ★解析AI(Gemini)は非決定・課金されるので呼ばない。EFの応答を差し替えて
//   「抽出結果を明細に入れる」までの流れを決定的に検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const PROJ = `E2E図面抽出_${TS}`
let projId = ''

/** ページ番号入りの最小PDF（3ページ） */
function makePdf(pages: number): Buffer {
  const objs: string[] = []
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  for (let i = 0; i < pages; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`)
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefAt = body.length
  const size = objs.length + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  return Buffer.from(body + xref + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, name: PROJ }),
  })
  projId = pj[0].id
})

test.afterAll(async () => {
  await restSrv(`estimate_items?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_project_attachments?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
})

/**
 * 図面を1件添付して抽出を走らせ、結果パネルを開く。EFの応答は差し替える。
 * ★R53（2026-07-30）以降、抽出はモーダルではなく裏で走るジョブになった。
 *  「材料を抽出」＝その場で開始 → 終わると「抽出結果を見る」に変わる、という流れ。
 */
async function openExtractModal(page: any, label: string) {
  // 1ページ目=正規の品番2件（1件は「(仮)」）／2ページ目=中止の詳細図／3ページ目=なし
  const byPage: Record<number, any[]> = {
    1: [
      { part: 'ガラススリット受金物', manufacturer: '杉田エース', code: 'GS-201', size: 'L2000', spec: '上下', quantity: '4' },
      { part: '壁面仕上げ', manufacturer: '3M', code: 'DI-NOC-WG846(仮)', size: '1220幅', spec: 'ダイノックシート', quantity: '2', note: '(仮)品番・要確認' },
    ],
    2: [{ part: 'F-5 家具', manufacturer: 'メーカー未定', code: 'F-5', size: '', spec: '', quantity: '1', note: '中止' }],
    3: [],
  }
  await page.route('**/functions/v1/drawing-material-extract', async (route: any) => {
    const body = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, page: body.page, rows: byPage[body.page] ?? [] }) })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  // ★ファイル名はテストごとに変える。同名だと前のテストで上げた行で
  //  toContainText が即通ってしまい、まだ登録されていない添付のIDを掴む（実際に踏んだ）。
  const fileName = `E2E実施図面_${label}.pdf`
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: fileName, mimeType: 'application/pdf', buffer: makePdf(3),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText(fileName, { timeout: 20000 })
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${projId}&name=eq.${encodeURIComponent(fileName)}&select=id`)
  const attId = att[0].id
  // 押した時点で解析が始まる（モーダルで操作を奪わない）
  await page.locator(`[data-testid="dext-open-${attId}"]`).click()
  // 完了すると「抽出結果を見る」に変わる → 開く
  const result = page.locator(`[data-testid="dext-result-${attId}"]`)
  await expect(result).toBeVisible({ timeout: 40000 })
  await result.click()
  await expect(page.locator('[data-testid="dext-panel"]')).toBeVisible()
}

test('AC1★: 案件の図面から材料を抽出でき、既定ではどれも選択されていない', async ({ page }) => {
  await openExtractModal(page, 'ac1')

  // 3ページ分を1ページずつ解析して結果が並ぶ（1ページ目2件＋2ページ目1件）
  await expect(page.locator('[data-testid="dext-row-2"]')).toBeVisible({ timeout: 30000 })
  // 品番は誤読を直せる入力欄なので値で見る
  await expect(page.locator('[data-testid="dext-code-0"]')).toHaveValue('GS-201')
  await expect(page.locator('[data-testid="dext-panel"]')).toContainText('中止')   // 備考は素のテキスト

  // ★既定はどれもオフ（中止項目や「(仮)」を勢いで入れさせない）
  for (const i of [0, 1, 2]) await expect(page.locator(`[data-testid="dext-pick-${i}"]`)).not.toBeChecked()
  await expect(page.locator('[data-testid="dext-apply"]')).toBeDisabled()
})

test('AC2★: 選んだ行だけが明細に入る（中止項目は入らない）', async ({ page }) => {
  await openExtractModal(page, 'ac2')
  await expect(page.locator('[data-testid="dext-row-2"]')).toBeVisible({ timeout: 30000 })

  // 1件目（正規）だけ選ぶ。2件目=「(仮)」、3件目=中止 は選ばない
  await page.locator('[data-testid="dext-pick-0"]').check()
  await expect(page.locator('[data-testid="dext-apply"]')).toContainText('選んだ 1 件')
  await page.locator('[data-testid="dext-apply"]').click()
  await expect(page.locator('[data-testid="dext-msg"]')).toContainText('1件を明細に入れました', { timeout: 15000 })

  // ★DB: 選んだ1件だけが入り、品番・形状・数量が引き継がれる
  await expect.poll(async () => {
    const it = await restSrv(`estimate_items?project_id=eq.${projId}&select=item_name,product_code,spec,quantity&order=sort_order`)
    return (it ?? []).length
  }, { timeout: 15000 }).toBe(1)
  const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=item_name,product_code,spec,quantity`)
  expect(items[0].product_code, '品番が入る').toBe('GS-201')
  expect(items[0].item_name).toContain('杉田エース')
  expect(items[0].spec, '規格サイズと仕様が形状・詳細に入る').toBe('L2000 / 上下')
  expect(Number(items[0].quantity), '数量が引き継がれる').toBe(4)
  // 中止項目は入っていない
  const all = items.map((x: any) => x.product_code)
  expect(all, '中止の詳細図は入れない').not.toContain('F-5')
})

test('AC3: 明細に入れた行は材料として扱われる（品番があるので商社と商品情報が出る）', async ({ page }) => {
  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
  // AC2で入れた行が1行目にある
  await expect(page.locator('[data-testid="item-code-0"]')).toHaveValue('GS-201', { timeout: 15000 })
  await expect(page.locator('[data-testid="item-pinfo-ask-0"]')).toBeVisible()
  await expect(page.locator('[data-testid="item-supplier-na-0"]')).toHaveCount(0)
})
