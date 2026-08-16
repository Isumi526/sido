// ============================================================
//  admin.work-categories.spec.ts
//  作業区分マスタ（会社ごと）の管理と権限。
//
//  ★背景（2026-08-15〜16）:
//   1つの現場に対して作業の種類が複数ある（現場作業のほかに見積・事務）。
//   区分の置き場所が無いため現場マスタに区分を作ってしのいでおり、
//   sido の有効な現場80件のうち8件が実質「作業区分」だった。
//
//  ★このspecが守るもの:
//   - 使われている区分を消せない（消すと日報・予定の参照が切れる）
//   - 他テナントの区分を触れない
//   - 0件更新を ok:true で返さない（「成功したのに変わらない」を作らない）
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } from './helpers'

const TS = Date.now()
const NEW_CAT = `E2E区分_${TS}`
const OTHER_SLUG = `e2e-cat-other-${TS}`

let accountId = ''
let otherAccountId = ''
let otherCatId = ''
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

async function listCategories() {
  const r = await callEf({ action: 'categories' })
  return (r.body?.categories ?? []) as Array<{ id: string; name: string; scope: string | null }>
}

test.describe('作業区分マスタ', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    token = await signIn(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)
    expect(token, 'admin ログインできる').toBeTruthy()

    // 別テナントを1つ作る（越境の的）
    const acc = await restSrv('accounts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ slug: OTHER_SLUG, name: `E2E他社_${TS}` }),
    })
    otherAccountId = acc[0].id
    otherCatId = (await restSrv('work_categories', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: otherAccountId, name: `他社の区分_${TS}`, scope: 'site' }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`work_categories?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`accounts?id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`work_categories?name=like.E2E区分*`, { method: 'DELETE' }).catch(() => {})
  })

  test('標準の3区分が最初から入っている', async () => {
    const names = (await listCategories()).map(c => c.name)
    for (const n of ['現場作業', '見積', 'その他事務']) {
      expect(names, `${n} が標準で入っている`).toContain(n)
    }
  })

  test('区分を追加できる／同名は弾かれる', async () => {
    const add = await callEf({ action: 'category-save', name: NEW_CAT, scope: 'site' })
    expect(add.body?.ok, `追加できるべき: ${JSON.stringify(add.body)}`).toBe(true)
    expect((await listCategories()).map(c => c.name)).toContain(NEW_CAT)

    const dup = await callEf({ action: 'category-save', name: NEW_CAT, scope: 'site' })
    expect(dup.body?.error, '同名は弾く').toBe('DUPLICATE_NAME')
  })

  test('★使われている区分は消せない（参照が切れる事故を防ぐ）', async () => {
    const cat = (await listCategories()).find(c => c.name === '現場作業')!
    const worker = await restSrv(`workers?account_id=eq.${accountId}&select=id&limit=1`)
    const sched = await restSrv('schedules', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: worker[0].id, title: `E2E区分使用_${TS}`,
        start_date: '2026-02-01', end_date: '2026-02-01', all_day: true, category_id: cat.id,
      }),
    })
    try {
      const r = await callEf({ action: 'category-delete', id: cat.id })
      expect(r.body?.error, `★使用中は消せないべき: ${JSON.stringify(r.body)}`).toBe('IN_USE')
      expect(r.body?.schedules, '何件使われているかを返す').toBeGreaterThan(0)
      const still = (await listCategories()).map(c => c.name)
      expect(still, '区分は残っている').toContain('現場作業')
    } finally {
      await restSrv(`schedules?id=eq.${sched[0].id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('未使用の区分は消せる（塞ぎすぎていない）', async () => {
    const target = (await listCategories()).find(c => c.name === NEW_CAT)
    test.skip(!target, '前のテストで作られていない場合はskip')
    const r = await callEf({ action: 'category-delete', id: target!.id })
    expect(r.body?.ok, `未使用なら消せるべき: ${JSON.stringify(r.body)}`).toBe(true)
    expect((await listCategories()).map(c => c.name)).not.toContain(NEW_CAT)
  })

  test('★他テナントの区分は書き換えも削除もできない', async () => {
    const before = await restSrv(`work_categories?id=eq.${otherCatId}&select=name`)
    const upd = await callEf({ action: 'category-save', id: otherCatId, name: '乗っ取り', scope: 'site' })
    // ★0件更新を ok:true で返さない。「成功したのに変わらない」を作らないため
    expect(upd.body?.error, `★越境の更新は not_found: ${JSON.stringify(upd.body)}`).toBe('not_found')

    const del = await callEf({ action: 'category-delete', id: otherCatId })
    expect(del.body?.error, '★越境の削除も not_found').toBe('not_found')

    const after = await restSrv(`work_categories?id=eq.${otherCatId}&select=name`)
    expect(after.length, '他社の区分は消えていない').toBe(1)
    expect(after[0].name, '他社の区分名も変わっていない').toBe(before[0].name)
  })

  test('★公開キーでは区分テーブルを直接読めない', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/work_categories?select=*`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    })
    expect(res.status, '公開キーは拒否される').toBeGreaterThanOrEqual(400)
  })

  test('画面から区分を追加・削除できる', async ({ page }) => {
    const UI_CAT = `E2E画面区分_${TS}`
    await page.goto('/work-categories', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('作業区分')

    // 標準区分が並んでいる
    await expect(page.locator('table.table')).toContainText('現場作業')

    await page.locator('.btn-add').click()
    await page.locator('[data-testid="cat-name"]').fill(UI_CAT)
    await page.locator('[data-testid="cat-scope"]').selectOption('site')
    await page.locator('[data-testid="cat-save"]').click()
    await expect(page.locator('table.table'), '追加した区分が一覧に出る').toContainText(UI_CAT)

    // 片付け（未使用なので消せる）
    page.once('dialog', d => d.accept())
    const row = page.locator('tr', { hasText: UI_CAT })
    await row.locator('.btn-del').click()
    await expect(page.locator('table.table'), '削除すると一覧から消える').not.toContainText(UI_CAT)
  })

  test('★新しく作った会社にも標準3区分が自動で入る', async () => {
    // 20260816020000 は「実行時点の既存アカウント」に入れただけで、
    // その後に作られた会社は区分ゼロになる漏れがあった（2026-08-16）。
    // DBトリガーで塞いだので、実際にアカウントを作って確かめる。
    const slug = `e2e-seed-${TS}`
    const acc = await restSrv('accounts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ slug, name: `E2E新規会社_${TS}` }),
    })
    const newAccountId = acc[0].id
    try {
      const rows = await restSrv(`work_categories?account_id=eq.${newAccountId}&select=name&order=sort_order`)
      const names = rows.map((r: any) => r.name)
      expect(names, '標準3区分が自動で入る').toEqual(['現場作業', '見積', 'その他事務'])
    } finally {
      await restSrv(`work_categories?account_id=eq.${newAccountId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`accounts?id=eq.${newAccountId}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})
