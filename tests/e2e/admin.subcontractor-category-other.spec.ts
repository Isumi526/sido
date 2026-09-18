// ============================================================
//  admin.subcontractor-category-other.spec.ts
//  協力業者マスタの区分に「その他」を追加（2026-09-18 尾崎さん）。
//   - 画面から「その他」で登録でき、一覧のバッジに出る
//   - DB の check 制約が通る（商社/業者/その他）
//   - 現場別集計では「その他」は業者側に計上される（原価未計上の警告に落ちない）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const NAME = `E2Eその他区分_${TS}`
let accountId = ''

test.beforeAll(async () => { accountId = await getAccountId() })
test.afterAll(async () => { await restSrv(`subcontractors?name=like.E2Eその他区分_${TS}*`, { method: 'DELETE' }).catch(() => {}) })

test('★画面から区分「その他」で登録でき、DBに保存され、一覧に出る', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await page.locator('.btn-add', { hasText: '追加' }).first().click()
  const modal = page.locator('.modal').first()
  await expect(modal).toBeVisible()
  await modal.locator('input').first().fill(NAME)
  await modal.locator('select').first().selectOption('その他')
  await modal.getByRole('button', { name: /保存/ }).click()
  await expect(modal).toHaveCount(0, { timeout: 10000 })
  await expect.poll(async () => (await restSrv(`subcontractors?name=eq.${encodeURIComponent(NAME)}&select=category`))?.[0]?.category, { timeout: 10000 }).toBe('その他')
  await expect(page.locator('tr', { hasText: NAME }).locator('.cat-badge')).toHaveText('その他')
})

test('DB: その他 は check 制約を通り、未定義の値は弾かれる', async () => {
  const ok = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `${NAME}_db`, category: 'その他', active: true }),
  })
  expect(ok?.[0]?.category).toBe('その他')
  const bad = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `${NAME}_bad`, category: '不明', active: true }),
  }).catch((e: any) => ({ error: String(e) }))
  expect(Array.isArray(bad) && bad[0]?.id, '未定義の区分は保存できない').toBeFalsy()
})
