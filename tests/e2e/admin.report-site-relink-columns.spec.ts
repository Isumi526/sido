// ============================================================
//  admin.report-site-relink-columns.spec.ts
//  現場未設定の日報の紐付け一覧に「元請け」「出退勤」を出す。
//
//  ★狙い: 日付と作業員だけだと、同じ日に複数現場が動いている時に
//   どの現場の日報か決められない。元請けと時刻が手がかりになる。
//
//  ★現場未設定＝現場マスタ側が無いので、元請けも時刻も
//   **日報JSON(sites[])の入力値**から取る（マスタを引かない）。
//   「その他」で手入力された元請けは customContractorName に入る点も固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, todayJST } from './helpers'

const TS = Date.now()
const WORKER = `E2E紐付け_${TS}`
const CONTRACTOR = `E2E元請け_${TS}`
const CUSTOM_CONTRACTOR = `E2E手入力元請け_${TS}`

// 直近90日しか出さない画面なので当日付近を使う
const D_FULL = todayJST()
const D_CUSTOM = new Date(Date.now() - 86400000).toISOString().split('T')[0]
const D_BARE = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0]

let accountId = ''
let userId = ''

/** 現場未設定(__unset__)の日報を1件作る */
async function seed(date: string, site: any) {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: true,
      sites: [{ siteName: '__unset__', subcontractors: [], expenses: {}, ...site }],
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

  // ① 元請け・時刻あり
  await seed(D_FULL, {
    contractorName: CONTRACTOR,
    workers: [{ workerName: WORKER, startTime: '08:00', endTime: '17:30' }],
    note: `E2Eメモ_${TS}`,
  })
  // ② 元請けが「その他」の手入力
  await seed(D_CUSTOM, {
    contractorName: '__other__', customContractorName: CUSTOM_CONTRACTOR,
    workers: [{ workerName: WORKER, startTime: '09:00', endTime: '18:00' }],
  })
  // ③ 元請けも時刻も無い（AC3: 行が壊れないこと）
  await seed(D_BARE, { workers: [{ workerName: WORKER }] })
})

test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
})

/** 対象作業員の行（日付で1件に絞る） */
function rowOf(page: import('@playwright/test').Page, date: string) {
  const [, m, d] = date.split('-')
  return page.locator('tbody tr').filter({ hasText: `${Number(m)}/${Number(d)}` }).filter({ hasText: WORKER }).first()
}

test('AC1★/AC2★: 元請けと出退勤の時刻が行に出る', async ({ page }) => {
  await page.goto('/report-site-relink', { waitUntil: 'networkidle' })

  const row = rowOf(page, D_FULL)
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row.getByTestId('relink-contractor'), '元請けが出る').toHaveText(CONTRACTOR)
  await expect(row.getByTestId('relink-hours'), '出退勤が出る').toHaveText('08:00〜17:30')
})

test('AC1★: 「その他」で手入力された元請けも出る（空欄にしない）', async ({ page }) => {
  await page.goto('/report-site-relink', { waitUntil: 'networkidle' })

  const row = rowOf(page, D_CUSTOM)
  await expect(row).toBeVisible({ timeout: 15000 })
  // ★ここを contractorName のまま出すと画面に "__other__" が漏れる
  await expect(row.getByTestId('relink-contractor')).toHaveText(CUSTOM_CONTRACTOR)
  await expect(row.getByTestId('relink-contractor')).not.toContainText('__other__')
})

test('AC3★: 元請け・時刻が無くても行が壊れず、紐付け操作はできる', async ({ page }) => {
  await page.goto('/report-site-relink', { waitUntil: 'networkidle' })

  const row = rowOf(page, D_BARE)
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row.getByTestId('relink-contractor'), '取れなければ —').toHaveText('—')
  await expect(row.getByTestId('relink-hours'), '取れなければ —').toHaveText('—')
  // 表示の追加で紐付けの導線を壊していないこと（ロジックは変えていない）
  await expect(row.locator('select.site-pick')).toBeVisible()
  await expect(row.locator('button.btn-link'), '現場未選択なら押せない').toBeDisabled()
})
