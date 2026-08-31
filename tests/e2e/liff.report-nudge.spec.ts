// ============================================================
//  liff.report-nudge.spec.ts
//  「退勤したのに日報を出さない」を減らすための一連の仕掛け（2026-08-31）。
//
//  ★運用者の逐語（2026-08-31）:
//   「この完了画面一枚挟むと、ここで日報の動線に気づかずにアプリ閉じちゃう人がいるなと思って。
//     完了しましたは、なんか、数秒だけ表示するようなダイアログ的な形でいいかなと思ってて、
//     続けて日報を送信してくださいみたいな方に飛ばす」
//   「退勤しているが日報が書いてないみたいなところはちょっと強制力持たせて。
//     またアプリ開いたらなんかリダイレクトさせるなり、なんかやることリストに置くなり」
//   「今出勤中なのか、今日まだ出勤が押されてないとか…次のアクションだったり動線が
//     分かりやすいようにしてほしい」
//
//  ★守ること:
//   ・退勤の完了画面で止めない（放っておくと日報画面へ行く）
//   ・ホームが今日の状態を言い、次に押すものを必ず出す
//   ・退勤済み×日報未提出は目立つ形で出る（他の状態と同じ見た目にしない）
//   ・溜まっている未提出があるとアプリを開いた時に割り込む。ただし閉じられる
//     （ブロックはしない方針＝2026-08-10「そこの制限は、そこまで厳しくできない」）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const today = new Date()
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const ymd = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
  .format(new Date(Date.now() - n * 86400000))

test.use({ geolocation: { latitude: 35.6812, longitude: 139.7671 }, permissions: ['geolocation'] })

let accountId = ''
let userId = ''
let workerId = ''

