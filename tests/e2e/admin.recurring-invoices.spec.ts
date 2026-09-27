// ============================================================
//  admin.recurring-invoices.spec.ts
//  協力会社請求の「毎月定額」: ひな形を登録すると、毎月の登録日に今月分の請求が自動で1件できる（2026-09-27）。
//
//  出所（尾崎さん・SEED 2026-09-25/27）:
//   「毎月定額で請求となっているものを固定で登録することは可能でしょうか？」
//   「基本的にはボタンを押さずに毎月自動で登録される仕様希望。金額や内容に変更がある場合のみ、
//     登録後にその場で修正できると嬉しい」
//
//  ★このテストで守ること（金額の入った請求を自動で作るので）:
//   1. 同じ月に二重に作らない
//   2. 請求が来なかった月に削除した請求を、翌日に作り直さない（ひな形の last_generated_period で持つ）
//   3. 停止・終了したひな形からは作らない
//   4. 手動実行（承認者JWT）は自社のひな形だけ
//   5. 自動登録の請求は一覧で見分けられ、その場で直せ、直した内容を来月以降に反映できる
//   6. 登録日の規則（29〜31日は月末に寄せる・今月分だけ作る）が admin と EF で同じ
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } from './helpers'

const TS = Date.now()
const VENDOR = `E2E定額業者_${TS}`
const TITLE = `E2E毎月定額_${TS}`
const SITE = `E2E定額現場_${TS}`
let accountId = ''
let otherAccountId = ''
let siteId = ''
let subId = ''
let token = ''

test.describe.configure({ mode: 'serial' })

/** JST の今日 'YYYY-MM-DD' と 'YYYY-MM' */
const jstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const thisPeriod = () => jstToday().slice(0, 7)
const prevPeriod = () => {
  const [y, m] = thisPeriod().split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return d.toISOString().slice(0, 7)
}

