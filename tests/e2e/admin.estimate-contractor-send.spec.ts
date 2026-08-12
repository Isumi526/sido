// ============================================================
//  admin.estimate-contractor-send.spec.ts
//  【見積→元請け】案件に元請けを紐付け→元請け担当者を送信先に選べる／編集中の離脱ガード
//   - 見積書PDFの送信先は元請け(contractors)の担当者(contractor_contacts)。
//   - 案件編集中（未保存）に案件を切り替えようとすると確認ダイアログが出る。
//   ※ 実メール送信(EF)はローカル未デプロイのため、ここでは「送信可能な状態」までを検証。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, openBuilderTab } from './helpers'

const TS = Date.now()
const CONTRACTOR = `元請けE2E_${TS}`
const CONTACT = `担当E2E_${TS}`
const PROJ_A = `元請け案件A_${TS}`
const PROJ_B = `元請け案件B_${TS}`
const PROJ_GUARD = `離脱ガード案件_${TS}`

test.describe.configure({ mode: 'serial' })

test.describe('見積→元請け 送信先と離脱ガード', () => {
  let contractorId = ''

  test.afterAll(async () => {
    for (const name of [PROJ_A, PROJ_B, PROJ_GUARD]) {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(name)}&select=id`).catch(() => [])
      for (const p of projs ?? []) await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`estimate_projects?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
    }
    if (contractorId) await restSrv(`contractor_contacts?contractor_id=eq.${contractorId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`contractors?name=eq.${encodeURIComponent(CONTRACTOR)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('案件に元請けを紐付け→元請けの担当者を送信先に選べる', async ({ page }) => {
    const accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const c = (await post('contractors', { account_id: accountId, name: CONTRACTOR, active: true }))[0]
    contractorId = c.id
    await post('contractor_contacts', { account_id: accountId, contractor_id: contractorId, name: CONTACT, email: 'moto@example.com' })

    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    // 案件を追加（自動選択される）
    await page.locator('[data-testid="new-project-name"]').fill(PROJ_A)
    await page.locator('[data-testid="add-project"]').click()
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ_A)

    // 案件に元請けを紐付け → estimate_projects.contractor_id が保存される
    await page.locator('[data-testid="project-contractor"]').selectOption({ label: CONTRACTOR })
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ_A)}&select=contractor_id`)
      return projs?.[0]?.contractor_id ?? null
    }, { timeout: 10000 }).toBe(contractorId)

    // 明細を1行入れる（送信可能化の条件）→ 元請けの担当者を選ぶ → 送信ボタンが有効
    await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
    await page.locator('[data-testid="item-name-0"]').fill('テスト材')
    await page.locator('[data-testid="item-qty-0"]').fill('1')
    await page.locator('[data-testid="item-price-0"]').fill('1000')
    await page.locator('[data-testid="tab-preview"]').click()    // 送信は「見積書プレビュー」タブ
    await page.locator('[data-testid="open-send"]').click()      // メール送信ダイアログ（宛先は自動で全選択）
    await expect(page.locator('[data-testid="send-subject"]')).toHaveValue(new RegExp(PROJ_A))
    await expect(page.locator('[data-testid="send-estimate"]')).toBeEnabled()
  })

  // ★2026-07-29(R22): リアルタイム保存にしたので「未保存」という状態が無くなった。
  //   離脱ガード（確認ダイアログ）は撤去済み。ここでは
  //   「ダイアログを出さずに離脱でき、内容が残っている」ことを見る。
  test('編集内容は自動保存され、確認ダイアログ無しで離脱できる', async ({ page }) => {
    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="new-project-name"]').fill(PROJ_GUARD)
    await page.locator('[data-testid="add-project"]').click()
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ_GUARD)
    await page.waitForLoadState('networkidle')

    await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
    await page.locator('[data-testid="item-name-0"]').fill('自動保存される明細')
    await page.locator('[data-testid="item-name-0"]').press('Tab')
    await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })

    let dialogMsg = ''
    page.on('dialog', (d) => { dialogMsg = d.message(); d.accept() })
    await page.locator('[data-testid="back-to-list"]').click()
    await page.waitForTimeout(1500)
    expect(dialogMsg, '未保存警告は出ない').toBe('')

    // 内容はDBに残っている（押し忘れという概念が無い）
    const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ_GUARD)}&select=id`)
    const items = await restSrv(`estimate_items?project_id=eq.${projs[0].id}&select=item_name`)
    expect(items?.[0]?.item_name).toBe('自動保存される明細')
  })
})
