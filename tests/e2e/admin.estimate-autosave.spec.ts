// ============================================================
//  admin.estimate-autosave.spec.ts
//  見積R22: 明細のリアルタイム保存（保存ボタン廃止）
//
//  2026-07-29 ユーザー回答:「完全自動・ボタン廃止」
//   セルを離れたら即保存し、右上に「保存しました HH:MM」を出す。
//   未保存警告（離脱ガード）も無くす＝そもそも未保存の状態が存在しない。
//
//  ★過去に「読み込み中に打った内容が保存済み扱いで飲み込まれる」不具合があった。
//    自動保存にすると同種の事故が起きやすいので、開き直して残っているかまで見る。
//
//  Notion: R22
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
let seq = 0
const projName = () => `E2E自動保存_${TS}_${++seq}`
let PROJ = ''

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E自動保存_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

async function openNewProject(page: any) {
  PROJ = projName()
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 10000 })
}
const itemsOf = async (cols: string) => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  return await restSrv(`estimate_items?project_id=eq.${pj[0].id}&select=${cols}&order=sort_order`)
}

test('AC1★: 保存ボタンが無く、セルを離れた時点で保存される', async ({ page }) => {
  await openNewProject(page)
  // ボタンは廃止（押し忘れという概念を無くす）
  await expect(page.locator('[data-testid="save-items"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('入力すると自動で保存されます')

  await page.locator('[data-testid="item-name-0"]').fill('壁面 外周LGS間仕切')
  await page.locator('[data-testid="item-name-0"]').press('Tab')
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })

  await expect.poll(async () => (await itemsOf('item_name'))?.[0]?.item_name, { timeout: 10000 })
    .toBe('壁面 外周LGS間仕切')
})

test('AC2★: 続けて編集しても、最後に打った値が残る（古い保存に上書きされない）', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('天井 LGS下地')
  await page.locator('[data-testid="item-name-0"]').press('Tab')
  // 立て続けに別のセルを編集する（保存が同時に何本も飛ぶ状況を作る）
  await page.locator('[data-testid="item-qty-0"]').fill('10')
  await page.locator('[data-testid="item-qty-0"]').press('Tab')
  await page.locator('[data-testid="item-cost-0"]').fill('800')
  await page.locator('[data-testid="item-cost-0"]').press('Tab')
  await page.locator('[data-testid="item-unit-0"]').fill('㎡')
  await page.locator('[data-testid="item-unit-0"]').press('Tab')
  await page.waitForTimeout(2500)

  // ★先に投げた古い値が後着して新しい値を消していないこと
  const it = (await itemsOf('item_name,quantity,cost_unit_price,unit'))?.[0]
  expect(it.item_name).toBe('天井 LGS下地')
  expect(Number(it.quantity)).toBe(10)
  expect(Number(it.cost_unit_price)).toBe(800)
  expect(it.unit).toBe('㎡')
})

test('AC3★: 保存せず閉じても内容が残る（未保存警告が出ない）', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('床 塩ビタイル貼')
  await page.locator('[data-testid="item-qty-0"]').fill('30')
  await page.locator('[data-testid="item-qty-0"]').press('Tab')
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })

  // ★確認ダイアログを出さずに離脱できる（出たらこのハンドラで検知して失敗させる）
  let dialogSeen = ''
  page.on('dialog', d => { dialogSeen = d.message(); d.accept() })
  await page.goto('/estimate-list', { waitUntil: 'networkidle' })
  expect(dialogSeen, '未保存警告は出ない').toBe('')

  // 開き直すと残っている
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toHaveValue('床 塩ビタイル貼', { timeout: 15000 })
  await expect(page.locator('[data-testid="item-qty-0"]')).toHaveValue('30')
})

test('AC4: 行を消すと即座にDBからも消える', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('消す行')
  await page.locator('[data-testid="item-name-0"]').press('Tab')
  await expect.poll(async () => (await itemsOf('id'))?.length, { timeout: 10000 }).toBe(1)

  await page.locator('[data-testid="item-del-0"]').click()
  await expect.poll(async () => (await itemsOf('id'))?.length, { timeout: 10000 }).toBe(0)
})

test('AC5★: 予備の空行は保存されない（ゴミ行が増えない）', async ({ page }) => {
  await openNewProject(page)
  // 画面には常に予備の空行がある
  expect(await page.locator('[data-testid^="item-name-"]').count()).toBeGreaterThan(3)
  await page.locator('[data-testid="item-name-0"]').fill('1行だけ打つ')
  await page.locator('[data-testid="item-name-0"]').press('Tab')
  await page.waitForTimeout(2000)
  // ★空行まで保存すると「(無題)」が毎回増える
  expect((await itemsOf('item_name'))?.length, '打った1行だけが保存される').toBe(1)
})