async function run(body: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/recurring-invoices`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
/** 今日が登録日になるひな形を直接作る（EF の判定を今日で試すため） */
async function seedTemplate(extra: Record<string, unknown> = {}, acc = accountId): Promise<string> {
  const r = await restSrv('subcontractor_invoice_templates', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: acc, vendor_kind: 'subcontractor', subcontractor_id: acc === accountId ? subId : null,
      vendor_name: VENDOR, title: TITLE, total_amount: 110000, tax_mode: 'exclusive',
      items: [{ site_id: acc === accountId ? siteId : null, site_name: SITE, description: '月額リース', quantity: 1, unit: '式', unit_price: 100000, amount: 100000, tax_rate: 10, note: null }],
      day_of_month: Number(jstToday().slice(8, 10)), due_offset_days: 30,
      start_period: thisPeriod(), end_period: null, last_generated_period: prevPeriod(), active: true,
      ...extra,
    }),
  })
  return r[0].id
}
async function invoicesOf(templateId: string) {
  return restSrv(`subcontractor_invoices?recurring_template_id=eq.${templateId}&select=id,recurring_period,invoice_date,due_date,paid,source,total_amount,subcontractor_invoice_items(item_date,amount,site_id,description)`)
}
async function cleanup() {
  const inv = await restSrv(`subcontractor_invoices?title=eq.${encodeURIComponent(TITLE)}&select=id`)
  for (const r of (inv ?? [])) {
    await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`subcontractor_invoice_templates?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  otherAccountId = (await restSrv('accounts?slug=eq.sample-construction&select=id'))[0].id
  subId = (await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) }))[0].id
  siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, status: 'in_progress' }) }))[0].id
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  token = (await auth.json()).access_token
  await cleanup()
})
test.afterAll(async () => {
  await cleanup()
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('★登録日の規則（admin と EF で同じ関数）: 29〜31日は月末に寄せ、今月分だけ・作成済みの月は作らない', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  const r = await page.evaluate(async () => {
    const m: any = await import('/src/lib/recurring-invoice.gen.ts')
    const base = { active: true, day_of_month: 31, start_period: '2026-01', end_period: null, last_generated_period: null }
    return {
      feb: m.invoiceDateFor('2026-02', 31), leap: m.invoiceDateFor('2028-02', 31), apr: m.invoiceDateFor('2026-04', 31),
      beforeDay: m.dueToday({ ...base, day_of_month: 25 }, '2026-10-24'),
      due: m.dueToday({ ...base, day_of_month: 25 }, '2026-10-25'),
      monthEnd: m.dueToday(base, '2026-04-30'),
      already: m.dueToday({ ...base, day_of_month: 25, last_generated_period: '2026-10' }, '2026-10-26'),
      inactive: m.dueToday({ ...base, active: false }, '2026-10-31'),
      beforeStart: m.dueToday({ ...base, start_period: '2026-11' }, '2026-10-31'),
      ended: m.dueToday({ ...base, end_period: '2026-09' }, '2026-10-31'),
      next: m.nextInvoiceDate({ ...base, day_of_month: 25, last_generated_period: '2026-10' }, '2026-10-26'),
    }
  })
  expect(r.feb, '2月31日→28日').toBe('2026-02-28')
  expect(r.leap, 'うるう年は29日').toBe('2028-02-29')
  expect(r.apr, '4月31日→30日').toBe('2026-04-30')
  expect(r.beforeDay.due, '登録日前は作らない').toBe(false)
  expect(r.due.due).toBe(true)
  expect(r.due.invoiceDate).toBe('2026-10-25')
  expect(r.monthEnd.due, '31日指定でも月末(30日)に作る').toBe(true)
  expect(r.already.reason, '★作成済みの月は作らない').toBe('already_generated')
  expect(r.inactive.reason).toBe('inactive')
  expect(r.beforeStart.reason).toBe('before_start')
  expect(r.ended.reason).toBe('ended')
  expect(r.next, '作成済みなら次回は翌月').toBe('2026-11-25')
})

test('★登録日を過ぎると今月分が1件でき、内容・支払期限・明細の日付が今月になる', async () => {
  const tid = await seedTemplate()
  const r = await run()
  expect(r.status).toBe(200)
  const mine = (r.body.results as any[]).find(x => x.template_id === tid)
  expect(mine?.created, JSON.stringify(mine)).toBe(true)

  const inv = await invoicesOf(tid)
  expect(inv.length).toBe(1)
  expect(inv[0].source).toBe('recurring')
  expect(inv[0].recurring_period).toBe(thisPeriod())
  expect(inv[0].invoice_date, '登録日＝今日').toBe(jstToday())
  expect(inv[0].paid, '未払いで作る').toBe(false)
  expect(Number(inv[0].total_amount)).toBe(110000)
  const due = new Date(`${jstToday()}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + 30)
  expect(inv[0].due_date, '支払期限＝登録日＋30日（元の請求の差を引き継ぐ）').toBe(due.toISOString().slice(0, 10))
  expect(inv[0].subcontractor_invoice_items.length).toBe(1)
  expect(inv[0].subcontractor_invoice_items[0].item_date, '明細の日付も今月').toBe(jstToday())
  expect(inv[0].subcontractor_invoice_items[0].site_id, '現場も引き継ぐ').toBe(siteId)

  const t = await restSrv(`subcontractor_invoice_templates?id=eq.${tid}&select=last_generated_period`)
  expect(t[0].last_generated_period).toBe(thisPeriod())
})

test('★同じ月に二重に作らない（もう一度実行しても増えない）', async () => {
  const tpl = await restSrv(`subcontractor_invoice_templates?title=eq.${encodeURIComponent(TITLE)}&select=id`)
  const tid = tpl[0].id
  const r = await run()
  expect((r.body.results as any[]).find(x => x.template_id === tid)?.skipped).toBe('already_generated')
  expect((await invoicesOf(tid)).length).toBe(1)
})

test('★請求が来なかった月に削除しても、次の実行で作り直さない', async () => {
  const tpl = await restSrv(`subcontractor_invoice_templates?title=eq.${encodeURIComponent(TITLE)}&select=id`)
  const tid = tpl[0].id
  const inv = await invoicesOf(tid)
  await restSrv(`subcontractor_invoice_items?invoice_id=eq.${inv[0].id}`, { method: 'DELETE' })
  await restSrv(`subcontractor_invoices?id=eq.${inv[0].id}`, { method: 'DELETE' })
  await run()
  expect((await invoicesOf(tid)).length, '★消した月は復活しない').toBe(0)
  await cleanup()
})

test('★一時停止・終了したひな形からは作らない', async () => {
  const paused = await seedTemplate({ active: false })
  const ended = await seedTemplate({ end_period: prevPeriod(), start_period: prevPeriod(), last_generated_period: null })
  const r = await run()
  const res = r.body.results as any[]
  expect(res.find(x => x.template_id === paused)?.skipped).toBe('inactive')
  expect(res.find(x => x.template_id === ended)?.skipped).toBe('ended')
  expect((await invoicesOf(paused)).length).toBe(0)
  expect((await invoicesOf(ended)).length).toBe(0)
  await cleanup()
})

test('★承認者の手動実行は自社のひな形だけ（他テナントのひな形からは作らない）', async () => {
  const other = await seedTemplate({}, otherAccountId)
  const r = await run()
  expect((r.body.results as any[]).some(x => x.template_id === other), '他社のひな形は対象に入らない').toBe(false)
  expect((await invoicesOf(other)).length).toBe(0)
  await restSrv(`subcontractor_invoice_templates?id=eq.${other}`, { method: 'DELETE' })
})

test('認証なしでは起動できない', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/recurring-invoices`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: '{}',
  })
  expect(res.status).toBe(401)
})

