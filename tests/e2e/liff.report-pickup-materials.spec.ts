// ============================================================
//  liff.report-pickup-materials.spec.ts
//  日報の各現場に「引き上げ材料」（あり/なし → メモ＋写真複数枚）を追加（2026-09-18 亥角）。
//  ゴミの下に並び、既存フォームのまま入力できる。保存形式は expenses.hasPickup / pickupNote / pickupPhotoUrls。
//  送信前の確認チェックの文言に「引き上げ材料」を含める。
//  ★編集モード（期限外＝承認待ち）で送り、保留の payload に入ったかで判定（新規送信の枯渇に依存しない）。
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getDevUserId, getAccountId, fillNoReceiptReasons } from './helpers'

const EDIT_DATE = '2026-08-26'   // ★期限外の日（期限内の編集は承認なしで即反映＝保留に入らない・判定表 2026-09-12）
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
let uid = ''
let accountId = ''

async function purge() {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
}

test.describe('日報の引き上げ材料', () => {
  test.beforeEach(async () => {
    uid = (await getDevUserId())!
    accountId = await getAccountId()
    await purge()
    await rest('daily_reports?on_conflict=user_id,date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true,
        sites: [{ siteName: 'テスト現場B', workers: [], subcontractors: [],
          expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] } }],
      }),
    })
  })
  test.afterEach(async () => { await purge() })

  test('★ゴミの下に「引き上げ材料」があり、あり→メモ＋写真2枚が保留の内容に入る', async ({ page }) => {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
    const expenseSelect = page.locator('.field:has(> label.label:text-is("経費")) select').first()
    await expenseSelect.selectOption('あり')
    // ゴミの直後に引き上げ材料が並ぶ
    const labels = await page.locator('.field > label.label').allTextContents()
    const gi = labels.findIndex(l => l.trim() === 'ゴミ')
    expect(gi, 'ゴミの欄がある').toBeGreaterThan(-1)
    expect(labels[gi + 1]?.trim(), 'ゴミの次が引き上げ材料').toBe('引き上げ材料')

    await page.getByTestId('pickup-usage').selectOption('あり')
    await page.getByTestId('pickup-note').fill('残材のボード3枚')
    await page.getByTestId('pickup-photos').setInputFiles([
      { name: 'p1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'p2.png', mimeType: 'image/png', buffer: PNG },
    ])
    await fillNoReceiptReasons(page)
    await page.getByTestId('edit-reason').fill('引き上げ材料の記録')
    await page.getByTestId('report-submit').click()

    await expect.poll(async () => {
      const rows = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=payload&order=submitted_at.desc&limit=1`)
      return rows?.[0]?.payload?.sites?.[0]?.expenses?.pickupPhotoUrls?.length ?? 0
    }, { timeout: 30000 }).toBe(2)
    const rows = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=payload&order=submitted_at.desc&limit=1`)
    const exp = rows[0].payload.sites[0].expenses
    expect(exp.hasPickup).toBe(true)
    expect(exp.pickupNote).toBe('残材のボード3枚')
    expect(exp.pickupPhotoUrls[0]).toMatch(/^https?:\/\//)
    expect(exp.pickupPhotos, 'File 実体は保存しない').toBeUndefined()
  })

  test('保存済みの引き上げ材料は、編集で開くと「あり」に復元される', async ({ page }) => {
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ sites: [{ siteName: 'テスト現場B', workers: [], subcontractors: [],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [],
          hasPickup: true, pickupNote: '工具一式', pickupPhotoUrls: ['https://example.com/x.png'] } }] }),
    })
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('pickup-usage')).toHaveValue('あり')
    await expect(page.getByTestId('pickup-note')).toHaveValue('工具一式')
  })

  test('新規送信の確認チェックの文言に「引き上げ材料」が含まれる', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    await expect(page.locator('body')).toContainText(/引き上げ材料等の記入忘れがないか確認しました|送信済み/, { timeout: 20000 })
  })
})
