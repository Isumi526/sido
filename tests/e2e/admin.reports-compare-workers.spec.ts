// ============================================================
//  admin.reports-compare-workers.spec.ts
//  日報一覧: 作業員を複数選ぶと「行=日付・列=作業員」の比較ビューに切り替わる。
//   ・0/1人 → 従来のカード一覧
//   ・2人以上 → 比較ビュー（同じ日付が横一列に並び、日報が無い人は「日報なし」）
//   ・選択は ?worker=A,B に入り、リロードで復元される（旧 ?worker=単一 リンクも従来どおり）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E比較_${TS}`
const WORKER_A = `E2E比較A_${TS}`
const WORKER_B = `E2E比較B_${TS}`
const SITE_A = `E2E比較A現場_${TS}`
const SITE_B = `E2E比較B現場_${TS}`

// 当月・非日曜。A と B で片方だけの日を作り「日報なし」セルも検証する。
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const pickNonSunday = (cands: number[]) => cands.find(d => new Date(`${ym}-${String(d).padStart(2, '0')}T00:00:00`).getDay() !== 0)!
const DAY_BOTH = pickNonSunday([6, 7, 8])       // A・B 両方が稼働
const DAY_A_ONLY = pickNonSunday([26, 27, 28])  // A だけ稼働 → B のセルは「日報なし」
const DATE_BOTH = `${ym}-${String(DAY_BOTH).padStart(2, '0')}`
const DATE_A_ONLY = `${ym}-${String(DAY_A_ONLY).padStart(2, '0')}`

let accountId = ''
const userIds: string[] = []
const workerIds: string[] = []

async function seedWorker(name: string): Promise<string> {
  const worker = (await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name, role: 'site', daily_wage: 20000, active: true, sort_order: 950 }),
  }))[0]
  workerIds.push(worker.id)
  const user = (await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: name, worker_id: worker.id, worker_role: 'site', is_approved: true, line_user_id: `e2e-cmp-${name}` }),
  }))[0]
  userIds.push(user.id)
  return user.id
}

async function seedReport(userId: string, date: string, siteName: string, workerName: string) {
  await restSrv('daily_reports?on_conflict=user_id,date', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: true, note: `${TOKEN}_${date}_${workerName}`,
      sites: [{
        siteName,
        workers: [{ workerName, workerRole: 'site', startTime: '08:00', endTime: '18:00', breakMinutes: 120 }],
        expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [],
      }],
    }),
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const userA = await seedWorker(WORKER_A)
  const userB = await seedWorker(WORKER_B)
  await seedReport(userA, DATE_BOTH, SITE_A, WORKER_A)
  await seedReport(userB, DATE_BOTH, SITE_B, WORKER_B)
  await seedReport(userA, DATE_A_ONLY, SITE_A, WORKER_A)   // B は日報なし
})

test.afterAll(async () => {
  await restSrv(`daily_reports?note=like.${encodeURIComponent(TOKEN)}*`, { method: 'DELETE' }).catch(() => {})
  for (const id of userIds)   await restSrv(`users?id=eq.${id}`,   { method: 'DELETE' }).catch(() => {})
  for (const id of workerIds) await restSrv(`workers?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
})

async function pickWorkers(page: any, names: string[]) {
  await page.locator('[data-testid="worker-filter"] .caret').click()
  await expect(page.locator('[data-testid="worker-menu"]')).toBeVisible()
  for (const n of names) {
    await page.locator('.worker-menu-item', { hasText: n }).locator('input[type="checkbox"]').check()
  }
  await page.locator('.page-title').click()   // メニュー外クリックで閉じる
}

test('1人だけの選択では従来のカード一覧のまま', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  await pickWorkers(page, [WORKER_A])
  await expect(page.locator('.report-list')).toBeVisible()
  await expect(page.locator('[data-testid="compare-view"]')).toHaveCount(0)
})

test('2人選ぶと 行=日付・列=作業員 の比較ビューになり、日報が無い人は「日報なし」', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  await pickWorkers(page, [WORKER_A, WORKER_B])

  const table = page.locator('[data-testid="compare-view"] .compare-table')
  await expect(table).toBeVisible()
  // 列見出し = 日付 ＋ 選んだ2人
  await expect(table.locator('thead th')).toHaveText(['日付', WORKER_A, WORKER_B])

  // 両方稼働した日: 同じ行に A・B それぞれの現場が並ぶ
  const bothRow = table.locator('tbody tr', { hasText: DATE_BOTH.slice(5).replace('-', '/') })
  await expect(bothRow.locator('td').nth(1)).toContainText(SITE_A)
  await expect(bothRow.locator('td').nth(2)).toContainText(SITE_B)

  // A だけの日: B のセルは「日報なし」
  const aOnlyRow = table.locator('tbody tr', { hasText: DATE_A_ONLY.slice(5).replace('-', '/') })
  await expect(aOnlyRow.locator('td').nth(1)).toContainText(SITE_A)
  await expect(aOnlyRow.locator('td').nth(2)).toContainText('日報なし')
})

test('比較ビューのセルから既存の日報詳細モーダルが開く', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  await pickWorkers(page, [WORKER_A, WORKER_B])
  await page.locator('[data-testid="compare-view"] .compare-entry-head').first().click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.modal-date')).toHaveText(/\d{4}-\d{2}-\d{2}/)
})

test('選択は URL に入り、リロードしても比較ビューが復元される', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  await pickWorkers(page, [WORKER_A, WORKER_B])
  await expect(page).toHaveURL(new RegExp(`worker=.*${encodeURIComponent(WORKER_A)}`.replace(/[()]/g, '.')))

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="compare-view"] .compare-table thead th'))
    .toHaveText(['日付', WORKER_A, WORKER_B])
})

test('旧リンク ?worker=単一 は従来どおりカード一覧で開く', async ({ page }) => {
  await page.goto(`/reports?worker=${encodeURIComponent(WORKER_A)}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.chip')).toContainText(WORKER_A)
  await expect(page.locator('.report-list')).toBeVisible()
  await expect(page.locator('[data-testid="compare-view"]')).toHaveCount(0)
})