test('★画面: 請求から「毎月の定額として登録」でき、この請求の月は作成済み扱い・既定は翌月から', async ({ page }) => {
  const inv = await restSrv('subcontractor_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, vendor_name: VENDOR, title: TITLE,
      invoice_date: '2026-09-25', due_date: '2026-10-31', total_amount: 110000, tax_mode: 'exclusive' }) })
  await restSrv('subcontractor_invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ invoice_id: inv[0].id, account_id: accountId, description: '月額リース', amount: 100000, tax_rate: 10,
      site_id: siteId, site_name: SITE, item_date: '2026-09-25' }) })

  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.locator('tr.data-row', { hasText: TITLE }).first().click()
  await page.getByTestId('recurring-open').click()
  await expect(page.getByTestId('recurring-day'), '既定は元の請求の日').toHaveValue('25')
  await expect(page.getByTestId('recurring-start'), '★既定は翌月から（この月は登録済み）').toHaveValue('2026-10')
  await page.getByTestId('recurring-save').click()

  await expect.poll(async () => (await restSrv(`subcontractor_invoice_templates?title=eq.${encodeURIComponent(TITLE)}&select=id`)).length,
    { timeout: 10000 }).toBe(1)
  const t = (await restSrv(`subcontractor_invoice_templates?title=eq.${encodeURIComponent(TITLE)}&select=*`))[0]
  expect(t.day_of_month).toBe(25)
  expect(t.start_period).toBe('2026-10')
  expect(t.last_generated_period, '★元の請求の月は作成済み扱い＝二重に作らない').toBe('2026-09')
  expect(t.due_offset_days, '請求日→支払期限の差（36日）を引き継ぐ').toBe(36)
  expect(t.items[0].site_id).toBe(siteId)
  expect(t.items[0].amount).toBe(100000)
  await expect(page.getByTestId('recurring-card'), '一覧の上に「毎月の定額」').toBeVisible()

  // ★同じ請求から2つ目のひな形は作れない（再送・連打で二重計上にならない）
  const dup = await fetch(`${SUPABASE_URL}/rest/v1/subcontractor_invoice_templates`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, vendor_name: VENDOR, title: TITLE, day_of_month: 25,
      start_period: '2026-10', source_invoice_id: inv[0].id }),
  })
  expect(dup.status, '★2つ目は一意制約で弾かれる').toBe(409)
  expect((await restSrv(`subcontractor_invoice_templates?source_invoice_id=eq.${inv[0].id}&select=id`)).length).toBe(1)
  // 開き直すと登録ボタンではなく「登録済み」
  await page.locator('tr.data-row', { hasText: TITLE }).first().click()
  await expect(page.getByTestId('recurring-registered')).toContainText('毎月の定額として登録済み')
  await expect(page.getByTestId('recurring-open')).toHaveCount(0)
  await cleanup()
})

test('★画面: 保存していない変更があると登録させない（画面と違う内容で毎月作られないように）', async ({ page }) => {
  const inv = await restSrv('subcontractor_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, vendor_name: VENDOR, title: TITLE,
      invoice_date: '2026-09-25', total_amount: 110000, tax_mode: 'exclusive' }) })
  await restSrv('subcontractor_invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ invoice_id: inv[0].id, account_id: accountId, description: '月額リース', amount: 100000, tax_rate: 10,
      site_id: siteId, site_name: SITE, item_date: '2026-09-25' }) })
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.locator('tr.data-row', { hasText: TITLE }).first().click()
  // メモ欄を書き換えて、保存せずに登録しようとする
  await page.locator('.modal textarea.note-area').fill(`保存していない変更_${TS}`)
  await page.getByTestId('recurring-open').click()
  await page.getByTestId('recurring-save').click()
  await expect(page.locator('.modal .error')).toContainText('先に「保存」')
  expect((await restSrv(`subcontractor_invoice_templates?title=eq.${encodeURIComponent(TITLE)}&select=id`)).length).toBe(0)
  await cleanup()
})

test('★画面: 自動登録の請求はバッジと案内で見分けられ、直した内容を来月以降のひな形に反映できる', async ({ page }) => {
  const tid = await seedTemplate()
  await run()
  const inv = (await invoicesOf(tid))[0]

  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('recurring-banner'), '今月の自動登録の案内').toContainText('請求が来ていない場合は')
  await expect(page.getByTestId(`recurring-badge-${inv.id}`)).toHaveText('自動登録')

  // その月だけ金額が変わった: 明細を直して保存 → ひな形に反映
  await page.getByTestId(`recurring-badge-${inv.id}`).click()
  await expect(page.getByTestId('recurring-info')).toContainText('自動で登録された請求')
  await restSrv(`subcontractor_invoice_items?invoice_id=eq.${inv.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ amount: 120000, unit_price: 120000 }),
  })
  // 画面を開き直して（保存済みの状態で）反映
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.getByTestId(`recurring-badge-${inv.id}`).click()
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('recurring-apply').click()
  const okBtn = page.locator('.confirm-overlay button', { hasText: '反映する' })
  if (await okBtn.count()) await okBtn.click()
  await expect.poll(async () => {
    const t = await restSrv(`subcontractor_invoice_templates?id=eq.${tid}&select=items`)
    return t[0].items?.[0]?.amount
  }, { message: '★来月以降は新しい金額で作られる', timeout: 10000 }).toBe(120000)
  expect(Number((await invoicesOf(tid))[0].subcontractor_invoice_items[0].amount), '作成済みの請求はそのまま').toBe(120000)
  await cleanup()
})
