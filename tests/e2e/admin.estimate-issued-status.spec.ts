// ============================================================
//  admin.estimate-issued-status.spec.ts
//  【見積R49】見積書を元請けへ送ったら「提出済み」へ自動で進める。
//
//  ★背景: コードのコメントは「PDF発行時に自動セットされる既存挙動」と書いていたが、
//   実際に status='issued' を書くコードは無く手動だけだった。コメントと実装の食い違いで
//   「もう自動化されている」と読まれ、運用側は更新を忘れて進捗が反映されない状態だった。
//
//  ★進めるのは draft の時だけ。ここが要点:
//   - 人が既に手で「提出済み」にしていれば触る必要がない
//   - 受注/失注/辞退まで進んだ案件で**差し替えの再送**をした時に
//     「提出済み」へ巻き戻ると業務の進捗が壊れる（ACの「不自然に動かない」）
//
//  ※ローカルではEFがテスト入口(test-send-estimate)で実メールは飛ばない。
//   ステータス遷移は送信成功後に走るので、この経路で検証できる。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, openBuilderTab, createEstimateProject } from './helpers'

const TS = Date.now()
const CONTRACTOR = `R49元請け_${TS}`
const CONTACT = `R49担当_${TS}`

let accountId = ''
let contractorId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const c = await restSrv('contractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: CONTRACTOR, active: true }),
  })
  contractorId = c[0].id
  await restSrv('contractor_contacts', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, contractor_id: contractorId, name: CONTACT, email: 'r49@example.com' }),
  })
})

test.afterAll(async () => {
  const projs = await restSrv(`estimate_projects?name=like.R49案件*&select=id`).catch(() => [])
  for (const p of (projs ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_sends?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`estimate_projects?name=like.R49案件*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`contractor_contacts?contractor_id=eq.${contractorId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`contractors?id=eq.${contractorId}`, { method: 'DELETE' }).catch(() => {})
})

async function statusOf(name: string): Promise<string | null> {
  const p = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(name)}&select=status`)
  return p?.[0]?.status ?? null
}

/** 案件を作って明細を1行入れ、元請けを紐付けて送信できる状態にする */
async function prepare(page: import('@playwright/test').Page, name: string) {
  const __pid1 = await createEstimateProject(name)
  await page.goto(`/estimate-builder?project=${__pid1}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="project-select"]')).toContainText(name, { timeout: 15000 })
  await page.locator('[data-testid="project-contractor"]').selectOption({ label: CONTRACTOR })

  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
  await page.locator('[data-testid="item-name-0"]').fill('R49テスト材')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-price-0"]').fill('1000')
  await page.locator('[data-testid="item-price-0"]').press('Tab')
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
}

/** 見積書を送信する */
async function send(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="tab-preview"]').click()
  await page.locator('[data-testid="open-send"]').click()
  await expect(page.locator('[data-testid="send-estimate"]')).toBeEnabled({ timeout: 15000 })
  await page.locator('[data-testid="send-estimate"]').click()
  await expect(page.locator('[data-testid="send-msg"]'), '送信が成立する').toBeVisible({ timeout: 30000 })
}

test('AC★: 見積書を送信すると「提出済み」へ自動で進む', async ({ page }) => {
  const NAME = `R49案件_送信_${TS}`
  await prepare(page, NAME)
  expect(await statusOf(NAME), '作成直後は対応中(draft)').toBe('draft')

  await send(page)

  // ★これが今まで実装されていなかった本体
  await expect.poll(() => statusOf(NAME), { timeout: 20000 }).toBe('issued')
})

test('AC★: 既に受注まで進んだ案件は、再送しても巻き戻らない', async ({ page }) => {
  const NAME = `R49案件_受注_${TS}`
  await prepare(page, NAME)
  // 受注（active）まで進んだ状態にする
  await restSrv(`estimate_projects?name=eq.${encodeURIComponent(NAME)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'active' }),
  })
  // ★素の reload だと案件の選択が外れて送信画面まで行けない。案件IDを付けて開き直す
  const pj = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(NAME)}&select=id`)
  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })

  await send(page)

  // ★差し替えの再送で「提出済み」へ巻き戻ると業務の進捗が壊れる
  await page.waitForTimeout(3000)
  expect(await statusOf(NAME), '受注のまま').toBe('active')
})

test('★PDFをダウンロードしただけでは「提出済み」にしない（出していないのに出したことにしない）', async ({ page }) => {
  const NAME = `R49案件_DL_${TS}`
  await prepare(page, NAME)

  await page.locator('[data-testid="tab-preview"]').click()
  const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null)
  await page.locator('[data-testid="export-pdf"]').click()
  await dl

  await page.waitForTimeout(3000)
  expect(await statusOf(NAME), '社内確認のDLでは進めない').toBe('draft')
})
