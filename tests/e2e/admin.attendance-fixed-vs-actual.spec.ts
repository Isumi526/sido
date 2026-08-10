// ============================================================
//  admin.attendance-fixed-vs-actual.spec.ts
//  出退勤ログ: 打刻の実時刻と、管理者が設定した勤務時刻を並べて見る（2026-08-10）
//
//  運用者の逐語（電話）:「実際打った打刻時間と、管理者が打った8時半・6時っていうのと、
//   本人たちが実際（打った時間）／それが出てくればそれでいいじゃないの」
//
//  ★このテストが守る一番大事なこと:
//   人件費の根拠は「管理者が設定した時間」のままで、打刻の実時刻は照合用にすぎない。
//   同じ電話で「人件費の計算は管理者が決めた時間ベースで、今までと変わらず／作業員は時間を触れない」
//   と明言されている。ここを取り違えて実打刻を計算に流すと、給与が静かに変わる。
//   なので「実打刻が設定と大きくズレていても、日報側の稼働時間は動かない」を固定する。
//
//  もう1つ: 出勤打刻が「無い」ことは行が存在しないので一覧を眺めても気づけない。
//   在籍者との差分を出すパネルが要る（AC6）。
//
//  接頭辞 att-fx- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'att-fx-'
const SITE = `${PREFIX}現場${TS}`
const W_LATE = `${PREFIX}遅れて打刻${TS}`
const W_NONE = `${PREFIX}未打刻${TS}`
const W_OFF  = `${PREFIX}休み${TS}`
const DATE = '2026-09-24'

let accountId = ''
let siteId = ''
const wid: Record<string, string> = {}

