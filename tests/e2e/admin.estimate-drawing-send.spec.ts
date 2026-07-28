// ============================================================
//  admin.estimate-drawing-send.spec.ts
//  見積R8: 元請けから来た図面のページを選んで下請担当者にメール送信
//  ＋ R9: 図面添付のドラッグ&ドロップ
//
//  業務フロー（2026-07-28 ユーザー通しレビュー・音声）:
//    元請けから来た図面をDropboxに保存 → 図面は工種ごとにページが分かれている
//    → 塗装業者に投げるならそのページだけチェック → 共有 → メール
//  ★このspecが守る核心は「誰にどのページを渡したか」が履歴に残ること。
//    見積が食い違った時に「その図面は渡していない」が起きるため。
//
//  Notion: R8 3ab0ff81c56b81369617fedc1a1ab7fe / R9 3ab0ff81c56b81f08044d489c268b691
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab, downloadStorage } from './helpers'

const TS = Date.now()
const SUB = `E2E図面業者_${TS}`
let seq = 0
const projName = () => `E2E図面送信_${TS}_${++seq}`
let PROJ = ''
let subId = ''
let contactId = ''

/**
 * nページの最小PDFを組み立てる。
 * pdf-lib は apps/admin の依存で、admin は workspace ではないためルートから import できない
 * （ルートに入れ直すと admin 側の依存解決を壊した過去がある）。
 * ページ数が数えられて分割できれば十分なので、依存を増やさず素のPDFを書く。
 * 全部ASCIIなので「文字数＝バイトオフセット」が成立し、xref を正しく作れる。
 */
