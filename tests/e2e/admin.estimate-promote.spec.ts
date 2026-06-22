// ============================================================
//  admin.estimate-promote.spec.ts
//  【見積→受注→現場化】受注確定で現場を作成し、案件に紐付け＋ステータスをactive(受注)に。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PROJ = `受注案件_${TS}`
const SITE = `受注現場_${TS}`

test('受注→現場化: 現場を作成し案件に紐付け＋受注ステータスになる', async ({ page }) => {
  const accountId = await getAccountId()
  const proj = (await restSrv('estimate_projects', { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: accountId, name: PROJ }) }))[0]

  try {
    await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
    // 受注して現場化
    await page.locator('[data-testid="promote-open"]').click()
    await page.locator('[data-testid="promote-name"]').fill(SITE)
    await page.locator('[data-testid="promote-confirm"]').click()

    // DB: 現場が作られ、案件に site_id 紐付け＋status=active
    await expect.poll(async () => {
      const ps = await restSrv(`estimate_projects?id=eq.${proj.id}&select=site_id,status`)
      const r = ps?.[0]
      return r ? `${!!r.site_id}|${r.status}` : null
    }, { timeout: 10000 }).toBe('true|active')
    // UI: 受注済み＋現場名リンク
    await expect(page.locator('[data-testid="linked-site"]')).toContainText(SITE)
  } finally {
    await restSrv(`estimate_items?project_id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
  }
})
