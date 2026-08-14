// ============================================================
//  liff.checkout-to-report.spec.ts
//  退勤打刻のあと、そのまま日報送信画面へ進める（2026-08-10）
//
//  運用者の逐語（電話）:「退勤して、この体験した後にいつものページに飛んで」
//   狙いは2つ。①打刻と日報の二度手間をなくす ②「退勤を押す癖」がつく（打刻忘れ防止）。
//
//  ★このテストで守る一番大事なこと:
//   遷移先が「打刻した日・打刻した現場」であること。
//   日報画面は本来「最初の未送信日」を自動で開く。そのままだと退勤した今日ではなく
//   何日も前の未送信日が開いて、別の日の日報を書かせてしまう（打刻→日報の意味が消える）。
//   なので古い未送信日をわざと残した状態で、今日が開くことを固定する。
//
//  ★もう一つ: 作業時刻は打刻の実時刻ではなく現場の固定勤務時刻が入ること。
//   人件費は管理者設定ベースのまま、という運用ルール（同じ電話で明言）を崩さないため。
//
//  接頭辞 E2E退勤導線 のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E退勤導線現場_${TS}`
const today = new Date()
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

// ★位置情報が取れないと送信ボタンが disabled のまま（canSubmit に locationResolved が入っている）。
//  headless では既定で解決しないので明示的に許可＋座標を与える。
test.use({ geolocation: { latitude: 35.6812, longitude: 139.7671 }, permissions: ['geolocation'] })

let accountId = ''
let siteId = ''
let workerId = ''
let userId = ''

async function purge() {
  await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?name=like.E2E%E9%80%80%E5%8B%A4%E5%B0%8E%E7%B7%9A*`, { method: 'DELETE' }).catch(() => {})
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  siteId = (await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: SITE, active: true,
      // 固定勤務時刻あり＝打刻の実時刻ではなくこちらが日報に入ることを見る
      default_start_time: '08:30', default_end_time: '18:00',
      default_breaks: [{ start: '12:00', minutes: 60 }],
    }),
  }))[0].id

  const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
  userId = users[0].id
  workerId = users[0].worker_id

  // 今日の日報は消しておく（あると導線を出さない仕様なので前提が崩れる）
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
})

test.afterAll(async () => { await purge() })

/** 現場の select（先頭の select は元請け業者なので、現場名が選択肢に在る方を採る） */
function siteSelectOf(page: import('@playwright/test').Page) {
  return page.locator('select').filter({ has: page.locator(`option[value="${SITE}"]`) }).first()
}

/** 出勤済みの状態を作ってから /checkin を開く（＝退勤ボタンが出る） */
async function seedCheckedIn() {
  await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, worker_id: workerId, type: 'checkin', agreed_rule_texts: [] }),
  })
}

/** 出勤中の現場から退勤打刻を完了させる（出勤中専用画面 → 確認 → 記録） */
async function doCheckout(page: import('@playwright/test').Page) {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('focus-checkout').click()
  // ★位置情報は「明示タップで取得を試みる」設計（iOS LINEで自動要求だと無言で拒否されるため）。
  //  タップしないと locationState が idle のままで送信ボタンが永久に disabled。
  await page.locator('.loc-get').first().click()
  const submit = page.getByRole('button', { name: '退勤を記録する' }).last()
  await expect(submit, '位置情報が解決して送信できる状態になる').toBeEnabled({ timeout: 20000 })
  await submit.click()
}

test('★退勤打刻の完了画面に日報への導線が出る', async ({ page }) => {
  await seedCheckedIn()

  await doCheckout(page)

  const link = page.getByTestId('checkout-report-link')
  await expect(link, '退勤したらそのまま日報へ行ける').toBeVisible({ timeout: 20000 })
  // ★打刻した日と現場を引き継ぐ（日報側で選び直させない）
  const href = await link.getAttribute('href')
  expect(href, '打刻した日付を引き継ぐ').toContain(`date=${TODAY}`)
  expect(decodeURIComponent(href ?? ''), '打刻した現場を引き継ぐ').toContain(SITE)
})

test('★遷移先は打刻した日。古い未送信日があってもそちらへ飛ばされない', async ({ page }) => {
  // 日報画面の既定は「最初の未送信日」。それに引きずられないことを見る。
  await page.goto(`/report?date=${TODAY}&site=${encodeURIComponent(SITE)}`, { waitUntil: 'networkidle' })

  // 日付は入力欄ではなく確定表示（.date-fixed）
  const dateFixed = page.locator('.date-fixed').first()
  await expect(dateFixed).toBeVisible({ timeout: 20000 })
  await expect(dateFixed, '★退勤した今日が開く（未送信日に飛ばされない）').toContainText(TODAY)
})

test('★現場が入っていて、作業時刻は現場の固定勤務時刻になる（打刻の実時刻を入れない）', async ({ page }) => {
  await page.goto(`/report?date=${TODAY}&site=${encodeURIComponent(SITE)}`, { waitUntil: 'networkidle' })

  // 先頭の select は元請け業者。現場は 04 現場セクションの中。
  const siteSelect = siteSelectOf(page)
  await expect(siteSelect, '現場が既に入っている').toHaveValue(SITE, { timeout: 20000 })

  // 固定勤務時刻 08:30-18:00 が作業時刻に入る＝人件費は管理者設定ベースのまま
  const body = page.locator('body')
  await expect(body).toContainText('08:30')
  await expect(body).toContainText('18:00')
})

// ★2026-08-14 発見: 現場の在庫判定に siteWorkTimes（固定勤務時刻を設定した現場だけ）を
//  使っていたため、勤務時刻を設定していない現場では引き継ぎが効かなかった。
//  本番の有効な現場128件中122件が該当＝打刻から飛んでも結局選び直しで、機能がほぼ死んでいた。
test('★固定勤務時刻を設定していない現場でも、現場は引き継がれる', async ({ page }) => {
  const PLAIN = `E2E退勤導線_時刻なし_${TS}`
  const id = (await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: PLAIN, active: true }),   // 勤務時刻を入れない
  }))[0].id
  try {
    await page.goto(`/report?date=${TODAY}&site=${encodeURIComponent(PLAIN)}`, { waitUntil: 'networkidle' })
    const sel = page.locator('select').filter({ has: page.locator(`option[value="${PLAIN}"]`) }).first()
    await expect(sel, '★勤務時刻が未設定でも現場が入る').toHaveValue(PLAIN, { timeout: 20000 })
  } finally {
    await restSrv(`sites?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('マスタに無い現場名を渡されても、入っているフリをしない（空のまま）', async ({ page }) => {
  await page.goto(`/report?date=${TODAY}&site=${encodeURIComponent('存在しない現場' + TS)}`, { waitUntil: 'networkidle' })
  const siteSelect = siteSelectOf(page)
  await expect(siteSelect).toBeVisible({ timeout: 20000 })
  await expect(siteSelect, '★選択済みに見えて実は未選択、が一番たちが悪い').toHaveValue('')
})

test('その日の日報を既に出していれば導線を出さない（二重送信を誘発しない）', async ({ page }) => {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: TODAY, is_working: true,
      sites: [{ siteName: SITE, workers: [], subcontractors: [], expenses: {} }],
    }),
  })
  try {
    await seedCheckedIn()
    await doCheckout(page)

    // 完了画面には出たが、日報導線は出ていないこと
    await expect(page.locator('.done-title')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('checkout-report-link')).toHaveCount(0)
  } finally {
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
  }
})
