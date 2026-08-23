// ============================================================
//  admin.estimate-quote-files.spec.ts
//  見積R5: 下請から受領した見積書ファイル（PDF等）を保存し、
//          明細の「過去の単価」からその根拠を開けるようにする。
//
//  ユーザー原文（2026-07-28 通しレビュー・音声）:
//   「した請業者からの価格っていうのは、した請業者に見積もり依頼を出して
//     返ってきた PDF なり何なりのものを保存しておく必要がある」
//  ★単価だけ持っていても「なぜこの金額か」を後から確認できない、というのが要点。
//
//  Notion: R5 3ab0ff81c56b81579c23ee7bd160b062
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab, createEstimateProject } from './helpers'

const TS = Date.now()
const SUB = `E2E見積書業者_${TS}`
const ITEM = `E2E天井下地_${TS}`
let seq = 0
const projName = () => `E2E見積書_${TS}_${++seq}`
let PROJ = ''
let subId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const r = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SUB, category: '業者', active: true, is_deleted: false }),
  })
  subId = r[0].id
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E見積書_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_quote_requests?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

async function openNewProject(page: any) {
  PROJ = projName()
  const __pid1 = await createEstimateProject(PROJ)
  await page.goto(`/estimate-builder?project=${__pid1}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
}
/** 受領登録（＝単価履歴が貯まる操作）を1件つくり、見積書ファイルも添付する */
async function receiveWithFile(page: any, price: number, attach: boolean) {
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"]')
  await page.locator('[data-testid="qr-add"]').click()
  await page.waitForTimeout(800)
  await page.locator('[data-testid="qr-sub-0"]').selectOption({ label: SUB })
  await page.waitForTimeout(300)
  await page.locator('[data-testid="qr-open-0"]').click()
  await expect(page.locator('[data-testid="ql-panel"]')).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="ql-name-0"]').fill(ITEM)
  await page.locator('[data-testid="ql-unit-0"]').fill('㎡')
  await page.locator('[data-testid="ql-price-0"]').fill(String(price))
  if (attach) {
    await page.locator('[data-testid="qf-file"]').setInputFiles({
      name: '業者見積.pdf', mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% E2E vendor quote\n'),
    })
    await expect(page.locator('[data-testid="qf-list"]')).toContainText('業者見積.pdf', { timeout: 20000 })
  }
  await page.locator('[data-testid="ql-save"]').click()
  await page.waitForTimeout(2000)
}
const requestIdOf = async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  const qr = await restSrv(`estimate_quote_requests?project_id=eq.${pj[0].id}&select=id`)
  return qr?.[0]?.id as string
}

test('AC1★: 受領登録に見積書ファイルを添付でき、その依頼に紐づいて保存される', async ({ page }) => {
  await openNewProject(page)
  await receiveWithFile(page, 1200, true)

  const rid = await requestIdOf()
  const files = await restSrv(`estimate_quote_files?request_id=eq.${rid}&select=name,path`)
  expect(files.length, '見積書が1件保存される').toBe(1)
  expect(files[0].name).toBe('業者見積.pdf')
  expect(files[0].path, 'account_id 配下のパスに置かれる（storageポリシーが効く）').toContain('/quotes/')
})

test('AC2: 添付した見積書は一覧に出て削除できる', async ({ page }) => {
  await openNewProject(page)
  await receiveWithFile(page, 1300, true)
  const rid = await requestIdOf()
  const f = await restSrv(`estimate_quote_files?request_id=eq.${rid}&select=id`)

  page.once('dialog', d => d.accept())
  await page.locator(`[data-testid="qf-del-${f[0].id}"]`).click()
  await expect.poll(async () =>
    (await restSrv(`estimate_quote_files?request_id=eq.${rid}&select=id`)).length,
    { timeout: 10000 }).toBe(0)
})

test('AC3★: 明細の「過去の単価」から、その単価の根拠になった見積書を開ける', async ({ page }) => {
  await openNewProject(page)
  await receiveWithFile(page, 1450, true)

  // 別案件で同じ項目を打つと、過去単価の候補と一緒に「根拠を開く」が出る
  await openNewProject(page)
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
  await page.locator('[data-testid="item-name-0"]').fill(ITEM)
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')

  const cell = page.locator('[data-testid="item-hist-0-0"]')
  await expect(cell).toBeVisible({ timeout: 15000 })
  await expect(cell).toContainText(SUB)
  // ★根拠ファイルがある候補にはアイコンが出る
  await expect(page.locator('[data-testid="item-hist-src-0-0"]')).toBeVisible()
})

test('AC4: 見積書を添付していない単価には「根拠を開く」を出さない（あると誤解する）', async ({ page }) => {
  await openNewProject(page)
  await receiveWithFile(page, 1600, false)   // 添付なし

  await openNewProject(page)
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
  await page.locator('[data-testid="item-name-0"]').fill(ITEM)
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')
  await expect(page.locator('[data-testid="item-hist-0-0"]')).toBeVisible({ timeout: 15000 })

  // 添付なしの受領（=1600円・最安ではない）の位置にはアイコンが無い
  const cells = page.locator('[data-testid^="item-hist-0-"]')
  const n = await cells.count()
  let noFileFound = false
  for (let i = 0; i < n; i++) {
    const t = await cells.nth(i).innerText().catch(() => '')
    if (t.includes('1,600')) {
      noFileFound = true
      await expect(page.locator(`[data-testid="item-hist-src-0-${i}"]`)).toHaveCount(0)
    }
  }
  expect(noFileFound, '添付なしの単価候補が見つかる').toBe(true)
})
