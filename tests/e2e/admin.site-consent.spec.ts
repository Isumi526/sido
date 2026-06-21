// ============================================================
//  admin.site-consent.spec.ts
//  送り出し資料の出退勤同意（admin側 AC1）
//   管理者が現場の書類添付を「出退勤同意」必須に切替→ site_attachments.require_consent が反映される。
//   ※作業員チェックイン側の同意UI(AC2/AC3)は LIFF checkin の手動確認（本文🧪手順）でカバー。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, SERVICE_ROLE_KEY, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E同意現場_${TS}`
let siteId = ''
let attId = ''

async function uploadDummy(path: string) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/site-attachments/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/pdf' },
    body: 'dummy-pdf',
  }).catch(() => {})
}

test.beforeAll(async () => {
  const acct = await getAccountId()
  const s = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: acct, name: SITE }) })
  siteId = s?.[0]?.id
  const path = `${acct}/${siteId}/document-e2e-${TS}.pdf`
  await uploadDummy(path)
  const a = await restSrv('site_attachments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: acct, site_id: siteId, kind: 'document', path, name: '送り出し資料.pdf', require_consent: false }) })
  attId = a?.[0]?.id
  if (!siteId || !attId) throw new Error('seed failed')
})

test.afterAll(async () => {
  await restSrv(`site_attachments?id=eq.${attId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1: 書類を「出退勤同意」必須に切替→ require_consent が DB に反映される', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.locator('.btn-edit').click()

  // 添付の同意トグル（書類のみ表示）
  const consent = page.locator('.att-item', { hasText: '送り出し資料.pdf' }).locator('.att-consent input[type="checkbox"]')
  await expect(consent).toBeVisible()
  await expect(consent).not.toBeChecked()
  await consent.check()

  await expect.poll(async () => {
    const r = await restSrv(`site_attachments?id=eq.${attId}&select=require_consent`)
    return r?.[0]?.require_consent
  }, { timeout: 10000 }).toBe(true)

  // もう一度押すと解除される
  await consent.uncheck()
  await expect.poll(async () => {
    const r = await restSrv(`site_attachments?id=eq.${attId}&select=require_consent`)
    return r?.[0]?.require_consent
  }, { timeout: 10000 }).toBe(false)
})