async function clearToday() {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${TODAY}T00:00:00%2B09:00`,
    { method: 'DELETE' }).catch(() => {})
}

/** 今日の打刻を直接作る（UIを通さず状態だけ作る。ホーム表示の検証が目的なので打刻UIは通さない） */
async function seedPunch(type: 'checkin' | 'checkout', hhmm: string) {
  await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      worker_id: workerId, type, agreed_rule_texts: [], backdated: false,
      checked_at: new Date(`${TODAY}T${hhmm}:00+09:00`).toISOString(),
    }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
  userId = users[0].id
  workerId = users[0].worker_id
})

/** 過去の未提出（＝起動時の割り込み）が被らないよう、直近数日を提出済みにする */
async function fillBacklog() {
  for (const n of [1, 2, 3, 4, 5]) {
    await restSrv('daily_reports?on_conflict=user_id,date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, date: ymd(n),
        is_working: false, sites: [], note: 'E2E:割り込み判定の前提を作るため',
      }),
    }).catch(() => {})
  }
}

test.beforeEach(async () => { await clearToday() })
test.afterAll(async () => {
  await clearToday()
  // ★このspecは report_start_date を動かす。戻さないと後続specの未提出日の起点がズレる
  //  （実際 liff.report-bulk-submit が落ちた）。global-setup が入れる値へ戻す。
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ report_start_date: ymd(2) }),
  }).catch(() => {})
})

test('★退勤したら完了画面を挟まず日報画面へ直行する', async ({ page }) => {
  // 出勤済み・未退勤にしておく（/checkin を開くと退勤フォームになる）
  await seedPunch('checkin', '08:30')

  await page.goto('/checkin', { waitUntil: 'networkidle' })
  // 共通の確認ルールが登録されていると全チェックまで送信できない。ここの主題ではないので全部押す
  const rules = page.locator('.rule-row')
  for (let i = 0, n = await rules.count(); i < n; i++) await rules.nth(i).click()
  // 位置情報は明示タップで取得する設計（iOS LINEは自動要求だと無言で拒否されるため）
  await page.locator('.loc-get').first().click()
  const submit = page.getByRole('button', { name: '退勤を記録する' }).last()
  await expect(submit).toBeEnabled({ timeout: 20000 })
  await submit.click()

  // ★完了画面を挟まない。押した時点で日報画面へ行く
  //  （一枚挟むと、その表示のところで離脱する人がいる・2026-08-31 運用者指摘）
  await page.waitForURL(/\/report\?date=.*from=checkout&punched=\d{2}:\d{2}/, { timeout: 20000 })
  // 手応えは日報画面の中央に重なって出る（背後にフォームが透けて次にやることが分かる）
  const toast = page.getByTestId('checkout-toast')
  await expect(toast, '★打刻できたことを日報画面の上で伝える').toBeVisible({ timeout: 10000 })
  await expect(toast).toContainText('退勤')
  // 自動で引く（押さなくても消える）
  await expect(toast, '★自動で消えてフォームが使える').toHaveCount(0, { timeout: 10000 })
})

test('★ホームが「出勤中」と次のアクションを出す', async ({ page }) => {
  await seedPunch('checkin', '08:30')
  await fillBacklog()
  await page.goto('/', { waitUntil: 'networkidle' })

  const card = page.getByTestId('home-today-card')
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(card).toHaveClass(/working/)
  await expect(page.getByTestId('home-today-title')).toContainText('出勤中')
  await expect(card).toContainText('08:30')
  // 次に押すものが必ずある（状態を告げるだけにしない）
  await expect(page.getByTestId('today-act-checkout'), '★退勤の導線').toBeVisible()
  await expect(page.getByTestId('today-act-overtime'), '★残業申請の導線').toBeVisible()
})

test('★退勤済みで日報が無いと、ホームが目立つ形で促す', async ({ page }) => {
  await seedPunch('checkin', '08:30')
  await seedPunch('checkout', '18:32')
  await fillBacklog()

  await page.goto('/', { waitUntil: 'networkidle' })
  const card = page.getByTestId('home-today-card')
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(card, '★他の状態と同じ見た目にしない').toHaveClass(/report-due/)
  await expect(card).toContainText('18:32')
  await expect(page.getByTestId('today-act-report'), '★日報への導線').toBeVisible()
  await page.getByTestId('today-act-report').click()
  await expect(page).toHaveURL(new RegExp(`/report\\?date=${TODAY}`))
})

test('★出勤前は「まだ出勤していない」と出て、出退勤へ誘導する', async ({ page }) => {
  await fillBacklog()
  await page.goto('/', { waitUntil: 'networkidle' })
  const card = page.getByTestId('home-today-card')
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(card).toHaveClass(/not-punched/)
  await expect(page.getByTestId('today-act-checkin')).toBeVisible()
})

test('★稼働なしの日は急かさない（打刻を求めない）', async ({ page }) => {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: TODAY,
      is_working: false, sites: [], note: 'E2E:稼働なし',
    }),
  })
  await fillBacklog()
  await page.goto('/', { waitUntil: 'networkidle' })
  const card = page.getByTestId('home-today-card')
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(card).toHaveClass(/off/)
  await expect(page.getByTestId('today-act-checkin'), '休みの日に出勤を促さない').toHaveCount(0)
})

test('★溜まっている未提出があるとアプリを開いた時に割り込む。ただし閉じられる', async ({ page }) => {
  // 過去日を確実に未提出にする（起点を4日前に下げ、その範囲の日報を消す）
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ report_start_date: ymd(4) }),
  })
  for (const n of [0, 1, 2, 3, 4]) {
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${ymd(n)}`, { method: 'DELETE' }).catch(() => {})
  }

  await page.goto('/', { waitUntil: 'networkidle' })
  const modal = page.getByTestId('home-overdue-modal')
  await expect(modal, '★開いた時に割り込む').toBeVisible({ timeout: 20000 })
  await expect(modal).toContainText('未提出')

  // ★閉じられること（画面を塞がない＝ブロックしない方針）
  await page.getByTestId('overdue-later').click()
  await expect(modal).toHaveCount(0)
  // 閉じたあともホームは普通に使える
  await expect(page.getByTestId('home-today-card')).toBeVisible()
})
