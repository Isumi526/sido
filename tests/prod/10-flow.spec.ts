// ============================================================
//  本番スモーク：出退勤と日報のフローを、実際の業務の順番どおりに通す。
//  接続先は本番URL・demoテナントのアカウント（実テナントのデータには触れない）。
//  画面サイズは iPhone SE 相当（375×667）＝一番狭い端末で崩れないことも同時に見る。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { clearToday, fillBacklog, makeBacklog, punch, todayReport, todayPunches, q, ymd, JST_TODAY } from './helpers.mjs'

test.use({ storageState: 'tests/prod/.auth.json' })

/** 起動時の割り込みを出さない（割り込み自体を見るテストでは呼ばない） */
async function noModal(page: Page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('overdue_report_dismissed','1') } catch {} })
}
/** 打刻の確認画面を通して実際に打刻する */
async function doPunch(page: Page, label: '出勤を記録する' | '退勤を記録する') {
  const rules = page.locator('.rule-row')
  for (let i = 0, n = await rules.count(); i < n; i++) await rules.nth(i).click()
  await page.locator('.loc-get').first().click()
  const btn = page.getByRole('button', { name: label }).last()
  await expect(btn, `${label} が押せる状態になる`).toBeEnabled({ timeout: 30000 })
  await btn.click()
}

test.describe.configure({ mode: 'serial' })

test('① 稼働する日：朝の選択 → 出勤 → ホーム → 退勤 → 日報へ直行', async ({ page }) => {
  clearToday(); fillBacklog()

  // 朝：出退勤を開くと稼働有無を聞かれる
  await noModal(page)
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('work-status'), '★朝いちばんに稼働有無が出る').toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('ws-working')).toBeVisible()
  await expect(page.getByTestId('ws-paid-leave')).toBeVisible()
  await expect(page.getByTestId('ws-off')).toBeVisible()

  // 稼働あり → 出勤打刻
  await page.getByTestId('ws-working').click()
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 30000 })
  await doPunch(page, '出勤を記録する')
  await expect(page.locator('.done-title')).toBeVisible({ timeout: 30000 })
  expect(Number(todayPunches()), '★出勤の打刻が残る').toBe(1)
  // 出勤直後は次アクションが出る
  await expect(page.getByTestId('done-overtime'), '残業申請の導線').toBeVisible()
  await expect(page.getByTestId('done-checkout'), '退勤の導線').toBeVisible()

  // ホーム：出勤中
  await page.goto('/', { waitUntil: 'networkidle' })
  const card = page.getByTestId('home-today-card')
  await expect(card).toBeVisible({ timeout: 30000 })
  await expect(card, '★ホームが「出勤中」を出す').toHaveClass(/working/)
  await expect(page.getByTestId('today-act-checkout')).toBeVisible()

  // 退勤 → 日報へ直行
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.locator('.checklist-header.checkout')).toBeVisible({ timeout: 30000 })
  await doPunch(page, '退勤を記録する')
  await page.waitForURL(/\/report\?date=.*from=checkout&punched=\d{2}:\d{2}/, { timeout: 30000 })
  const toast = page.getByTestId('checkout-toast')
  await expect(toast, '★記録できたことを日報画面の上で伝える').toBeVisible({ timeout: 15000 })
  await expect(toast).toContainText('退勤')
  await expect(toast, '★自動で消える').toHaveCount(0, { timeout: 15000 })
  expect(Number(todayPunches()), '★退勤の打刻も残る').toBe(2)
})

test('② 退勤したのに日報が無い：ホームが赤で促す＋ナビにバッジ', async ({ page }) => {
  // ①の続き（出勤・退勤済み・日報なし）
  await noModal(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  const card = page.getByTestId('home-today-card')
  await expect(card).toBeVisible({ timeout: 30000 })
  await expect(card, '★他の状態と違う見た目で出る').toHaveClass(/report-due/)
  await expect(page.getByTestId('today-act-report')).toBeVisible()
  await expect(page.getByTestId('bottom-nav-badge-history'), '★ナビに未提出バッジ').toHaveText('1')
})

test('③ 稼働なし：朝の選択だけで日報が出て、打刻はされない', async ({ page }) => {
  clearToday(); fillBacklog()
  await noModal(page)
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('work-status')).toBeVisible({ timeout: 30000 })
  await page.getByTestId('ws-off').click()
  await expect(page.getByTestId('off-done'), '★打刻せず完了').toBeVisible({ timeout: 30000 })

  const rep = JSON.parse(todayReport())
  expect(rep.length, '★その場で日報が保存される').toBe(1)
  expect(rep[0].is_working, '★稼働なしで保存').toBe(false)
  expect(rep[0].leave_type).toBeNull()
  expect(Number(todayPunches()), '★打刻は作らない').toBe(0)

  // 開き直しても打刻フォームに入らない
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('off-done'), '★休みの日に打刻させない').toBeVisible({ timeout: 30000 })
  await expect(page.locator('.checklist-header')).toHaveCount(0)
  // 気が変わった時は切り替えられる
  await page.getByTestId('off-done-switch-working').click()
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 30000 })
})

test('④ 有給：有給1日で日報が出る', async ({ page }) => {
  clearToday(); fillBacklog()
  await noModal(page)
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('work-status')).toBeVisible({ timeout: 30000 })
  await page.getByTestId('ws-paid-leave').click()
  await expect(page.getByTestId('off-done')).toBeVisible({ timeout: 30000 })
  const rep = JSON.parse(todayReport())
  expect(rep[0].leave_type, '★有給として残る').toBe('paid_leave')
  expect(Number(rep[0].leave_days), '★終日＝1日').toBe(1)
  expect(Number(todayPunches()), '★打刻しない').toBe(0)
})

