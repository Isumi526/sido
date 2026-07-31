// ============================================================
//  admin.other-expense-merge.spec.ts
//  日報フォームの「その他」と「その他雑経費」を入力1本に統合した件（案B）の回帰防止。
//
//  ★このspecが守っているのは「入力が1つになったこと」ではなく、
//   **統合しても現場別集計の金額が別の列へ移動しないこと**。
//   現場別集計は entertainments を「接待交際費」列、others を「ホーム」列に集計している。
//   保存時の科目による振り分けが壊れると、金額は消えないが列が黙って入れ替わる
//   （＝過去と比較できなくなる。金額系の事故で一番気づきにくい type）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, upsert, getDevUserId, getAccountId } from './helpers'
import { SEED_WORKER } from './global-setup'

// 他テストと混ざらないよう専用の現場に隔離する。
// ★現場別集計は現場マスタ(active)基準でタブを作るので、マスタにも登録が要る。
const TS = Date.now()
const SEED_SITE = `E2E統合現場${TS}`
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const SEED_DATE = `${YM}-09`
let accountId = ''

test.describe('その他/その他雑経費の入力統合（集計の列が動かないこと）', () => {
  test.beforeAll(async () => {
    const userId = await getDevUserId()
    accountId = await getAccountId()
    await rest('sites', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: SEED_SITE, active: true }) })
    await upsert('daily_reports', 'user_id,date', {
      user_id: userId, date: SEED_DATE, is_working: true, account_id: accountId,
      note: 'E2E:その他統合',
      sites: [{
        siteName: SEED_SITE,
        workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
        expenses: {
          vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
          // others = ホーム列に集計される（科目は消耗品費に導出）
          others: [{ label: 'E2E養生テープ', yen: 1100, tategae: false }],
          // entertainments = 接待交際費列に集計される（科目は接待交際費に導出）
          entertainments: [{ label: 'E2E懇親会', yen: 2200, tategae: false, companions: 'E2E元請け 山田様' }],
        },
        subcontractors: [],
      }],
    })
  })

  test.afterAll(async () => {
    await rest(`daily_reports?user_id=eq.${await getDevUserId()}&date=eq.${SEED_DATE}`, { method: 'DELETE' }).catch(() => {})
    await rest(`sites?name=eq.${encodeURIComponent(SEED_SITE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('旧データ（others と entertainments が別配列）が現場別集計で別々の列に出る', async ({ page }) => {
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    await page.locator('.tab', { hasText: SEED_SITE }).first().click()
    const row = page.locator('tbody tr', { hasText: SEED_WORKER }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    // 接待交際費列に entertainments の 2,200、ホーム列に others の 1,100 が入る（列が入れ替わらない）
    const cells = row.locator('td.num')
    const texts = await cells.allTextContents()
    expect(texts.join('|'), 'entertainments は接待交際費列（¥2,200）').toContain('¥2,200')
    expect(texts.join('|'), 'others はホーム列（¥1,100）').toContain('¥1,100')
  })

  test('日毎集計では科目で区別される（両方1本の台帳に出る）', async ({ page }) => {
    await page.goto(`/expenses-daily?ym=${YM}`, { waitUntil: 'networkidle' })
    const teepe = page.locator('table tbody tr', { hasText: 'E2E養生テープ' }).first()
    const kanshin = page.locator('table tbody tr', { hasText: 'E2E懇親会' }).first()
    await expect(teepe).toBeVisible({ timeout: 15000 })
    await expect(teepe, 'その他 → 消耗品費').toContainText('消耗品費')
    await expect(kanshin, 'その他雑経費 → 接待交際費').toContainText('接待交際費')
  })
})
