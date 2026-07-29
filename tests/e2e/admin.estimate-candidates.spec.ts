// ============================================================
//  admin.estimate-candidates.spec.ts
//  見積R21: 名称・品番の候補を画面上で編集・削除する
//
//  ユーザー要望（2026-07-29 第3回レビュー）:
//   「名称・品番のプルダウン履歴をUI上で編集・削除可能にする」
//  ★候補は R28 で「商社単価表 ＋ 過去に打った明細」から作られるようになった。
//    誤入力がそのまま候補に残り続けると、次から間違いを選んでしまう。
//  ★候補から外しても、すでに作った見積の中身は変えない
//    （過去の見積の名称を書き換えると、出した帳票と食い違う）。
//
//  Notion: R21
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const TYPO = `E2E誤入力_てんじよう下地_${TS}`
const PROJ = `E2E候補_${TS}`
let projId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // 過去の明細として「打ち間違い」を1件残す（＝候補に出てしまう状態を作る）
  const pj = await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, name: PROJ }),
  })
  projId = pj[0].id
  await restSrv('estimate_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, project_id: projId, item_name: TYPO, quantity: 1, unit_price: 100, sort_order: 0 }),
  })
})

test.afterAll(async () => {
  await restSrv(`estimate_items?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1★: 候補を一覧で見られて、打ち間違いを候補から外せる', async ({ page }) => {
  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })

  // 打ち間違いが候補（datalist）に出てしまっている
  await expect(page.locator(`#est-materials option[value="${TYPO}"]`)).toHaveCount(1)

  await page.locator('[data-testid="open-cand-name-modal"]').click()   // R35: 名称/品番でボタンを分けた
  await expect(page.locator('[data-testid="cand-modal"]')).toBeVisible()
  await page.locator('[data-testid="cand-filter"]').fill(TYPO)
  await expect(page.locator('[data-testid="cand-name-0"]')).toHaveValue(TYPO)

  page.once('dialog', d => d.accept())
  await page.locator('[data-testid="cand-del-0"]').click()
  await expect(page.locator('[data-testid="cand-msg"]')).toContainText('候補から外しました', { timeout: 10000 })

  // 候補から消える
  await page.locator('[data-testid="cand-close"]').click()
  await expect(page.locator(`#est-materials option[value="${TYPO}"]`)).toHaveCount(0)
})

test('AC2★: 候補から外しても、すでに作った見積の中身は変わらない', async ({ page }) => {
  // AC1で候補から外した後も、その名称で保存済みの明細はそのまま
  const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=item_name`)
  expect(items?.[0]?.item_name, '過去の見積の名称は書き換えない').toBe(TYPO)

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toHaveValue(TYPO, { timeout: 15000 })
})
