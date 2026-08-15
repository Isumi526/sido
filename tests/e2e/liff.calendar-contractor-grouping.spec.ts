// ============================================================
//  liff.calendar-contractor-grouping.spec.ts
//  予定追加モーダルの現場プルダウンが、元請けごとに optgroup で分かれ、
//  かつ**どの現場も消えない**ことを検証する。
//
//  ★元の意図（2026-07-20）: 元請けを選ぶと「その他の現場」が消えてしまい、
//   別の元請けの現場を選べなくなる不具合があった。その回帰防止。
//
//  ★2026-08-15 に元請けの絞り込みプルダウン自体を廃止した。
//   現場プルダウンは元々 optgroup で元請けごとに分かれており、絞り込みは
//   その2階層構造の上に重ねた重複UIだった。しかも本番の現場80件のうち
//   54件(68%)が元請け未紐付けで、絞り込んでも大半が1グループに固まり効かない。
//   ＝「どの現場も消えない」という元の保証は、絞り込みが無くなったことで
//   より強く満たされる。テストはその新しい形に合わせて書き直した。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const CONTRACTOR = `E2E元請_${TS}`
const SITE_LINKED = `E2E紐付き現場_${TS}`
const SITE_OTHER = `E2Eその他現場_${TS}`
let contractorId = ''
let linkedSiteId = ''
let otherSiteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  contractorId = (await rest('contractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: CONTRACTOR, active: true,
  }) }))[0].id
  linkedSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_LINKED, active: true, contractor_id: contractorId,
  }) }))[0].id
  otherSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_OTHER, active: true,
  }) }))[0].id
})
test.afterAll(async () => {
  await rest(`sites?id=eq.${linkedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`contractors?id=eq.${contractorId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場プルダウンは元請けごとに分かれ、紐付きも未紐付けも両方選べる', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.locator('.cal-tab', { hasText: '個人' }).click()
  await page.locator('[data-testid="personal-week-fab"]').click()

  const siteSelect = page.locator('[data-testid="site-select"]')
  await expect(siteSelect).toBeVisible()

  // ★どちらの現場も消えない（元の回帰防止の本体）
  const options = await siteSelect.locator('option').allTextContents()
  expect(options, '元請けに紐づく現場が出る').toContain(SITE_LINKED)
  expect(options, '元請けに紐づかない現場も出る').toContain(SITE_OTHER)

  // 2階層: 元請け名の optgroup と「紐付けなし」の optgroup が両方ある
  const groups = await siteSelect.locator('optgroup').evaluateAll(
    els => els.map(e => (e as HTMLOptGroupElement).label))
  expect(groups, '元請け名でグループ化されている').toContain(CONTRACTOR)
  expect(groups, '未紐付けのグループもある').toContain('紐付けなし')

  // 廃止した絞り込みプルダウンが残っていない（重複UIを戻さないための固定）
  await expect(page.locator('[data-testid="contractor-select"]'), '元請け絞り込みは廃止済み').toHaveCount(0)
})
