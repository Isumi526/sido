// ============================================================
//  admin.estimate-site-filter.spec.ts
//  見積書登録フォームで業者を選ぶと、現場プルダウンが site_subcontractors の
//  紐付け(1:n)に絞り込まれる。紐付けが無い業者は全現場フォールバック。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const VENDOR = `E2E絞込業者_${TS}`
const SITE_LINKED = `E2E紐付現場_${TS}`
const SITE_OTHER = `E2E無関係現場_${TS}`

test.describe('見積書: 業者選択で現場絞り込み', () => {
  let subId = '', siteLinkedId = '', siteOtherId = ''
  test.afterAll(async () => {
    if (subId) await restSrv(`site_subcontractors?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?name=eq.${encodeURIComponent(SITE_LINKED)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?name=eq.${encodeURIComponent(SITE_OTHER)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('業者を選ぶと紐づく現場のみ表示される', async ({ page }) => {
    const accountId = await getAccountId()
    const sub = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
    subId = sub[0].id
    const sl = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE_LINKED, active: true }) })
    siteLinkedId = sl[0].id
    const so = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE_OTHER, active: true }) })
    siteOtherId = so[0].id
    // 業者↔紐付現場 のみリンク
    await restSrv('site_subcontractors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, site_id: siteLinkedId, subcontractor_id: subId }) })

    await page.goto('/estimates', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()

    // 業者を選択 → 現場プルダウンは紐付け現場のみ（無関係現場は出ない）
    await modal.locator('.fld', { hasText: '業者' }).locator('select').selectOption({ label: `${VENDOR}（業者）` })
    const siteSelect = modal.locator('.fld', { hasText: '現場' }).locator('select')
    const opts = await siteSelect.locator('option').allInnerTexts()
    expect(opts.join(' ')).toContain(SITE_LINKED)
    expect(opts.join(' ')).not.toContain(SITE_OTHER)
    // 絞り込み中の注記が出る
    await expect(modal.locator('.filter-note')).toBeVisible()
  })
})
