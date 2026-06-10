// ============================================================
//  admin.estimates.spec.ts
//  見積書 アップロード＋登録（admin / #4 AC1・AC3）
//   AC1: 見積書PDFをアップロードし、業者・現場に紐付けて保存できる
//   AC3: 見積書番号が採番される（EST-<年>-<連番>）。2件目は連番が増える
//  ※ AC2(AI自動抽出)は別途・設計承認後。ここは目視入力＋採番＋PDF保存。
//  design: 見積→注文→請求エピック（土台）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TOKEN = `E2E見積_${Date.now()}`
const PDF = { name: 'estimate.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% E2E estimate test\n') }

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  // note にユニークトークンを入れた行を削除
  await rest(`estimates?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

async function fillAndSave(page: import('@playwright/test').Page, total: string, details: string) {
  await page.locator('.btn-add').click()
  const modal = page.locator('.modal.wide')
  await expect(modal).toBeVisible()
  await modal.locator('select').first().selectOption({ index: 1 })                // 業者（プレースホルダ次の実業者）
  await modal.locator('select').nth(1).selectOption({ label: 'テスト現場1' })       // 現場
  await modal.locator('input[type="number"]').fill(total)
  await modal.locator('textarea').fill(details)
  await modal.locator('input.inp').last().fill(TOKEN)                              // メモ（=後始末トークン）
  await modal.locator('input[type="file"]').setInputFiles(PDF)
  await modal.locator('.btn-save').click()
  await expect(modal).toBeHidden()
}

test('AC1: 見積書をPDF付きで登録 → 一覧に業者・現場・PDFが出る', async ({ page }) => {
  await page.goto('/estimates', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('見積書管理')

  await fillAndSave(page, '500000', '1F内装ボード・クロス工事 一式')

  // DBに保存され、PDFパス・業者/現場・金額が入っている
  const ests = await rest(`estimates?note=eq.${encodeURIComponent(TOKEN)}&select=id,estimate_number,total_amount,subcontractor_id,site_id,pdf_path,construction_details&order=estimate_number`)
  expect(ests.length).toBe(1)
  expect(ests[0].total_amount).toBe(500000)
  expect(ests[0].subcontractor_id).toBeTruthy()
  expect(ests[0].site_id).toBeTruthy()
  expect(ests[0].pdf_path).toContain(`estimates/`)
  expect(ests[0].pdf_path).toContain(`${ests[0].id}.pdf`)

  // 一覧行に見積番号・現場・PDFリンクが出る（業者の正しさはRESTで担保済み）
  const row = page.locator('tr', { hasText: ests[0].estimate_number })
  await expect(row).toBeVisible()
  await expect(row).toContainText('テスト現場1')
  await expect(row.locator('a.pdf-link')).toBeVisible()
})

test('AC3: 見積番号は EST-<年>-<連番>。2件目は連番が増える', async ({ page }) => {
  await page.goto('/estimates', { waitUntil: 'networkidle' })
  await fillAndSave(page, '300000', '2F 軽鉄下地 一式')

  const ests = await rest(`estimates?note=eq.${encodeURIComponent(TOKEN)}&select=estimate_number&order=estimate_number`)
  expect(ests.length).toBe(2)
  const year = new Date().getFullYear()
  for (const e of ests) expect(e.estimate_number).toMatch(new RegExp(`^EST-${year}-\\d{4}$`))
  const seq = (n: string) => parseInt(n.slice(`EST-${year}-`.length), 10)
  expect(seq(ests[1].estimate_number)).toBe(seq(ests[0].estimate_number) + 1)
})