function makePdf(pages: number): Buffer {
  const objs: string[] = []
  // 1=Catalog, 2=Pages, 3=Font, その後 ページとコンテンツを交互に置く
  const pageObjNo = (i: number) => 4 + i * 2
  const contentObjNo = (i: number) => 5 + i * 2
  const kids = Array.from({ length: pages }, (_, i) => `${pageObjNo(i)} 0 R`).join(' ')
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`)
  for (let i = 0; i < pages; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] `
      + `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNo(i)} 0 R >>`)
    // ★ページごとに識別できる文字列を非圧縮のコンテンツストリームで書く。
    //   抽出後のPDFに "PAGE 3" が入って "PAGE 2" が入らないことを見れば、
    //   ページ指定のオフバイワン（1つズレて送る）を確実に検出できる。
    const text = `BT /F1 40 Tf 60 700 Td (PAGE ${i + 1}) Tj ET`
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
  }
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xrefAt = body.length
  const size = objs.length + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  const tail = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(body + xref + tail, 'latin1')
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const found = await restSrv(`subcontractors?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SUB)}&select=id`)
  if (found?.length) subId = found[0].id
  else {
    const r = await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SUB, category: '業者', active: true, is_deleted: false }),
    })
    subId = r[0].id
  }
  const c = await restSrv('subcontractor_contacts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, name: 'E2E担当', email: 'e2e-drawing@example.com', is_deleted: false }),
  })
  contactId = c[0].id
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E図面送信_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_drawing_sends?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_project_attachments?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`subcontractor_contacts?id=eq.${contactId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

async function openProjectWithDrawing(page: any, pages = 6) {
  PROJ = projName()
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: 'E2E図面.pdf', mimeType: 'application/pdf', buffer: makePdf(pages),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText('E2E図面.pdf', { timeout: 20000 })
}
const projectId = async () => {
  const accountId = await getAccountId()
  const r = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  return r?.[0]?.id as string
}

test('AC1: 図面のページ数が読み取られ、ページを個別に選べる', async ({ page }) => {
  await openProjectWithDrawing(page, 6)
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${await projectId()}&select=id`)
  await page.locator(`[data-testid="dsend-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dsend-panel"]')).toBeVisible()

  // 6ページ分のチップが出る
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('0 / 6', { timeout: 15000 })
  await page.locator('[data-testid="dsend-page-2"]').click()
  await page.locator('[data-testid="dsend-page-3"]').click()
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('2 / 6')
  // もう一度押すと外れる
  await page.locator('[data-testid="dsend-page-2"]').click()
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('1 / 6')
})

test('AC2★: 「13-19, 22」のような範囲指定でまとめて選べる（工種ごとに連番で分かれているため）', async ({ page }) => {
  await openProjectWithDrawing(page, 10)
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${await projectId()}&select=id`)
  await page.locator(`[data-testid="dsend-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('0 / 10', { timeout: 15000 })

  await page.locator('[data-testid="dsend-range"]').fill('2-5, 8')
  await page.locator('[data-testid="dsend-range"]').dispatchEvent('change')
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('5 / 10')   // 2,3,4,5,8

  // ページ数を超える指定は無視される（10ページのPDFに 99 を入れても増えない）
  await page.locator('[data-testid="dsend-range"]').fill('2-5, 8, 99')
  await page.locator('[data-testid="dsend-range"]').dispatchEvent('change')
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('5 / 10')

  await page.locator('[data-testid="dsend-all"]').click()
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('10 / 10')
  await page.locator('[data-testid="dsend-none"]').click()
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('0 / 10')
})

test('AC3: 宛先の担当者を選ばないと送信できない', async ({ page }) => {
  await openProjectWithDrawing(page, 4)
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${await projectId()}&select=id`)
  await page.locator(`[data-testid="dsend-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('0 / 4', { timeout: 15000 })

  const send = page.locator('[data-testid="dsend-send"]')
  await expect(send).toBeDisabled()                      // ページ未選択・宛先未選択
  await page.locator('[data-testid="dsend-page-1"]').click()
  await expect(send).toBeDisabled()                      // 宛先がまだ無い
  await page.locator('[data-testid="dsend-sub"]').selectOption({ label: SUB })
  await page.locator(`[data-testid="dsend-contact-${contactId}"]`).check()
  await expect(send).toBeEnabled()
})

test('AC4★: 選んだページだけを抽出して送り、「誰にどのページを渡したか」が履歴に残る', async ({ page }) => {
  await openProjectWithDrawing(page, 8)
  const pid = await projectId()
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${pid}&select=id`)
  await page.locator(`[data-testid="dsend-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dsend-count"]')).toContainText('0 / 8', { timeout: 15000 })

  // 3〜5ページ（＝ある工種の範囲）だけ送る
  await page.locator('[data-testid="dsend-range"]').fill('3-5')
  await page.locator('[data-testid="dsend-range"]').dispatchEvent('change')
  await page.locator('[data-testid="dsend-sub"]').selectOption({ label: SUB })
  await page.locator(`[data-testid="dsend-contact-${contactId}"]`).check()
  await page.locator('[data-testid="dsend-send"]').click()

  await expect(page.locator('[data-testid="dsend-msg"]')).toBeVisible({ timeout: 30000 })

  // ★履歴: どのページを誰に渡したか
  const hist = await restSrv(`estimate_drawing_sends?project_id=eq.${pid}&select=pages,email_to,source_name,pdf_path,subcontractor_id`)
  expect(hist.length).toBe(1)
  expect(hist[0].pages, '送ったページが残る').toEqual([3, 4, 5])
  expect(hist[0].email_to).toContain('e2e-drawing@example.com')
  expect(hist[0].source_name, '元ファイル名も残る').toBe('E2E図面.pdf')
  expect(hist[0].subcontractor_id).toBe(subId)

  expect(hist[0].pdf_path, '抽出PDFが保存されている').toBeTruthy()

  // ★実際に添付されるPDFの中身が「3,4,5ページ目」であること。
  //   ページ指定のオフバイワン（1つズレて送る）はここでしか捕まらない。
  const { data: dl } = await downloadStorage('estimate-drawings', hist[0].pdf_path)
  const body = dl ?? ''
  expect(body, '3ページ目が入っている').toContain('PAGE 3')
  expect(body, '4ページ目が入っている').toContain('PAGE 4')
  expect(body, '5ページ目が入っている').toContain('PAGE 5')
  expect(body, '選んでいない2ページ目は入らない').not.toContain('PAGE 2')
  expect(body, '選んでいない6ページ目は入らない').not.toContain('PAGE 6')

  // 画面の履歴表にも出る
  await expect(page.locator('[data-testid="dsend-history"]')).toContainText('P.3-5')
  await expect(page.locator('[data-testid="dsend-history"]')).toContainText(SUB)
})

test('AC5(R9): 図面をドラッグ&ドロップで追加できる', async ({ page }) => {
  await openProjectWithDrawing(page, 2)
  const before = (await restSrv(`estimate_project_attachments?project_id=eq.${await projectId()}&select=id`)).length

  // DataTransfer を組み立てて drop する（実ブラウザのD&Dと同じ経路）
  const buf = makePdf(2).toString('base64')
  await page.evaluate(async (b64) => {
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const file = new File([arr], 'E2E_DnD.pdf', { type: 'application/pdf' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const zone = document.querySelector('[data-testid="intake-dropzone"]')!
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, buf)

  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText('E2E_DnD.pdf', { timeout: 20000 })
  await expect.poll(async () =>
    (await restSrv(`estimate_project_attachments?project_id=eq.${await projectId()}&select=id`)).length,
    { timeout: 10000 }).toBe(before + 1)
})
