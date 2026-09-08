// ============================================================
//  admin.site-category-hours.spec.ts
//  現場×区分ごとの定時・休憩の編集（site_category_hours）。
//
//  ★背景（2026-08-16〜22）:
//   定時は「現場だけ」でも「区分だけ」でも決まらない
//   （事務は拠点で 08:30/08:00 と定時が違う）。そのため (現場, 区分) の組に
//   定時・休憩を持たせる site_category_hours テーブルと、日報側の参照ロジック
//   （report.vue の siteFixedTimes 系）は既に入っていたが、
//   これを編集する画面・EFアクションが無く、一度きりの移行スクリプトでしか
//   書き込めなかった（AC「定時・休憩を現場×区分で設定できる」が未達）。
//   ここではその編集導線（master-data EF の category-hours-save/delete と
//   site-detail.vue の「区分ごとの定時・休憩」カード）を検証する。
//
//  ★このspecが守るもの:
//   - 他テナントの現場・区分には書けない（site_id/category_id を偽っても弾かれる）
//   - 権限（CATEGORY_MANAGE_ROLES）が無いと弾かれる
//   - 保存すると /fetch の siteCategoryHours に反映される（LIFF側が読む経路と同じ）
//   - クリアすると行が消え「定時なし」に戻る
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } from './helpers'

const TS = Date.now()
const OTHER_SLUG = `e2e-cathrs-other-${TS}`

let accountId = ''
let otherAccountId = ''
let otherSiteId = ''
let otherCatId = ''
let siteId = ''
let categoryId = ''
let token = ''

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await res.json()).access_token ?? ''
}