async function purge() {
  for (const n of [W_LATE, W_NONE, W_OFF]) {
    for (const u of (await restSrv(`users?real_name=eq.${encodeURIComponent(n)}&select=id`)) ?? []) {
      await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }
  if (siteId) await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: workers ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

test.describe('出退勤ログ: 実打刻と管理者設定の突き合わせ', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()

    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: SITE, active: true,
        default_start_time: '08:30', default_end_time: '18:00',
      }),
    }))[0].id

    for (const n of [W_LATE, W_NONE, W_OFF]) {
      const w = await restSrv('workers', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ account_id: accountId, name: n, role: 'site', active: true }),
      })
      wid[n] = w[0].id
      await restSrv('users', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ account_id: accountId, real_name: n, worker_id: w[0].id }),
      })
    }

    // 設定 08:30 に対して 06:02 に出勤（＝2時間28分早い。早朝搬入の実例そのもの）
    await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        site_id: siteId, worker_id: wid[W_LATE], type: 'checkin',
        checked_at: `${DATE}T06:02:00+09:00`, agreed_rule_texts: [],
      }),
    })

    // 休みの人は日報で「稼働なし」を出している＝打刻忘れではない
    const ou = await restSrv(`users?real_name=eq.${encodeURIComponent(W_OFF)}&select=id`)
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: ou[0].id, date: DATE, is_working: false, sites: [],
      }),
    })
  })

  test.afterAll(async () => { await purge() })

  async function openFiltered(page: Page) {
    await page.goto('/attendance', { waitUntil: 'networkidle' })
    await page.locator('.filter-select').nth(1).selectOption({ label: W_LATE })
    await page.getByRole('button', { name: '検索' }).click()
    await expect(page.locator('tbody tr')).toHaveCount(1, { timeout: 15000 })
  }

  test('★打刻の実時刻と管理者設定の勤務時刻が並んで見える', async ({ page }) => {
    await openFiltered(page)
    const row = page.locator('tbody tr').first()
    await expect(row, '打刻の実時刻').toContainText('06:02')
    await expect(row, '管理者が設定した勤務時刻').toContainText('08:30〜18:00')
  })

  test('★ズレが分かる（設定8:30に対し6:02＝2時間28分早い）', async ({ page }) => {
    await openFiltered(page)
    const diff = page.getByTestId('attendance-diff').first()
    await expect(diff).toBeVisible()
    // 早い側なので負符号。2時間28分。
    await expect(diff).toHaveText('−2時間28分')
    await expect(diff, '30分以上のズレは目立たせる').toHaveClass(/big/)
  })

  test('固定勤務時刻が未設定の現場では設定欄を空にする（0:00等の嘘を出さない）', async ({ page }) => {
    const s2 = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `${PREFIX}時刻なし${TS}`, active: true }),
    }))[0].id
    await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        site_id: s2, worker_id: wid[W_NONE], type: 'checkin',
        checked_at: `${DATE}T09:00:00+09:00`, agreed_rule_texts: [],
      }),
    })
    try {
      await page.goto('/attendance', { waitUntil: 'networkidle' })
      await page.locator('.filter-select').nth(1).selectOption({ label: W_NONE })
      await page.getByRole('button', { name: '検索' }).click()
      const row = page.locator('tbody tr').first()
      await expect(row).toBeVisible({ timeout: 15000 })
      await expect(row.locator('.fixed-time'), '設定が無いので空欄').toHaveText('—')
      await expect(row.getByTestId('attendance-diff'), '差も出さない').toHaveCount(0)
    } finally {
      await restSrv(`attendance_logs?site_id=eq.${s2}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`sites?id=eq.${s2}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('★出勤打刻が無い作業員が分かる。休みを出している人は含めない', async ({ page }) => {
    await page.goto('/attendance', { waitUntil: 'networkidle' })
    await page.getByTestId('missing-date').fill(DATE)

    const panel = page.getByTestId('missing-checkin-panel')
    // 打刻した人は出ない／未打刻の人は出る／休みを出した人は出ない
    await expect(panel).toContainText(W_NONE, { timeout: 15000 })
    await expect(panel, '打刻済みの人は出さない').not.toContainText(W_LATE)
    await expect(panel, '★休み(稼働なし)を出している人は打刻忘れではない').not.toContainText(W_OFF)
  })

  test('★日付で検索した時に早朝の打刻が落ちない（既存のタイムゾーンずれ）', async ({ page }) => {
    // 06:02 JST の打刻は UTC では前日21:02。日付をそのまま渡すと UTC 解釈になり
    // 「その日」の範囲から外れて消える＝早朝搬入の打刻が検索に出てこない。
    // これは今回の要望以前から在った不具合で、同じ日付境界の計算を共有しているので一緒に固定する。
    await page.goto('/attendance', { waitUntil: 'networkidle' })
    await page.locator('.filter-select').nth(1).selectOption({ label: W_LATE })
    await page.locator('.filter-input').first().fill(DATE)
    await page.locator('.filter-input').nth(1).fill(DATE)
    await page.getByRole('button', { name: '検索' }).click()

    await expect(page.locator('tbody tr'), '★その日で絞っても早朝6:02の打刻が出る').toHaveCount(1, { timeout: 15000 })
    await expect(page.locator('tbody tr').first()).toContainText('06:02')
  })

  test('★実打刻がどれだけズレていても、日報の稼働時間は動かない（人件費の根拠は管理者設定のまま）', async ({ page }) => {
    // 06:02 打刻の現場で日報を1件作る。稼働時間は日報側の値だけで決まる。
    const lu = await restSrv(`users?real_name=eq.${encodeURIComponent(W_LATE)}&select=id`)
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: lu[0].id, date: DATE, is_working: true,
        sites: [{
          siteName: SITE, subcontractors: [], expenses: {},
          workers: [{ workerName: W_LATE, workerId: wid[W_LATE], startTime: '08:30', endTime: '18:00', breakMinutes: 60 }],
        }],
      }),
    })
    await page.goto(`/site-reports?ym=${DATE.slice(0, 7)}`, { waitUntil: 'networkidle' })
    await page.getByTestId('site-filter-text').fill(SITE)
    await page.locator('.tabs .tab', { hasText: SITE }).first().click()
    // 日報に入っている 08:30〜18:00 がそのまま出る（06:02 は入り込まない）
    const table = page.locator('.table-wrap')
    await expect(table).toBeVisible({ timeout: 15000 })
    await expect(table, '★打刻の実時刻が稼働に混ざっていない').not.toContainText('06:02')
  })
})
