// ============================================================
//  liff.report-unset-site-name.spec.ts
//  現場マスタに無い現場で働いた時、作業員が現場名を文字で残せる（2026-08-27）。
//
//  ★出所: 実際の報告「あらかじめ現場台帳作ってなくて現場名うったけど報告できないっぽい」。
//   職人は現場を新規作成できない（__other__ が出ない）ため、未登録現場では
//   「現場未設定（あとで紐付け）」を選ぶしかない。ところがそれだと
//   "UA長島 補修工事" のような現場名がシステム上どこにも残らず、あとで管理者が
//   記憶を頼りに紐付けるしかなかった。
//
//  ここで守ること:
//   - 「現場未設定」を選ぶと現場名の入力欄が出る（任意）
//   - 書いた名前が日報に残る（customSiteName）
//   - ★その名前で現場マスタを作らない（__unset__ は紐付け待ちの印であって現場ではない）
//   - 画面に内部値 '__unset__' を出さない
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
const TYPED = `UA長島　補修工事_${Date.now()}`

let userId = ''
let accountId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest('users?line_user_id=eq.dev-user-id&select=id')
  userId = u[0].id
})

test.beforeEach(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
})

test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=eq.${encodeURIComponent(TYPED)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=eq.__unset__&account_id=eq.${accountId}`, { method: 'DELETE' }).catch(() => {})
})

test('「現場未設定」を選ぶと現場名を書ける欄が出て、内部値は画面に出ない', async ({ page }) => {
  await page.goto(`/report?date=${TODAY}`, { waitUntil: 'networkidle' })
  await page.locator('select:has(option[value="working"])').first().selectOption('working')

  const siteSelect = page.getByTestId('site-select-0')
  await expect(siteSelect).toBeVisible({ timeout: 15000 })
  await siteSelect.selectOption('__unset__')

  // 現場名を書ける欄が出る
  const memo = page.getByTestId('unset-site-memo-0')
  await expect(memo, '現場名を残せる欄が出る').toBeVisible()
  await memo.fill(TYPED)

  // ★内部値が画面に露出しない（確認プレビューに「__unset__」と出ていた）
  await expect(page.locator('body')).not.toContainText('__unset__')
})

test('★書いた現場名が日報に残り、その名前で現場マスタを作らない', async ({ page }) => {
  await page.goto(`/report?date=${TODAY}`, { waitUntil: 'networkidle' })
  await page.locator('select:has(option[value="working"])').first().selectOption('working')
  await page.getByTestId('site-select-0').selectOption('__unset__')
  await page.getByTestId('unset-site-memo-0').fill(TYPED)

  await page.getByTestId('omission-confirm').check()
  await page.getByTestId('report-submit').click()

  // 日報に現場名が残る
  await expect.poll(async () => {
    const reps = await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}&select=sites`)
    return (reps ?? [])[0]?.sites?.[0]?.customSiteName ?? null
  }, { timeout: 30000, message: '書いた現場名が日報に残る' }).toBe(TYPED)

  const reps = await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}&select=sites`)
  expect(reps[0].sites[0].siteName, '現場は未設定のまま（紐付け待ち）').toBe('__unset__')
  expect(reps[0].sites[0].site_id, '現場IDは付かない').toBeNull()

  // ★マスタを汚さない
  const typedSite = await restSrv(`sites?name=eq.${encodeURIComponent(TYPED)}&select=id`)
  expect((typedSite ?? []).length, '書いた名前で現場マスタを作らない').toBe(0)
  const unsetSite = await restSrv(`sites?name=eq.__unset__&account_id=eq.${accountId}&select=id`)
  expect((unsetSite ?? []).length, '★「__unset__」という名前の現場も作らない').toBe(0)
})