async function callEf(payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/master-data`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function fetchAll() {
  const r = await callEf({ action: 'fetch' })
  return r.body as { siteCategoryHours?: Array<{ site_id: string; category_id: string; default_start_time: string | null; default_end_time: string | null; default_breaks: unknown }> }
}

test.describe('現場×区分ごとの定時・休憩', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    token = await signIn(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)
    expect(token, 'admin ログインできる').toBeTruthy()

    const site = await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E区分定時現場_${TS}`, active: true }),
    })
    siteId = site[0].id
    const cat = await restSrv('work_categories', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E区分定時区分_${TS}`, scope: 'site' }),
    })
    categoryId = cat[0].id

    // 越境の的（別テナントの現場・区分）
    const acc = await restSrv('accounts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ slug: OTHER_SLUG, name: `E2E他社_${TS}` }),
    })
    otherAccountId = acc[0].id
    const otherSite = await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: otherAccountId, name: `他社の現場_${TS}`, active: true }),
    })
    otherSiteId = otherSite[0].id
    const otherCat = await restSrv('work_categories', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: otherAccountId, name: `他社の区分_${TS}`, scope: 'site' }),
    })
    otherCatId = otherCat[0].id
  })

  test.afterAll(async () => {
    await restSrv(`site_category_hours?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`work_categories?id=eq.${categoryId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`site_category_hours?site_id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`work_categories?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`accounts?id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('保存すると fetch の siteCategoryHours に反映される（LIFFが読む経路と同じ）', async () => {
    const save = await callEf({
      action: 'category-hours-save', site_id: siteId, category_id: categoryId,
      default_start_time: '09:00', default_end_time: '18:00',
      default_breaks: [{ start: '12:00', minutes: 60 }],
    })
    expect(save.body?.ok, `保存できるべき: ${JSON.stringify(save.body)}`).toBe(true)

    const all = await fetchAll()
    const row = (all.siteCategoryHours ?? []).find(h => h.site_id === siteId && h.category_id === categoryId)
    expect(row, 'fetch アクションに現れる').toBeTruthy()
    expect(row!.default_start_time?.slice(0, 5)).toBe('09:00')
    expect(row!.default_end_time?.slice(0, 5)).toBe('18:00')
    expect(row!.default_breaks).toEqual([{ start: '12:00', minutes: 60 }])
  })

  test('同じ組に再保存すると上書きされる（重複行を作らない）', async () => {
    const save = await callEf({
      action: 'category-hours-save', site_id: siteId, category_id: categoryId,
      default_start_time: '08:30', default_end_time: '17:30', default_breaks: null,
    })
    expect(save.body?.ok, `上書き保存できるべき: ${JSON.stringify(save.body)}`).toBe(true)

    const rows = await restSrv(`site_category_hours?site_id=eq.${siteId}&category_id=eq.${categoryId}&select=id`)
    expect(rows.length, '行は1件のまま（upsert）').toBe(1)
    const all = await fetchAll()
    const row = (all.siteCategoryHours ?? []).find(h => h.site_id === siteId && h.category_id === categoryId)
    expect(row!.default_start_time?.slice(0, 5)).toBe('08:30')
  })

  test('クリアすると行が消えて「定時なし」に戻る', async () => {
    const del = await callEf({ action: 'category-hours-delete', site_id: siteId, category_id: categoryId })
    expect(del.body?.ok, `クリアできるべき: ${JSON.stringify(del.body)}`).toBe(true)
    const all = await fetchAll()
    expect((all.siteCategoryHours ?? []).find(h => h.site_id === siteId && h.category_id === categoryId), '行が消えている').toBeFalsy()
  })

  test('クリアの二度押し（既に無い行への delete）はエラーにならない', async () => {
    const del = await callEf({ action: 'category-hours-delete', site_id: siteId, category_id: categoryId })
    expect(del.body?.ok, '冪等に成功扱い').toBe(true)
  })

  test('★他テナントの現場・区分には書けない', async () => {
    // 自テナントの site_id + 他テナントの category_id
    const r1 = await callEf({ action: 'category-hours-save', site_id: siteId, category_id: otherCatId, default_start_time: '09:00', default_end_time: '18:00' })
    expect(r1.body?.error, '他テナントの区分IDは not_found').toBe('not_found')
    // 他テナントの site_id + 自テナントの category_id
    const r2 = await callEf({ action: 'category-hours-save', site_id: otherSiteId, category_id: categoryId, default_start_time: '09:00', default_end_time: '18:00' })
    expect(r2.body?.error, '他テナントの現場IDも not_found').toBe('not_found')

    const rows = await restSrv(`site_category_hours?site_id=eq.${otherSiteId}&select=id`)
    expect(rows.length, '他社の現場には何も書き込まれていない').toBe(0)
  })

  test('site_id / category_id が無いと弾く', async () => {
    const r = await callEf({ action: 'category-hours-save', site_id: siteId })
    expect(r.body?.error).toBe('ids_required')
  })

  test('★公開キーでは現場×区分の定時テーブルを直接読めない', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/site_category_hours?select=*`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    })
    expect(res.status, '公開キーは拒否される').toBeGreaterThanOrEqual(400)
  })

  test('画面から現場×区分の定時を編集できる', async ({ page }) => {
    await page.goto(`/sites/${siteId}`, { waitUntil: 'networkidle' })
    await expect(page.locator('h1.page-title')).toContainText(`E2E区分定時現場_${TS}`)

    const row = page.locator(`[data-testid="cat-hours-row-${categoryId}"]`)
    await expect(row, '対象区分の行が出ている').toBeVisible()
    await expect(row, '未設定は「現場の固定勤務時刻を使用」と出る').toContainText('固定勤務時刻を使用')

    await row.locator(`[data-testid="cat-hours-edit-${categoryId}"]`).click()
    await page.locator('[data-testid="cat-hours-start"]').fill('10:00')
    await page.locator('[data-testid="cat-hours-end"]').fill('19:00')
    await page.locator('[data-testid="cat-hours-add-break"]').click()
    await page.locator('[data-testid="cat-hours-break-start"]').fill('12:00')
    await page.locator('[data-testid="cat-hours-break-minutes"]').fill('45')
    await page.locator('[data-testid="cat-hours-save"]').click()

    await expect(row, '保存した定時が一覧に反映される').toContainText('10:00〜19:00')
    await expect(row, '保存した休憩も反映される').toContainText('12:00/45分')

    // クリアで「定時なし」に戻る
    await row.locator(`[data-testid="cat-hours-edit-${categoryId}"]`).click()
    await page.locator('[data-testid="cat-hours-clear"]').click()
    await expect(row, 'クリアすると「現場の固定勤務時刻を使用」に戻る').toContainText('固定勤務時刻を使用')
  })
})
