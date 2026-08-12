// ============================================================
//  admin.site-hours-preview.spec.ts
//  現場マスタ: 固定勤務時刻＋既定休憩から「何時間勤務になるか」を出す（2026-08-10）
//
//  運用者の要望そのまま:「いま現場設定してるけど、何時間勤務の自動計算ほしい！」
//   ＝ 設定しながら結果が見えないと、休憩を足すたびに何時間になったのか分からない。
//
//  ★このテストの主眼は「数字が日報・人件費と一致すること」。
//   プレビューを自前計算（拘束 − 休憩の合計）で書くと、実際の計算（15分刻み・
//   勤務時間外の休憩を無視・日跨ぎ）とズレて、設定画面と集計で違う数字が出る。
//   なので「自前引き算なら通るが computeWorkerHours なら通らない」ケースを混ぜてある。
//
//  接頭辞 hours-prev- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'hours-prev-'
const SITE = `${PREFIX}現場${TS}`

let accountId = ''

async function purge() {
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`sites?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: sites ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

/** 現場マスタの編集モーダルを開く */
async function openModal(page: Page) {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  // 現場名リンクは詳細ページへ遷移する。編集モーダルは行の「編集」ボタン。
  const row = page.locator('tr', { hasText: SITE }).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.getByRole('button', { name: '編集' }).click()
  await expect(page.getByTestId('add-break')).toBeVisible({ timeout: 10000 })
}

/** 固定勤務時刻と既定休憩を画面上で入れ替える */
async function setSchedule(page: Page, start: string, end: string, breaks: [string, number][]) {
  const times = page.locator('.modal input[type="time"]')
  await times.nth(0).fill(start)
  await times.nth(1).fill(end)

  // 既存の休憩行を全部消してから積み直す（前のケースの残りで数字が変わらないように）
  while (await page.getByTestId('break-start').count()) {
    await page.getByTestId('break-start').first().locator('xpath=../button[last()]').click()
      .catch(async () => { await page.locator('.modal button', { hasText: '×' }).first().click() })
  }
  for (const [s, m] of breaks) {
    await page.getByTestId('add-break').click()
    await page.getByTestId('break-start').last().fill(s)
    await page.getByTestId('break-minutes').last().fill(String(m))
  }
}

test.describe('現場マスタ: 実働時間の自動計算', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, name: SITE, active: true,
        default_start_time: '08:30', default_end_time: '18:00',
        default_breaks: [{ start: '12:00', minutes: 60 }, { start: '10:00', minutes: 30 }, { start: '15:00', minutes: 30 }],
      }),
    })
  })

  test.afterAll(async () => { await purge() })

  test('★運用者の実データ（8:30-18:00・休憩60+30+30）で 7.5時間 と出る', async ({ page }) => {
    await openModal(page)
    // 拘束 9.5h − 休憩 2h = 実働 7.5h
    await expect(page.getByTestId('hours-preview-worked')).toHaveText('7.5')
    await expect(page.getByTestId('hours-preview')).toContainText('拘束 9.5h')
    await expect(page.getByTestId('hours-preview')).toContainText('休憩 2h')
    // 7.5h は8時間未満なので残業タグは出ない
    await expect(page.getByTestId('hours-preview-ot')).toHaveCount(0)
  })

  test('休憩を足すと実働がその場で減る（設定しながら結果が見える）', async ({ page }) => {
    await openModal(page)
    await setSchedule(page, '08:00', '17:00', [])
    await expect(page.getByTestId('hours-preview-worked'), '休憩なし＝9h').toHaveText('9')

    await page.getByTestId('add-break').click()
    await page.getByTestId('break-start').last().fill('12:00')
    await page.getByTestId('break-minutes').last().fill('60')
    await expect(page.getByTestId('hours-preview-worked'), '休憩1hで8h').toHaveText('8')
  })

  test('★8時間を超えたら残業として出る（人件費の割増に効くため）', async ({ page }) => {
    await openModal(page)
    await setSchedule(page, '08:00', '19:00', [['12:00', 60]])
    // 拘束11h − 休憩1h = 実働10h。うち8h超の2hが残業。
    await expect(page.getByTestId('hours-preview-worked')).toHaveText('10')
    await expect(page.getByTestId('hours-preview-ot')).toContainText('2')
  })

  test('★勤務時間の外に置いた休憩は実働から引かれず、その旨が出る', async ({ page }) => {
    await openModal(page)
    // 06:00の休憩は 08:00-17:00 の外＝実際の計算では無視される。
    // ★「拘束 − 休憩の合計」で自前計算すると 8h と出てしまい、日報の実働(9h)と食い違う。
    await setSchedule(page, '08:00', '17:00', [['06:00', 60]])
    await expect(page.getByTestId('hours-preview-worked'), '外の休憩は引かれない＝9h').toHaveText('9')
    await expect(page.getByTestId('hours-preview-ignored'), '黙って合わないのではなく理由を出す').toBeVisible()
  })

  test('固定勤務時刻が空なら何も出さない（未設定の現場に数字を出さない）', async ({ page }) => {
    await openModal(page)
    const times = page.locator('.modal input[type="time"]')
    await times.nth(0).fill('')
    await expect(page.getByTestId('hours-preview')).toHaveCount(0)
  })
})
