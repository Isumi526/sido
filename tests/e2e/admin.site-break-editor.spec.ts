// ============================================================
//  admin.site-break-editor.spec.ts
//  現場マスタの「既定休憩(開始時刻+分・複数)」編集: 開始時刻の自動ソート＋時間帯の重なりバリデート。
//  人件費計算の入力を堅くする（重なった休憩で稼働時間が二重に引かれる等を防ぐ）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E休憩編集_${TS}`
let accountId = ''
let respWorkerId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 責任者候補(現場管理者以上)を1人拾う。無ければ任意のworkerを使う。
  const ws = await rest(`workers?account_id=eq.${accountId}&active=eq.true&select=id,permission_role&limit=50`)
  respWorkerId = (ws.find((w: any) => w.permission_role && w.permission_role !== 'worker') ?? ws[0])?.id
  // 既定休憩あり(12:00/60・22:30/30)の現場をseed
  await rest('sites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: SITE, active: true, responsible_worker_id: respWorkerId,
      default_breaks: [{ start: '12:00', minutes: 60 }, { start: '22:30', minutes: 30 }],
    }),
  })
})

test.afterAll(async () => {
  await rest(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
})

test('既定休憩: 重なりはバリデートで保存を止める／開始時刻で自動ソートされる', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.getByPlaceholder(/検索/).fill(SITE)
  const row = page.locator('tr', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.getByRole('button', { name: '編集' }).click()

  const modal = page.locator('.modal-overlay').filter({ hasText: '既定休憩' })
  await expect(modal).toBeVisible()
  // 既存2件(12:00/22:30)が出ている
  await expect(modal.getByTestId('break-start')).toHaveCount(2)

  // ── 重なりバリデート: 12:00-13:00 に重なる 12:30 の休憩を足して保存 → エラーで止まる ──
  await modal.getByTestId('add-break').click()          // 12:00/60 が1件追加される
  await modal.getByTestId('break-start').nth(2).fill('12:30')  // 12:30/60 に(12:00-13:00と重なる)
  await modal.getByRole('button', { name: '保存' }).click()
  await expect(modal.locator('.error')).toContainText('重なって')

  // ── 重なりを解消し、順不同で足して保存 → 開始時刻で自動ソートされる ──
  await modal.getByTestId('break-start').nth(2).fill('08:00')   // 12:30→08:00(重なりなし・最も早い)
  await modal.getByTestId('break-minutes').nth(2).fill('15')
  await modal.getByRole('button', { name: '保存' }).click()
  await expect(modal).toBeHidden({ timeout: 8000 })

  // DBで並びを確認: 08:00 → 12:00 → 22:30 にソートされている
  const [s] = await rest(`sites?name=eq.${encodeURIComponent(SITE)}&select=default_breaks`)
  const starts = (s.default_breaks as any[]).map(b => b.start)
  expect(starts).toEqual(['08:00', '12:00', '22:30'])
})
