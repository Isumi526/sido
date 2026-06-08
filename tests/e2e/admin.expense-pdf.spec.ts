// ============================================================
//  admin.expense-pdf.spec.ts
//  経費管理の明細パネルから 申請PDF(明細/請求書) を閲覧・DL
//   - AC1: 申請済み(applied_at)精算の明細に「明細PDF」「請求書PDF」リンクが出る
//   - AC2: リンク先(Storage public URL)が実在し開ける(200)
//   - AC3: 未申請(applied_at無し)の期にはPDFリンクが出ない
//  ※ 申請PDFは expense-applications/{slug}/{userId}/{periodKey}_{kind}.pdf に保存される。
//     E2EではダミーPDFをStorageへ直接アップして検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId, getAccountId, SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG } from './helpers'
import { SEED_WORKER, FEAT_EXP_DATE, FEAT_EXP_PERIOD } from './global-setup'

const BUCKET = 'expense-receipts'
const PUB = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`

async function uploadDummyPdf(path: string) {
  // 最小の有効PDF
  const body = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body,
  })
  if (!res.ok && res.status !== 409) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`)
}

test.describe('経費管理：申請PDFの閲覧/DL', () => {
  let userId = ''
  let basePath = ''

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    userId = (await getDevUserId()) || ''
    expect(userId, 'dev-user-id 存在').toBeTruthy()

    // 当月後半に「申請済み」settlement を用意（経費はglobal-setupのFEAT_EXPがdev-userに存在）
    await rest('expense_settlements?on_conflict=account_id,user_id,period_key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, period_key: FEAT_EXP_PERIOD,
        status: '申請中', applied_at: new Date().toISOString(),
      }),
    })

    // 申請PDF(明細/請求書)のダミーをStorageへ
    basePath = `expense-applications/${ACCOUNT_SLUG}/${userId}/${FEAT_EXP_PERIOD}`
    await uploadDummyPdf(`${basePath}_meisai.pdf`)
    await uploadDummyPdf(`${basePath}_seikyu.pdf`)
  })

  test.afterAll(async () => {
    const accountId = await getAccountId()
    // settlement を未申請に戻す（applied_at消す＝他テストへ影響させない）
    await rest(`expense_settlements?account_id=eq.${accountId}&user_id=eq.${userId}&period_key=eq.${encodeURIComponent(FEAT_EXP_PERIOD)}`, { method: 'DELETE' }).catch(() => {})
    for (const k of ['meisai', 'seikyu']) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${basePath}_${k}.pdf`, {
        method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      }).catch(() => {})
    }
  })

  test('AC1/AC2: 申請済み(後半)明細にPDFリンクが出て、開ける', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('経費管理')

    // 当月後半行（FEAT_EXP）を開く
    const row = page.locator('tr.data-row', { hasText: SEED_WORKER }).filter({ hasText: '後半' }).first()
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.click()

    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    const meisai = modal.locator('.pdf-link', { hasText: '明細' })
    const seikyu = modal.locator('.pdf-link', { hasText: '請求書' })
    await expect(meisai).toBeVisible()
    await expect(seikyu).toBeVisible()

    // href が規約パスの public URL
    const href = await meisai.getAttribute('href')
    expect(href).toBe(PUB(`${basePath}_meisai.pdf`))

    // 実在し開ける（200）
    const got = await fetch(href!)
    expect(got.status).toBe(200)
  })

  test('AC3: 未申請(前半・settlement無し)にはPDFリンクが出ない', async ({ page }) => {
    const accountId = await getAccountId()
    const firstPeriod = `${FEAT_EXP_PERIOD.split('-').slice(0, 2).join('-')}-first`
    // 前半に settlement が無いことを保証
    await rest(`expense_settlements?account_id=eq.${accountId}&user_id=eq.${userId}&period_key=eq.${encodeURIComponent(firstPeriod)}`, { method: 'DELETE' }).catch(() => {})

    await page.goto('/expenses', { waitUntil: 'networkidle' })
    const firstRow = page.locator('tr.data-row', { hasText: SEED_WORKER }).filter({ hasText: '前半' }).first()
    // 前半行が無い月もあるためあれば検証
    if (await firstRow.count()) {
      await firstRow.click()
      const modal = page.locator('.modal')
      await expect(modal).toBeVisible()
      await expect(modal.locator('.pdf-row')).toHaveCount(0)
    }
  })
})
