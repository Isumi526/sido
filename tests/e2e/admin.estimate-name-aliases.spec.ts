// ============================================================
//  admin.estimate-name-aliases.spec.ts
//  見積項目の名寄せ「これ＝これ」（E-3・2026-09-20）
//   AC1 見積Excel連携の画面で「表記＝代表名」を登録／取り消しできる（estimate_name_aliases）
//   AC2 loadPrices で辞書が当たり、単価履歴の作業内容が代表名に統合される（次回の書き出しから反映）
//   AC3 業者跨ぎで同じ alias が効く（辞書は業者に紐付かない）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const RAW = `天井LGS下地組_${TS}`
const CANON = `天井 下地組_${TS}`
let accountId = ''
let subIds: string[] = []
let pjId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  pjId = (await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E名寄せ_${TS}` }),
  }))[0].id
  // 業者A は代表名で、業者B は業者の表記で同じ作業の単価を出している（業者跨ぎ）
  for (const [name, item, price] of [[`E2E名寄A_${TS}`, CANON, 3000], [`E2E名寄B_${TS}`, RAW, 3200]] as const) {
    const sub = await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, category: '業者', active: true, is_deleted: false }),
    })
    subIds.push(sub[0].id)
    const qr = await restSrv('estimate_quote_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, project_id: pjId, subcontractor_id: sub[0].id, received_at: '2026-06-20', trade_name: '■軽鉄工事' }),
    })
    await restSrv('estimate_quote_lines', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ account_id: accountId, request_id: qr[0].id, item_name: item, unit: '㎡', unit_price: price }]),
    })
  }
})

test.afterAll(async () => {
  await restSrv(`estimate_name_aliases?account_id=eq.${accountId}&alias=eq.${encodeURIComponent(RAW)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_quote_requests?project_id=eq.${pjId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${pjId}`, { method: 'DELETE' }).catch(() => {})
  for (const id of subIds) await restSrv(`subcontractors?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1/AC2/AC3★: 表記＝代表名を登録すると単価履歴が代表名に統合され、取り消すと戻る', async ({ page }) => {
  await page.goto('/estimate-excel', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('alias-card')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('ee-price-count')).toBeVisible()

  // 登録前: 2つの表記が別の作業内容として数えられる
  const kindsBefore = await workKinds(page)
  expect(kindsBefore.has(RAW) && kindsBefore.has(CANON), '登録前は両方の表記が別々').toBe(true)

  await page.getByTestId('alias-from').fill(RAW)
  await page.getByTestId('alias-to').fill(CANON)
  await page.getByTestId('alias-add').click()
  await expect(page.getByTestId('alias-msg')).toContainText('登録しました')
  const row = page.getByTestId('alias-list').locator('tr').filter({ hasText: RAW })
  await expect(row, '一覧に出る').toBeVisible()
  await expect(row).toContainText(CANON)

  // DB に入る（テナント内で alias は一意・業者に紐付かない）
  const saved = await restSrv(`estimate_name_aliases?account_id=eq.${accountId}&alias=eq.${encodeURIComponent(RAW)}&select=id,work_name,subcontractor_id`).catch(() => null)
  const savedRows = saved ?? await restSrv(`estimate_name_aliases?account_id=eq.${accountId}&alias=eq.${encodeURIComponent(RAW)}&select=id,work_name`)
  expect(savedRows).toHaveLength(1)
  expect(savedRows[0].work_name).toBe(CANON)

  // 登録後: 業者B の表記が代表名に寄る（作業内容から RAW が消える）
  await expect.poll(async () => (await workKinds(page)).has(RAW), { timeout: 10000 }).toBe(false)
  expect((await workKinds(page)).has(CANON)).toBe(true)

  // 取り消し
  page.once('dialog', (d) => d.accept())
  await page.getByTestId(`alias-del-${savedRows[0].id}`).click()
  await expect(page.getByTestId('alias-list').locator('tr').filter({ hasText: RAW })).toHaveCount(0, { timeout: 10000 })
  await expect.poll(async () => (await workKinds(page)).has(RAW), { timeout: 10000 }).toBe(true)
})

/** 画面が持っている単価履歴の作業内容（名寄せ後）。テスト用に window へ露出せず、datalist の候補から読む */
async function workKinds(page: import('@playwright/test').Page): Promise<Set<string>> {
  const values = await page.locator('#alias-work-names option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
  return new Set(values)
}
