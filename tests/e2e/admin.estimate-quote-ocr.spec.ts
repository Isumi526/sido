// ============================================================
//  admin.estimate-quote-ocr.spec.ts
//  【見積R44】下請から受領した見積書PDFを読み取って単価を取り込む
//   - 添付した見積書から 項目・単位・単価 を読み取り、受領明細の「下書き」にする
//   - ★人が選んだ行だけ明細に入る（勝手に確定しない＝価格表OCRと同じ原則）
//   - ★単価の区分(材工共/労務のみ)が読めなかった行は空のまま＝人に選ばせる
//     （区分が違う業者を横並びにすると誤選定するため既定に倒さない）
//   - 確定は既存の「保存（単価履歴に記録）」を通す＝単価履歴に貯まる
//
//  ★AI(Gemini)は非決定・課金なので呼ばない。EFの応答を差し替えて流れを固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const PROJ = `E2E見積書OCR_${TS}`
const SUB = `E2EOCR業者_${TS}`
let accountId = ''
let projId = ''
let subId = ''
let reqId = ''

/** 最小PDF（1ページ） */
function makePdf(): Buffer {
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefAt = body.length
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  return Buffer.from(body + xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  projId = (await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: PROJ }),
  }))[0].id
  subId = (await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SUB, category: '業者', active: true }),
  }))[0].id
})

test.afterAll(async () => {
  const reqs = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id`).catch(() => [])
  for (const r of (reqs ?? [])) {
    await restSrv(`estimate_quote_lines?request_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_quote_files?request_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`estimate_quote_requests?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

/** 見積書を添付して読み取りを実行し、下書きパネルを開く。EF応答は差し替える */
async function attachAndRead(page: any, label: string) {
  await page.route('**/functions/v1/estimate-quote-ocr', async (route: any) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, page: 1,
        lines: [
          { item_name: '天井LGS下地組', spec: '@303', unit: '㎡', quantity: 71, unit_price: 2400, price_kind: 'material_labor', note: null },
          { item_name: '軽鉄工事 手間', spec: null, unit: '式', quantity: 1, unit_price: 180000, price_kind: 'labor', note: null },
          // ★区分が読めなかった行（人に選ばせる）
          { item_name: '雑材料', spec: null, unit: '式', quantity: 1, unit_price: 30000, price_kind: null, note: '要確認' },
        ],
      }),
    })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"]')
  // 依頼行を画面から作る（DB直挿しだと読み込みタイミングに左右されるため）
  if (!(await page.locator('[data-testid="qr-row-0"]').count())) {
    await page.locator('[data-testid="qr-add"]').click()
  }
  await expect(page.locator('[data-testid="qr-row-0"]'), '依頼行が出る').toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="qr-open-0"]').click()
  await expect(page.locator('[data-testid="ql-panel"]')).toBeVisible({ timeout: 15000 })
  // 添付とOCRの対象になる依頼IDを画面の状態から取り直す
  const openReq = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id&order=created_at.asc`)
  reqId = openReq[0].id

  const fileName = `E2E見積書_${label}.pdf`
  await page.locator('[data-testid="qf-file"]').setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: makePdf() })
  await expect(page.locator('[data-testid="qf-list"]')).toContainText(fileName, { timeout: 20000 })

  const f = await restSrv(`estimate_quote_files?request_id=eq.${reqId}&name=eq.${encodeURIComponent(fileName)}&select=id`)
  await page.locator(`[data-testid="qf-ocr-${f[0].id}"]`).click()
  await expect(page.locator('[data-testid="qocr-panel"]')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('[data-testid="qocr-row-2"]')).toBeVisible({ timeout: 30000 })
}

test('AC1★: 見積書から項目・単位・単価が読み取られ、下書きとして出る', async ({ page }) => {
  await attachAndRead(page, 'ac1')

  const panel = page.locator('[data-testid="qocr-panel"]')
  await expect(panel).toContainText('天井LGS下地組')
  await expect(panel, '単位が出る').toContainText('㎡')
  await expect(panel, '単価が出る').toContainText('2,400')
  await expect(panel, '区分が読めた行は出る').toContainText('材工共')
  await expect(panel, '区分が読めなかった行は空').toContainText('要確認')

  // ★この時点ではまだDBに入っていない（下書き＝確定しない）
  const lines = await restSrv(`estimate_quote_lines?request_id=eq.${reqId}&select=id`)
  expect(lines.length, '読み取っただけでは受領明細に入らない').toBe(0)
})

test('AC2★: 選んだ行だけが受領明細に入り、保存して初めて確定する', async ({ page }) => {
  await attachAndRead(page, 'ac2')

  // 全解除 → 1行目だけ選ぶ（全部そのまま入れさせない）
  await page.getByTestId('qocr-none').click()
  await page.getByTestId('qocr-pick-0').check()
  await page.getByTestId('qocr-apply').click()
  await expect(page.getByTestId('qocr-msg'), '保存で確定と案内する').toContainText('保存')

  // まだDBには入っていない（明細の編集欄に入っただけ）
  expect((await restSrv(`estimate_quote_lines?request_id=eq.${reqId}&select=id`)).length, '入れただけでは未確定').toBe(0)

  // ★既存の「保存（単価履歴に記録）」で確定する
  await page.getByTestId('ql-save').click()
  await expect.poll(async () =>
    (await restSrv(`estimate_quote_lines?request_id=eq.${reqId}&select=id`)).length,
    { timeout: 20000 }).toBe(1)

  const saved = await restSrv(`estimate_quote_lines?request_id=eq.${reqId}&select=item_name,unit,unit_price,quantity,price_kind`)
  expect(saved[0].item_name).toBe('天井LGS下地組')
  expect(saved[0].unit).toBe('㎡')
  expect(Number(saved[0].unit_price), '単価がそのまま入る').toBe(2400)
  expect(Number(saved[0].quantity)).toBe(71)
  expect(saved[0].price_kind, '読み取れた区分が入る').toBe('material_labor')
  // 選ばなかった行は入らない
  expect(saved.some((r: any) => r.item_name === '軽鉄工事 手間'), '選ばなかった行は入らない').toBe(false)
})

// ★区分を既定に倒すと、材工共と労務のみを取り違えて比較で誤選定する
test('AC★: 単価の区分が読めなかった行は空のままにする（既定に倒さない）', async ({ page }) => {
  await attachAndRead(page, 'kind')

  await page.getByTestId('qocr-none').click()
  // 「雑材料」= price_kind null の行を選ぶ
  const rows = page.locator('[data-testid^="qocr-row-"]')
  const n = await rows.count()
  let idx = -1
  for (let i = 0; i < n; i++) if ((await rows.nth(i).innerText()).includes('雑材料')) { idx = i; break }
  expect(idx, '区分なしの行がある').toBeGreaterThanOrEqual(0)
  await page.getByTestId(`qocr-pick-${idx}`).check()
  await page.getByTestId('qocr-apply').click()

  // 明細の区分セレクトが未選択（＝人が選ぶ）になっている
  const kindSel = page.locator('[data-testid^="ql-kind-"]').last()
  await expect(kindSel, '★区分は勝手に決めない').toHaveValue('')
})
