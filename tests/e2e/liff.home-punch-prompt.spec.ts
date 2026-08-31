// ============================================================
//  liff.home-punch-prompt.spec.ts
//  スケジュールの現場開始/終了時刻が来ているのに未打刻なら、ホームで打刻を促す（Notion: 打刻を促す通知）。
//  ★LINE/メール不達でも気づけるよう、常駐ホームに出す（cron・外部送信なし）。
//
//  ★2026-08-31: 独立した「打刻カード」は廃止し、今日のステータスカードの説明文に畳んだ。
//   理由は2つ。①ステータスカードも「打刻して」と言っており重複していた
//   ②後から生えて下のメニューを押し下げ、押そうとしたものと別のボタンを押させていた
//   （運用者指摘）。ステータスカードは高さを固定してあるので、現場名が入っても下はずれない。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `打刻現場_${TS}`
const SCHED_TITLE = `打刻予定_${TS}`
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

test.describe('ホーム 打刻を促す', () => {
  let accountId = ''
  let workerId = ''
  let siteId = ''

  test.beforeAll(async () => {
    accountId = await getAccountId()
    const u = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
    workerId = u?.[0]?.worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`schedules?title=eq.${encodeURIComponent(SCHED_TITLE)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('今日の勤務予定があり未打刻なら、ホームのステータスが現場名つきで打刻を促す', async ({ page }) => {
    // 念のため今日の当該現場の打刻を消しておく（未打刻状態を作る）
    await restSrv(`attendance_logs?site_id=eq.${siteId}&worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    // 今日・自分の勤務予定（開始はとうに過ぎている 00:01）
    await restSrv('schedules', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, site_id: siteId, title: SCHED_TITLE,
        category: 'work', start_date: TODAY, end_date: TODAY, start_time: '00:01', end_time: '23:59', is_public: false,
      }),
    })
    await page.goto('/', { waitUntil: 'networkidle' })
    const card = page.getByTestId('home-today-card')
    await expect(card, '今日のステータスが出る').toBeVisible({ timeout: 15000 })
    await expect(card, '★どの現場の予定が始まっているか分かる').toContainText(SCHED_TITLE)
    // 出退勤への導線がある
    await expect(page.getByTestId('today-act-checkin')).toHaveAttribute('href', /\/checkin/)
  })

  test('今日の勤務予定が無ければ、現場名は出ない（ステータス自体は出る）', async ({ page }) => {
    await restSrv(`schedules?title=eq.${encodeURIComponent(SCHED_TITLE)}`, { method: 'DELETE' }).catch(() => {})
    await page.goto('/', { waitUntil: 'networkidle' })
    // ホーム自体は出る（メニューが見える）
    await expect(page.locator('.menu-grid').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('home-today-card')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('home-today-card')).not.toContainText(SCHED_TITLE)
  })

  // ★これが今回の主眼: 読み込み前後でメニューの位置が動かないこと。
  //  動くと「押そうとしたものと別のボタンをタップしてしまう」（運用者指摘・2026-08-31）。
  test('★読み込みの前後でメニューの位置が動かない', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    // まだデータが来ていない段階（スケルトンが出ている）でのメニュー位置。
    // ★メニュー自体が描画される前に測ると null になり、比較が無意味になる
    await expect(page.getByTestId('home-today-skeleton')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.menu-grid').first()).toBeVisible({ timeout: 15000 })
    const before = await page.locator('.menu-grid').first().boundingBox()
    // データが来てステータスが出たあとの位置
    await expect(page.getByTestId('home-today-card')).toBeVisible({ timeout: 20000 })
    const after = await page.locator('.menu-grid').first().boundingBox()
    // ★実測でここが 366px ずれていた。内訳は
    //  ①アイコンフォント未ロード中にリガチャ名がそのまま流れてPWA案内が452px→80pxに縮む
    //  ②ステータスカードが後から生える
    //  ①は app.vue でアイコンを1emの箱に閉じ込め、②は today-slot を固定高にして潰した。
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), '★メニューが上下に動かない').toBeLessThanOrEqual(2)
  })
})
