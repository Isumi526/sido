// ============================================================
//  liff.report-edit-diff-trip-gas.spec.ts
//  日報の編集差分に「出張フラグ」「本日のガソリン代」が出ることを固定する。
//
//  ★経緯: computeDiff は 稼働状態/現場/経費/備考 しか比較しておらず、
//   呼び出し側(report.vue)も出張とガソリンを渡していなかった。
//   どちらも金額に効く（出張手当 +¥3,000/日・ガソリン代）のに、書き換えても
//   編集履歴が空＝「何も変えていない」ように見え、承認の監査として穴だった。
//   LINE通知はもう機能していないので、差分の出口は管理画面の「編集理由」欄が正本。
//
//  ここでは差分の“中身”を daily_report_edit_logs.diffs で数値ごと固定する
//  （画面の見た目ではなく、監査に残る実データを見る）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId, fillNoReceiptReasons } from './helpers'

const EDIT_DATE = '2026-10-17'
const TS = Date.now()

let uid = ''
let accountId = ''

/** 指定の出張フラグ・ガソリン明細で当日の日報を作り直す */
async function seedReport(opts: { trip: boolean; gasoline: any[]; expenses?: any }) {
  await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true,
      // ★備考に「出張」「ガソリン」の語を入れない。備考の差分行に混ざると
      //   AC4の「触っていない項目は出ない」判定が誤検知する
      note: 'E2E:差分テスト',
      is_business_trip: opts.trip,
      gasoline_items: opts.gasoline,
      sites: [{
        siteName: 'テスト現場B', workers: [], subcontractors: [],
        expenses: opts.expenses ?? { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
}

test.beforeAll(async () => {
  uid = (await getDevUserId())!
  accountId = await getAccountId()
})

test.afterEach(async () => {
  await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
})

async function openEdit(page: import('@playwright/test').Page) {
  await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 15000 })
}

/** 理由を入れて更新し、記録された差分行を返す */
async function submitAndReadDiffs(page: import('@playwright/test').Page, reason: string): Promise<string[]> {
  await page.getByTestId('edit-reason').fill(reason)
  // 領収書必須化（2026-08-14）。この spec の主題は差分の中身なので理由を書いて進む
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()
  await expect.poll(async () => {
    const logs = await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=diffs`)
    return logs?.length ?? 0
  }, { timeout: 20000 }).toBe(1)
  const logs = await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=diffs`)
  return (logs[0].diffs ?? []) as string[]
}

test('AC1★: 出張フラグを切り替えると差分に出る（なし→あり）', async ({ page }) => {
  await seedReport({ trip: false, gasoline: [] })
  page.on('dialog', (d) => d.accept().catch(() => {}))

  await openEdit(page)
  await page.getByTestId('business-trip-toggle').locator('input[type="checkbox"]').check()

  const diffs = await submitAndReadDiffs(page, `E2E出張ON_${TS}`)
  // ★出張手当が付く/消えるので、履歴に残らないと金額の監査ができない
  expect(diffs.join('\n'), '出張の変更が差分に出る').toContain('出張')
  expect(diffs.some(d => d.includes('なし') && d.includes('あり')), 'なし→あり と分かる').toBe(true)
})

test('AC1★: 出張フラグを外した時も差分に出る（あり→なし）', async ({ page }) => {
  await seedReport({ trip: true, gasoline: [] })
  page.on('dialog', (d) => d.accept().catch(() => {}))

  await openEdit(page)
  await page.getByTestId('business-trip-toggle').locator('input[type="checkbox"]').uncheck()

  const diffs = await submitAndReadDiffs(page, `E2E出張OFF_${TS}`)
  expect(diffs.join('\n'), '出張を外したことも残る').toContain('出張')
})

test('AC2★: 本日のガソリン代の金額変更が差分に出る（金額つきで分かる）', async ({ page }) => {
  await seedReport({
    trip: false,
    gasoline: [{ yen: 5000, payee: 'E2E給油所', registrationNumber: null, liters: 30, fuelType: 'regular', tategae: false, fileUrls: [] }],
  })
  page.on('dialog', (d) => d.accept().catch(() => {}))

  await openEdit(page)
  const card = page.getByTestId('gas-item-0')
  await expect(card, '既存の給油明細が復元される').toBeVisible({ timeout: 15000 })
  await card.locator('.expense-input').fill('8000')

  const diffs = await submitAndReadDiffs(page, `E2Eガソリン変更_${TS}`)
  const joined = diffs.join('\n')
  expect(joined, 'ガソリン代の変更が差分に出る').toContain('ガソリン')
  // ★金額が入っていないと「変わった」だけで監査にならない
  expect(joined, '変更前の金額が分かる').toContain('5,000')
  expect(joined, '変更後の金額が分かる').toContain('8,000')
})

test('AC2★: 給油を「なし」にした時も差分に出る（削除が消えない）', async ({ page }) => {
  await seedReport({
    trip: false,
    gasoline: [{ yen: 5000, payee: 'E2E給油所', registrationNumber: null, liters: 30, fuelType: 'regular', tategae: false, fileUrls: [] }],
  })
  page.on('dialog', (d) => d.accept().catch(() => {}))

  await openEdit(page)
  await page.getByTestId('gas-fueled').selectOption('no')

  const diffs = await submitAndReadDiffs(page, `E2Eガソリン削除_${TS}`)
  const joined = diffs.join('\n')
  expect(joined, 'ガソリン代を消したことが残る').toContain('ガソリン')
  expect(joined, '消える前の金額が分かる').toContain('5,000')
  expect(joined, '「なし」になったと分かる').toContain('なし')
})

test('AC4★: 出張もガソリンも変えていなければ差分に出ない（既存の粒度を変えない）', async ({ page }) => {
  await seedReport({
    trip: false,
    gasoline: [{ yen: 5000, payee: 'E2E給油所', registrationNumber: null, liters: 30, fuelType: 'regular', tategae: false, fileUrls: [] }],
  })
  page.on('dialog', (d) => d.accept().catch(() => {}))

  await openEdit(page)
  // 備考だけ変える
  await page.getByTestId('report-note').fill(`E2E備考_${TS}`)

  const diffs = await submitAndReadDiffs(page, `E2E備考のみ_${TS}`)
  const joined = diffs.join('\n')
  expect(joined, '備考の変更は従来どおり出る').toContain('備考')
  // ★触っていない項目が「変わった」と出ると、履歴がノイズだらけで監査に使えなくなる
  expect(joined, '出張は触っていないので出ない').not.toContain('出張')
  expect(joined, 'ガソリンは触っていないので出ない').not.toContain('ガソリン')
})
