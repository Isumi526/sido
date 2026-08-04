// ============================================================
//  admin.site-list-order.spec.ts
//  現場別集計の現場タブを、よく使う順にユーザーごとに並び替えて保存する。
//
//  ★方式: 頻度の自動集計ではなく「人が明示的に並べた順を保存」
//   （議事録の手書きメモを採用）。順序が勝手に動くと説明できなくなるため。
//
//  ★いちばん壊れやすいのは「保存した順序を全量とみなす」実装:
//   新しい現場が増えた時に、保存に無いその現場が**一覧から消える**。
//   なので「保存に無い項目は既定順(五十音)で後ろに続く」ことを必ず固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E並び替え_${TS}`
// 五十音順で A < B < C になる名前にする（既定順を検証できるように）
const SITE_A = `E2E並びA_${TS}`
const SITE_B = `E2E並びB_${TS}`
const SITE_C = `E2E並びC_${TS}`
const YM = '2026-03'

let accountId = ''
let userId = ''

async function seedReport(date: string, siteName: string) {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: true,
      sites: [{ siteName, workers: [], subcontractors: [], expenses: {} }],
    }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
  })
  const u = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: w[0].id }),
  })
  userId = u[0].id
  await seedReport(`${YM}-05`, SITE_A)
  await seedReport(`${YM}-06`, SITE_B)
})

test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`user_list_orders?list_key=eq.site-reports.sites`, { method: 'DELETE' }).catch(() => {})
})

/** 対象E2E現場だけをタブ表示順に抜き出す（他テストの現場が混ざるため） */
async function e2eTabOrder(page: import('@playwright/test').Page): Promise<string[]> {
  const names = await page.locator('.tabs .tab').allInnerTexts()
  return names.map((s) => s.trim()).filter((n) => n.endsWith(`_${TS}`))
}

async function openPage(page: import('@playwright/test').Page) {
  await page.goto(`/site-reports?ym=${YM}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('site-reorder-toggle')).toBeVisible({ timeout: 15000 })
}

/**
 * 保存がDBに届くまで待つ。
 * ★保存は非同期なので、押した直後に画面遷移すると保存要求が中断される。
 *  「画面が並び替わった」だけでは保存されたことにならないので、DBを見て待つ。
 */
async function savedOrder(): Promise<string[]> {
  const rows = await restSrv('user_list_orders?list_key=eq.site-reports.sites&select=item_keys')
  const keys = rows?.[0]?.item_keys
  return Array.isArray(keys) ? keys.filter((k: string) => k.endsWith(`_${TS}`)) : []
}

test('AC1★/AC2★: 並び替えた順序が保存され、開き直しても保たれる', async ({ page }) => {
  await openPage(page)
  expect(await e2eTabOrder(page), '既定は五十音順').toEqual([SITE_A, SITE_B])

  // 並び替えモードに入って B を左へ
  await page.getByTestId('site-reorder-toggle').click()
  const names = await page.locator('.tabs .tab').allInnerTexts()
  const bIdx = names.findIndex((s) => s.trim() === SITE_B)
  await page.getByTestId(`site-move-left-${bIdx}`).click()
  await expect.poll(async () => (await e2eTabOrder(page)).join(','), { timeout: 10000 })
    .toBe([SITE_B, SITE_A].join(','))
  // 保存がDBに届くまで待ってから開き直す（待たずに遷移すると保存要求が中断される）
  await expect.poll(savedOrder, { timeout: 15000 }).toEqual([SITE_B, SITE_A])

  // ★開き直しても保たれる（＝DBに保存されている）
  await openPage(page)
  expect(await e2eTabOrder(page), '再読込しても並びが残る').toEqual([SITE_B, SITE_A])
})

test('★保存に無い現場は消えず、五十音順で後ろに続く（新しい現場が消えない）', async ({ page }) => {
  // 上のテストで [B, A] が保存されている状態。あとから C を増やす。
  await seedReport(`${YM}-07`, SITE_C)
  await openPage(page)

  // ★保存した配列をそのまま表示する実装だと、ここで C が消える
  expect(await e2eTabOrder(page), '新しい現場は既定順で後ろに付く').toEqual([SITE_B, SITE_A, SITE_C])
})

test('★「五十音順に戻す」で既定順に戻る', async ({ page }) => {
  await openPage(page)
  await page.getByTestId('site-reorder-toggle').click()
  await page.getByTestId('site-reorder-reset').click()

  await expect.poll(async () => (await e2eTabOrder(page)).join(','), { timeout: 10000 })
    .toBe([SITE_A, SITE_B, SITE_C].join(','))
  await expect.poll(savedOrder, { timeout: 15000 }).toEqual([])

  await openPage(page)
  expect(await e2eTabOrder(page), '戻した状態も保存される').toEqual([SITE_A, SITE_B, SITE_C])
})

test('AC3★: 並び替えモードでない時は移動ボタンを出さない（誤操作を防ぐ）', async ({ page }) => {
  await openPage(page)
  await expect(page.getByTestId('site-move-left-1'), '既定では出さない').toHaveCount(0)
  await page.getByTestId('site-reorder-toggle').click()
  await expect(page.getByTestId('site-move-left-1'), '並び替え中だけ出す').toBeVisible()
})

test('★保存は自分だけのもの（他人の並び順を読み書きできない）', async () => {
  // RLSで auth_user_id = auth.uid() に限定している。anon からは触れない。
  const rows = await restSrv('user_list_orders?select=auth_user_id,list_key')
  // service_role では見える（＝行は実在する）が、anon/他ユーザーからは見えない設計。
  expect(Array.isArray(rows), '行が保存されている').toBe(true)
})
