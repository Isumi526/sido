// ============================================================
//  liff.report-steps.spec.ts
//  日報のステップ式（第2フォーム・2026-10-02 設計「日報の入力と承認画面」R-3）。
//
//  ★守ること:
//   1. 日報画面の上で「いつもの画面」と「1つずつ入力」を切り替えられる。選んだ方がサーバにも残る（次回の既定）
//   2. 1つずつ入力: 日付・稼働 → 現場 → 経費 → ゴミ → 引き上げ → 備考 → 確認 の順に1画面ずつ。戻れる
//   3. 現場を選ばずに「次へ」を押しても進まない（必須欄を飛ばさない）
//   4. ステップ式で送った日報は、いつもの画面で開いても同じ内容（同じ入力欄・同じ保存処理を使う）
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId } from './helpers'

const jstDay = (offset: number) => new Date(Date.now() - offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
const DAY = jstDay(1)
const NOTE = `E2Eステップ式_${Date.now()}`

let userId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const workerId = await devUserWorkerId()
  userId = (await restSrv(`users?worker_id=eq.${workerId}&account_id=eq.${accountId}&select=id&order=created_at&limit=1`))[0].id
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}`, { method: 'DELETE' }).catch(() => {})
})
test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ report_form_pref: null }) }).catch(() => {})
})

test('★1つずつ入力で送った日報が、いつもの画面で同じ内容に見える', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('report_form_mode') } catch { /* noop */ } })
  await page.goto(`/report?date=${DAY}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('form-mode-tabs')).toBeVisible({ timeout: 20000 })

  // 切り替え。選んだ方がサーバに残る（次回の既定）
  await page.getByTestId('form-mode-steps').click()
  await expect(page.getByTestId('step-title')).toHaveText('日付と稼働')
  await expect.poll(async () => (await restSrv(`users?id=eq.${userId}&select=report_form_pref`))[0].report_form_pref, { timeout: 10000 }).toBe('steps')
  await expect(page.getByTestId('report-note'), '備考は今は出ない（1画面ずつ）').toBeHidden()

  // 現場: 選ばずに次へ → 進まない
  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('step-title')).toHaveText('現場')
  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('step-title'), '現場を選ばないと進まない').toHaveText('現場')

  const siteSel = page.getByTestId('site-select-0')
  const siteValue = await siteSel.locator('option').nth(2).getAttribute('value')
  await siteSel.selectOption(siteValue!)
  await page.waitForTimeout(500)
  await page.getByTestId('step-next').click()

  await expect(page.getByTestId('step-title')).toHaveText('経費')
  await page.getByTestId('step-next').click()

  await expect(page.getByTestId('step-title')).toHaveText('ゴミ')
  await page.getByTestId('step-garbage-usage-0').selectOption('あり')
  await page.locator('[data-step="garbage"] input.expense-input').first().fill('1.5')
  await page.getByTestId('step-next').click()

  await expect(page.getByTestId('step-title')).toHaveText('引き上げ材料')
  // 戻れる
  await page.getByTestId('step-back').click()
  await expect(page.getByTestId('step-title')).toHaveText('ゴミ')
  await page.getByTestId('step-next').click()
  await page.getByTestId('step-next').click()

  await expect(page.getByTestId('step-title')).toHaveText('備考')
  await page.getByTestId('report-note').fill(NOTE)
  await page.getByTestId('step-next').click()

  await expect(page.getByTestId('step-title')).toHaveText('確認して送信')
  await page.getByTestId('omission-confirm').check()
  await page.getByTestId('report-submit').click()

  await expect.poll(async () => (await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}&select=note,sites`))[0]?.note ?? null, { timeout: 20000 }).toBe(NOTE)
  const saved = (await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}&select=note,sites`))[0]
  expect(saved.sites[0].siteName, '選んだ現場').toBe(siteValue)
  expect(Number(saved.sites[0].expenses?.garbageFactoryM3), 'ゴミの量').toBe(1.5)

  // 次に開いた時も、サーバに残した「1つずつ入力」が既定（端末の選択が無い時）
  await page.goto(`/report?edit=${DAY}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('form-mode-steps'), '次回の既定').toHaveAttribute('aria-selected', 'true', { timeout: 20000 })

  // いつもの画面に切り替えても同じ内容
  await page.getByTestId('form-mode-classic').click()
  await expect(page.getByTestId('form-mode-classic')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('report-note')).toHaveValue(NOTE)
  await expect(page.getByTestId('site-select-0')).toHaveValue(siteValue!)
  await expect(page.getByTestId('step-head'), 'いつもの画面にはステップの見出しは出ない').toHaveCount(0)
})
