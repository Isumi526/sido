// ============================================================
//  admin.estimate-company-modal.spec.ts
//  見積R26: 自社情報を見積書プレビュー内のモーダルで編集・登録する
//
//  ユーザー要望（2026-07-29 第3回レビュー）:
//   「未登録時にページ内で直接編集・登録可能にする／ページ遷移ではなくモーダル表示で編集」
//  ★見積を作っている最中に別ページへ飛ばすと、書きかけの明細から離れることになる。
//
//  Notion: R26
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const PROJ = `E2E自社情報_${TS}`
const NAME = `E2E内装工業_${TS}`
let prevName: string | null = null

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const cur = await restSrv(`settings?account_id=eq.${accountId}&key=eq.company_name&select=value`)
  prevName = cur?.[0]?.value ?? null
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  // 他のテストが自社情報に依存するので必ず元に戻す
  if (prevName != null) {
    await restSrv('settings?on_conflict=key,account_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, key: 'company_name', value: prevName }),
    }).catch(() => {})
  }
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('AC1★: 見積書プレビューから自社情報をその場で編集でき、すぐ帳票に反映される', async ({ page }) => {
  const accountId = await getAccountId()
  const proj = (await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, name: PROJ, client_name: 'テスト元請' }),
  }))[0]
  await restSrv('estimate_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, project_id: proj.id, item_name: 'スタッド', quantity: 1, unit_price: 1000, sort_order: 0 }),
  })

  await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
  await page.locator('[data-testid="tab-preview"]').click()

  // ★ページ遷移せずモーダルで開く
  await page.locator('[data-testid="open-company-modal"]').click()
  const modal = page.locator('[data-testid="company-modal"]')
  await expect(modal).toBeVisible({ timeout: 10000 })

  await page.locator('[data-testid="cm-name"]').fill(NAME)
  await page.locator('[data-testid="cm-tel"]').fill('03-1234-5678')
  await page.locator('[data-testid="cm-save"]').click()
  await expect(page.locator('[data-testid="cm-msg"]')).toContainText('保存しました', { timeout: 10000 })

  // ★保存したら即座に見積書へ反映される（開き直さない）
  await expect(page.locator('[data-testid="company-name"]')).toContainText(NAME, { timeout: 10000 })
  await expect(page.locator('[data-testid="pdf-preview"]')).toContainText(NAME)
  // 見積作成の画面から離れていない
  await expect(page).toHaveURL(/estimate-builder/)

  // DBにも入る（自社情報ページと同じ入れ物）
  const v = await restSrv(`settings?account_id=eq.${accountId}&key=eq.company_name&select=value`)
  expect(v?.[0]?.value).toBe(NAME)
})