test('⑤ その日の日報が既にあれば二度聞かない', async ({ page }) => {
  clearToday(); fillBacklog()
  q(`insert into daily_reports (account_id, user_id, date, is_working, sites, note)
     select a.id, u.id, ${JST_TODAY}, true, '[]'::jsonb, 'smoke'
     from users u join workers w on w.id=u.worker_id join accounts a on a.id=w.account_id
     where a.slug='demo' and w.name='デモ次郎' on conflict (user_id,date) do nothing;`)
  await noModal(page)
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.locator('.checklist-header.checkin'), '★答えが出ているので聞かずに打刻へ')
    .toBeVisible({ timeout: 30000 })
  await expect(page.getByTestId('work-status')).toHaveCount(0)
})

test('⑥ 日報の入口：ナビが「日報履歴」／履歴に未提出の案内が出る', async ({ page }) => {
  clearToday(); fillBacklog()
  await noModal(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('bottom-nav-history'), '★ナビ4つ目が日報履歴').toBeVisible({ timeout: 30000 })
  await expect(page.locator('.app-bottom-nav')).not.toContainText('日報登録')
  await page.getByTestId('bottom-nav-history').click()
  await expect(page).toHaveURL(/\/history/)
  await expect(page.getByTestId('history-unsubmitted'), '★出し忘れの入口が履歴にある')
    .toBeVisible({ timeout: 30000 })
})

test('⑦ 溜まった未提出：起動時に割り込み → まとめて提出できる', async ({ page }) => {
  makeBacklog()
  // ★ここでは割り込みを抑止しない
  await page.goto('/', { waitUntil: 'networkidle' })
  const modal = page.getByTestId('home-overdue-modal')
  await expect(modal, '★開いた時に割り込む').toBeVisible({ timeout: 30000 })
  await page.getByTestId('overdue-later').click()
  await expect(modal, '★「後で」で閉じられる').toHaveCount(0)
  await expect(page.getByTestId('home-today-card'), '閉じたあともホームは使える').toBeVisible()

  await page.goto('/history', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('bulk-open')).toBeVisible({ timeout: 30000 })
  await page.getByTestId('bulk-open').click()
  await expect(page.getByTestId('bulk-panel')).toBeVisible()
  // 期限切れを含むので理由が要る
  await expect(page.getByTestId('bulk-submit'), '★理由なしでは通さない').toBeDisabled()
  await page.getByTestId('bulk-reason').fill('本番スモーク：提出を失念していたため')
  await expect(page.getByTestId('bulk-submit')).toBeEnabled()
  await page.getByTestId('bulk-submit').click()
  await expect(page.getByTestId('bulk-result'), '★結果が出る').toBeVisible({ timeout: 60000 })

  const near = q(`select count(*) from daily_reports dr join users u on u.id=dr.user_id
    join workers w on w.id=u.worker_id join accounts a on a.id=w.account_id
    where a.slug='demo' and w.name='デモ次郎' and dr.date >= ${JST_TODAY} - 2;`).trim()
  const pend = q(`select count(*) from daily_report_pending_edits p join users u on u.id=p.report_user_id
    join workers w on w.id=u.worker_id join accounts a on a.id=w.account_id
    where a.slug='demo' and w.name='デモ次郎' and p.kind='late_new';`).trim()
  expect(Number(near), '★期限内はその場で日報になる').toBeGreaterThan(0)
  expect(Number(pend), '★期限切れは承認待ちに積む（承認を飛ばさない）').toBeGreaterThan(0)
})

test('⑧ 画面が読み込み後に動かない（誤タップ防止）', async ({ page }) => {
  clearToday(); fillBacklog()
  await noModal(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('home-today-skeleton')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.menu-grid').first()).toBeVisible({ timeout: 30000 })
  const before = await page.locator('.menu-grid').first().boundingBox()
  await expect(page.getByTestId('home-today-card')).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1500)
  const after = await page.locator('.menu-grid').first().boundingBox()
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), '★メニューが動かない').toBeLessThanOrEqual(2)
})

test('⑨ 狭い端末で送信ボタンが下部ナビに隠れない', async ({ page }) => {
  clearToday(); fillBacklog()
  await noModal(page)
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('ws-working').click()
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 30000 })
  const m = await page.evaluate(() => {
    const btn = document.querySelector('.btn-submit') as HTMLElement
    const nav = document.querySelector('.app-bottom-nav') as HTMLElement
    const card = document.querySelector('.today-card') as HTMLElement | null
    return { btnBottom: btn.getBoundingClientRect().bottom, navTop: nav.getBoundingClientRect().top, hasCard: !!card }
  })
  console.log(`送信ボタン下端=${Math.round(m.btnBottom)} / ナビ上端=${Math.round(m.navTop)}`)
  expect(m.btnBottom, '★送信ボタンがナビに隠れない').toBeLessThanOrEqual(m.navTop)
})

// ★実測の記録（2026-09-01 本番スモーク）
//  ⑧のずれは 77px → 42px → 30px → 26px → 0px と、直すたびに別の原因が出てきた。
//   1. 経費の締切カードが後から生える（締切前3〜4日だけ・ローカルでは再現しない）
//   2. Webフォントの display=swap で文字の高さが変わる
//   3. スケルトンを別DOMで作っていて box-sizing / 骨格 / 帯の vertical-align がズレる
//   4. アクション行の高さがアイコンフォントの読み込み状態で 40→58px になる
//   5. CSS適用前のブラウザ既定 body 余白 8px
//  「だいたい同じ高さ」に調整する限り必ずまた出る。同じDOM＋固定高さで定義上一致させた。
