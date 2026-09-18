// ============================================================
//  admin.site-night-hours-ui.spec.ts
//  現場マスタの編集モーダル（2026-09-18 /review ⑥ 指摘・PR #187 に追加）:
//   - 夜のみ現場（20:30〜翌6:00）は「現場作業＝固定勤務時刻」に入れるので、
//     固定勤務時刻の欄にも「翌日まで」のタグが出る（区分別の欄にしか無かった）
//   - 時刻の刻みは 15 分（固定勤務時刻・区分ごとの定時とも）
//   - 区分をこの画面から追加できる（作業区分マスタへ行かずに済む）
//  接頭辞 night-ui- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'night-ui-'
const SITE = `${PREFIX}現場${TS}`
const NEW_CAT = `${PREFIX}区分${TS}`

let accountId = ''

async function purge() {
  await restSrv(`work_categories?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
}

async function openModal(page: Page) {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: SITE }).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.getByRole('button', { name: '編集' }).click()
  await expect(page.getByTestId('add-break')).toBeVisible({ timeout: 10000 })
}

test.describe('現場マスタ: 夜のみ現場の定時UI', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    // 保存には責任者が必須（住所・工期は既存現場なら警告のみ）
    const w = (await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&limit=1`))[0]
    await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true, default_start_time: '08:30', default_end_time: '17:30', responsible_worker_id: w.id, location: 'E2E住所' }),
    })
  })
  test.afterAll(async () => { await purge() })

  test('★固定勤務時刻に 20:30〜06:00 を入れると「翌日まで」が出て、保存→再読込で残る', async ({ page }) => {
    await openModal(page)
    const times = page.locator('.modal input[type="time"]')
    await expect(page.getByTestId('site-overnight')).toHaveCount(0)
    await times.nth(0).fill('20:30')
    await times.nth(1).fill('06:00')
    await expect(page.getByTestId('site-overnight'), '終了＜開始で日跨ぎと明示する').toBeVisible()
    await page.locator('.modal .btn-save').click()
    await expect(page.locator('.modal')).toHaveCount(0, { timeout: 10000 })

    const saved = (await restSrv(`sites?name=eq.${encodeURIComponent(SITE)}&select=default_start_time,default_end_time`))[0]
    expect(String(saved.default_start_time).slice(0, 5)).toBe('20:30')
    expect(String(saved.default_end_time).slice(0, 5)).toBe('06:00')

    await openModal(page)
    await expect(page.getByTestId('site-overnight'), '再読込後もタグが出る').toBeVisible()
  })

  test('時刻の刻みは15分（固定勤務時刻・区分ごとの定時）', async ({ page }) => {
    await openModal(page)
    const steps = await page.locator('.modal input[type="time"]').evaluateAll(els => els.map(e => (e as HTMLInputElement).step))
    expect(steps.length).toBeGreaterThan(0)
    for (const s of steps) expect(s, '5分刻み(300)が残っていない').toBe('900')
  })

  test('★この画面から区分を追加でき、すぐ定時を入れる行が出る', async ({ page }) => {
    await openModal(page)
    await page.getByTestId('cat-add-name').fill(NEW_CAT)
    await page.getByTestId('cat-add-btn').click()
    await expect.poll(async () =>
      (await restSrv(`work_categories?name=eq.${encodeURIComponent(NEW_CAT)}&select=id`))?.length ?? 0,
      { timeout: 10000 }).toBe(1)
    const created = (await restSrv(`work_categories?name=eq.${encodeURIComponent(NEW_CAT)}&select=id,scope,active`))[0]
    expect(created.active).toBe(true)
    expect(created.scope, '現場で使える区分として作られる').toBe('site')
    await expect(page.getByTestId(`cat-hours-${created.id}`), '追加した区分の定時欄がその場に出る').toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('cat-add-name')).toHaveValue('')
  })
})
