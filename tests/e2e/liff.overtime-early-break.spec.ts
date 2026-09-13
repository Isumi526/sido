// ============================================================
//  liff.overtime-early-break.spec.ts
//  早朝入り・休憩なしの通し勤務を、申請＋承認で労働時間に反映できる。
//
//  出所（2026-08-10 大塚さんとの電話・逐語）:
//   「実際、6時からやってますとかあった時とかは、あらかじめ、残業申請の方でやるしか
//     なくて、早朝という…早朝出勤というのもいるんだよね」
//   「10時休憩せずに、もうそのままぶっ通しでやりました…残業申請みたいな感じで申請を
//     出せば、じゃあいいよ、って修正させてあげたい」
//
//  ★このテストで守る一番大事なこと:
//   承認されるまでは早出を入力できないこと。申請しただけで時間を広げられるなら
//   「管理者が一番目に決めた時間がマスタ」（同じ電話）という原則が崩れ、
//   架空の労働時間を自分で作れてしまう。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E早朝現場_${TS}`
const SITE2 = `E2E夜勤現場_${TS}`   // 2現場目（申請内容の変更・追加テスト用）
const DATE = '2026-12-24'

let accountId = ''
let siteId = ''
let site2Id = ''
let workerId = ''
let userId = ''

async function seedReport() {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true, note: 'E2E早朝',
      sites: [{
        siteName: SITE, site_id: siteId, contractorName: '', subcontractors: [],
        workers: [{ workerName: 'Worker 01', workerId, startTime: '08:30', endTime: '18:00' }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
}

/** 申請を直接作る（申請UIの締切ルール＝当日16時までに縛られずに承認後の挙動を見る） */
async function seedRequest(status: string, extra: Record<string, unknown>) {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: DATE, status, ...extra }),
  })
}

/** 現場の開始時刻セレクトが持つ選択肢 */
async function startOptions(page: import('@playwright/test').Page): Promise<string[]> {
  const sel = page.locator('select').filter({ has: page.locator('option[value="08:30"]') }).first()
  await expect(sel).toBeVisible({ timeout: 20000 })
  return await sel.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
}

