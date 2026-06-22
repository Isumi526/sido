// ============================================================
//  admin.company-profile.spec.ts
//  【自社情報】会社名等を登録すると settings に保存され、見積書PDFの発行元に反映される。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const CNAME = `自社E2E_${TS}`
const PROJ = `自社案件_${TS}`

test('自社情報を保存→見積書プレビューに会社名が反映される', async ({ page }) => {
  const accountId = await getAccountId()
  const post = async (table: string, body: any) =>
    restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const proj = (await post('estimate_projects', { account_id: accountId, name: PROJ }))[0]
  await post('estimate_items', { account_id: accountId, project_id: proj.id, item_name: '材1', quantity: 1, unit_price: 1000 })

  try {
    // 自社情報を保存
    await page.goto('/company-profile', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="cp-name"]').fill(CNAME)
    await page.locator('[data-testid="cp-save"]').click()
    await expect.poll(async () => {
      const s = await restSrv(`settings?key=eq.company_name&account_id=eq.${accountId}&select=value`)
      return s?.[0]?.value ?? null
    }, { timeout: 10000 }).toBe(CNAME)

    // 見積書プレビューに会社名が出る
    await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ)
    await expect(page.locator('[data-testid="pdf-preview"]')).toContainText(CNAME)
  } finally {
    await restSrv(`estimate_items?project_id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`settings?key=eq.company_name&account_id=eq.${accountId}`, { method: 'DELETE' }).catch(() => {})
  }
})