test.describe('早朝入り・休憩なしの申請', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: SITE, active: true,
        default_start_time: '08:30', default_end_time: '18:00',
        default_breaks: [{ start: '12:00', minutes: 60 }],
      }),
    }))[0].id
    site2Id = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE2, active: true }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${site2Id}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★承認されていなければ、固定開始より前は選べない（架空の早出を作れない）', async ({ page }) => {
    await seedRequest('pending', { requested_start_time: '06:00' })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    const opts = await startOptions(page)
    expect(opts, '★申請しただけでは早出は入力できない').not.toContain('06:00')
    expect(opts, '固定開始は選べる').toContain('08:30')
  })

  test('★承認されると、その日だけ申請した時刻まで早出を入力できる', async ({ page }) => {
    await seedRequest('approved', { requested_start_time: '06:00' })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    await expect
      .poll(async () => (await startOptions(page)).includes('06:00'),
        { message: '★承認された早朝入りの時刻まで下限が下がる', timeout: 20000 })
      .toBe(true)
    await expect(page.getByTestId('approved-early-start'), '何が承認されたか分かる')
      .toContainText('06:00', { timeout: 15000 })
  })

  test('★休憩なしが承認されると、その日の休憩は0分として扱われる', async ({ page }) => {
    await seedRequest('approved', { requested_break_minutes: 0 })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('approved-break'), '★休憩なしで通したことが反映される')
      .toContainText('なし', { timeout: 20000 })
  })

  test('休憩の短縮（30分）も承認されればその分数になる', async ({ page }) => {
    await seedRequest('approved', { requested_break_minutes: 30 })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('approved-break')).toContainText('30分', { timeout: 20000 })
  })

  // ★2026-09-13 辻さん「休憩時間の申請をしたい」で発覚: 承認された休憩は「承認済み」と
  //  表示されるだけで、労働時間の計算（プレビュー＝保存値と同じ計算）には効いていなかった。
  //  08:30〜18:00（現場の既定休憩60分）: 既定なら 8h＋残業0.5h。休憩なしが承認されれば 8h＋残業1.5h。
  test('★承認された「休憩なし」は労働時間の計算に反映される（表示だけで終わらない）', async ({ page }) => {
    await seedRequest('approved', { requested_break_minutes: 0 })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('approved-break')).toContainText('なし', { timeout: 20000 })
    const row = page.locator('.preview-table tbody tr').first()
    await expect(row, '★休憩0分で計算される＝残業が1.5hになる').toContainText('残業1.5h', { timeout: 20000 })
    await expect(row.locator('.preview-break'), '休憩欄は「—」（0分）').toHaveText('—')
  })

  test('承認された休憩の短縮（30分）はその分数で計算される', async ({ page }) => {
    await seedRequest('approved', { requested_break_minutes: 30 })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('approved-break')).toContainText('30分', { timeout: 20000 })
    const row = page.locator('.preview-table tbody tr').first()
    await expect(row, '30分休憩＝8h＋残業1h').toContainText('残業1h', { timeout: 20000 })
    await expect(row.locator('.preview-break')).toHaveText('30分')
  })

  test('何も申請していない日は今までどおり（固定開始が下限・現場の既定休憩）', async ({ page }) => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    const opts = await startOptions(page)
    expect(opts, '早出は入力できない').not.toContain('06:00')
    await expect(page.getByTestId('approved-break'), '休憩の承認表示は出ない').toHaveCount(0)
    await expect(page.getByTestId('approved-early-start'), '早朝の承認表示も出ない').toHaveCount(0)
  })

  test('申請画面から早朝入りと休憩を出せる（0分＝休憩なしが潰れない）', async ({ page }) => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${new Date().toISOString().slice(0, 10)}`,
      { method: 'DELETE' }).catch(() => {})
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    const start = page.getByTestId('ot-start-time')
    if (await start.count() === 0) {
      test.skip(true, '当日の締切(16:00)を過ぎているため申請フォームが出ない')
      return
    }
    await start.selectOption('06:00')
    await page.getByTestId('ot-break').selectOption('0')
    await page.getByRole('button', { name: /申請/ }).last().click()

    await expect.poll(async () => {
      const rows = await restSrv(
        `overtime_requests?worker_id=eq.${workerId}&select=requested_start_time,requested_break_minutes&order=requested_at.desc&limit=1`)
      return rows?.[0] ?? null
    }, { timeout: 20000 }).not.toBeNull()

    const row = (await restSrv(
      `overtime_requests?worker_id=eq.${workerId}&select=requested_start_time,requested_break_minutes&order=requested_at.desc&limit=1`))[0]
    expect((row.requested_start_time || '').slice(0, 5), '早朝入りが記録される').toBe('06:00')
    expect(row.requested_break_minutes, '★0（休憩なし）が null に潰れない').toBe(0)
  })

  // ★2026-09-13 辻さん「1日に2つの現場がある場合、残業申請が1つの現場しかできません」
  //  申請は1日1件（現場は複数選べる）だが、先に出すとフォームが消えて2現場目を足せなかった。
  //  締切前なら申請済み（承認済みでも）の内容を変更・追加でき、更新すると再承認（pending）に戻る。
  test('★申請済みでも締切前なら現場を追加・休憩を申告できる（更新で再承認に戻る）', async ({ page }) => {
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${today}`, { method: 'DELETE' }).catch(() => {})
    // 先に1現場（SITE）で承認済みになっている状態を作る
    await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: today, status: 'approved',
        requested_end_time: '18:30', site_names: [SITE], reason: 'E2E 1現場目',
      }),
    })
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    const editBtn = page.getByTestId('ot-edit')
    if (await editBtn.count() === 0) {
      test.skip(true, '当日の締切(16:00)を過ぎているため変更ボタンが出ない')
      return
    }
    await editBtn.click()
    await expect(page.getByTestId('ot-edit-note')).toBeVisible()
    // 1現場目のチェックは復元されている
    await expect(page.locator('label.ot-site', { hasText: SITE }).locator('input')).toBeChecked()
    // 2現場目を追加し、終了時刻と休憩を申告する
    await page.locator('label.ot-site', { hasText: SITE2 }).locator('input').check()
    await page.locator('select.ot-input').first().selectOption('20:00')
    await page.getByTestId('ot-break').selectOption('0')
    await page.getByTestId('ot-edit-submit').click()

    await expect.poll(async () => {
      const rows = await restSrv(
        `overtime_requests?worker_id=eq.${workerId}&date=eq.${today}&select=status,requested_end_time,requested_break_minutes,site_names,is_late,approved_by`)
      return rows?.[0]?.status ?? null
    }, { timeout: 20000 }).toBe('pending')
    const rows = await restSrv(
      `overtime_requests?worker_id=eq.${workerId}&date=eq.${today}&select=status,requested_end_time,requested_break_minutes,site_names,is_late,approved_by`)
    expect(rows.length, '★1日1件のまま（2件目を作らない）').toBe(1)
    const r = rows[0]
    expect(r.site_names, '★2現場目が足されている').toEqual(expect.arrayContaining([SITE, SITE2]))
    expect((r.requested_end_time || '').slice(0, 5)).toBe('20:00')
    expect(r.requested_break_minutes, '休憩なしの申告が乗る').toBe(0)
    expect(r.is_late, '締切前の変更は実績修正ではない').toBe(false)
    expect(r.approved_by, '承認は取り消され再承認待ちになる').toBeNull()
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${today}`, { method: 'DELETE' }).catch(() => {})
  })
})
