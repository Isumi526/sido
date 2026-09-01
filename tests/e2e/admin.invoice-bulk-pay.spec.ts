// ============================================================
//  admin.invoice-bulk-pay.spec.ts
//  協力業者請求: 未払いを選んでまとめて支払い済みにする（2026-09-01）
//
//  ★事務・尾崎さんの依頼（逐語）:
//   「協力業者請求画面で、現状［未払い］になっているものを一括で支払い済みに
//     することは可能でしょうか？」
//   月末にまとめて振り込む運用で、件数分クリックさせられていた。
//
//  ★このテストで守る一番大事なこと:
//   1) 支払日が「選んだ全件」に入ること。1件でも transfer_date が空だと、
//      支払い済みなのに支払日不明の行ができて振込台帳と突き合わせられなくなる。
//   2) ★選んでいない請求を巻き込まないこと。金額に直接触る一括操作なので、
//      対象外が1件でも paid になったら実害（払っていないものを払った扱い）。
//   3) 絞り込みを変えたら選択が消えること。見えていない行が選ばれたままだと、
//      画面の「N件」と実際に更新される対象がズレる。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const TITLE = `E2E一括支払_${TS}`
const SITE_A = `E2E一括支払現場A_${TS}`
const SITE_B = `E2E一括支払現場B_${TS}`
const VENDOR_X = `E2E一括支払業者X_${TS}`
const VENDOR_Y = `E2E一括支払業者Y_${TS}`
const YM = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()

let accountId = ''
let siteAId = ''
let siteBId = ''
const inv: Record<string, string> = {}

async function mkSite(name: string) {
  return (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name, active: true }),
  }))[0].id
}

/** 未払いの請求を1件（明細1行）作る */
async function mkUnpaid(vendor: string, siteId: string, siteName: string, amount: number) {
  const row = (await restSrv('subcontractor_invoices', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, vendor_name: vendor, title: TITLE,
      invoice_date: `${YM}-05`, total_amount: amount, paid: false, transfer_date: null,
    }),
  }))[0]
  await restSrv('subcontractor_invoice_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      invoice_id: row.id, account_id: accountId, item_date: `${YM}-05`,
      site_id: siteId, site_name: siteName, description: 'E2E明細', amount, tax_rate: 10,
    }),
  })
  return row.id
}

async function fetchInvoice(id: string) {
  return (await restSrv(`subcontractor_invoices?id=eq.${id}&select=paid,transfer_date`))[0]
}

/** 全件を未払いに戻す（テスト間で状態を持ち越さない） */
async function resetAllUnpaid() {
  for (const id of Object.values(inv)) {
    await restSrv(`subcontractor_invoices?id=eq.${id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ paid: false, transfer_date: null }),
    }).catch(() => {})
  }
}

test.describe.configure({ mode: 'serial' })

test.describe('協力業者請求の一括支払い', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    siteAId = await mkSite(SITE_A)
    siteBId = await mkSite(SITE_B)
    // 現場A×業者X … 2件（一括の対象にする）
    inv.a1 = await mkUnpaid(VENDOR_X, siteAId, SITE_A, 10000)
    inv.a2 = await mkUnpaid(VENDOR_X, siteAId, SITE_A, 20000)
    // 現場A×業者Y … 1件（★選ばなかったものが巻き込まれないことの確認用）
    inv.a3 = await mkUnpaid(VENDOR_Y, siteAId, SITE_A, 30000)
    // 現場B×業者X … 1件（絞り込みの外に置く）
    inv.b1 = await mkUnpaid(VENDOR_X, siteBId, SITE_B, 40000)
  })

  test.beforeEach(async () => { await resetAllUnpaid() })

  test.afterAll(async () => {
    const rows: any[] = await restSrv(
      `subcontractor_invoices?title=eq.${encodeURIComponent(TITLE)}&select=id`).catch(() => [])
    for (const r of (rows ?? [])) {
      await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`sites?id=in.(${siteAId},${siteBId})`, { method: 'DELETE' }).catch(() => {})
  })

  test('★選んだ全件に同じ支払日が入り、選んでいないものは未払いのまま', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('invoice-filter-bar')).toBeVisible({ timeout: 15000 })

    // 現場A×業者X に絞る（= a1, a2 の2件だけが見えている状態）
    await page.getByTestId('filter-site').selectOption(siteAId)
    await page.getByTestId('filter-vendor').selectOption(VENDOR_X)

    // ヘッダーのチェックで表示中の全件を選ぶ
    await page.getByTestId('bulk-pay-select-all').check()
    await expect(page.getByTestId('bulk-pay-bar'), '選択すると帯が出る').toContainText('2件を選択中')
    // 一覧の金額列と同じ「税込」で出す（10000+20000 の税込＝33,000）。
    // ここが税抜だと、振込金額と見比べた時に合わずに事務が混乱する。
    await expect(page.getByTestId('bulk-pay-bar'), '合計は税込で出る').toContainText('33,000')

    await page.getByTestId('bulk-pay-open').click()
    // ★確定前に「どの業者の何件か」が見えること（誤操作防止）
    await expect(page.getByTestId('bulk-pay-vendors')).toContainText(VENDOR_X)

    const payDate = `${YM}-25`
    await page.getByTestId('bulk-pay-date').fill(payDate)
    await page.getByTestId('bulk-pay-confirm').click()

    // 帯が消える＝処理が終わった
    await expect(page.getByTestId('bulk-pay-bar')).toHaveCount(0, { timeout: 15000 })

    // ★1件でも支払日が欠けたら振込台帳と突き合わせられない
    for (const id of [inv.a1, inv.a2]) {
      const r = await fetchInvoice(id)
      expect(r.paid, '選んだものは支払い済みになる').toBe(true)
      expect(r.transfer_date, '★全件に同じ支払日が入る').toBe(payDate)
    }

    // ★選ばなかったもの（同じ現場の別業者・別現場）は絶対に触らない
    for (const [key, id] of [['a3(別業者)', inv.a3], ['b1(別現場)', inv.b1]] as const) {
      const r = await fetchInvoice(id)
      expect(r.paid, `★${key} は巻き込まれない`).toBe(false)
      expect(r.transfer_date, `★${key} の支払日は空のまま`).toBeNull()
    }
  })

  test('★1件だけ選んで支払える（全選択でなくても効く）', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('invoice-filter-bar')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('filter-site').selectOption(siteAId)
    await page.getByTestId('filter-vendor').selectOption(VENDOR_X)

    await page.getByTestId(`bulk-pay-check-${inv.a1}`).check()
    await expect(page.getByTestId('bulk-pay-bar')).toContainText('1件を選択中')

    await page.getByTestId('bulk-pay-open').click()
    const payDate = `${YM}-26`
    await page.getByTestId('bulk-pay-date').fill(payDate)
    await page.getByTestId('bulk-pay-confirm').click()
    await expect(page.getByTestId('bulk-pay-bar')).toHaveCount(0, { timeout: 15000 })

    expect((await fetchInvoice(inv.a1)).transfer_date).toBe(payDate)
    expect((await fetchInvoice(inv.a2)).paid, '同じ絞り込み内でも選ばなければ触らない').toBe(false)
  })

  test('★絞り込みを変えると選択は解除される（見えていない行を巻き込まない）', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('invoice-filter-bar')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('filter-site').selectOption(siteAId)
    await page.getByTestId('filter-vendor').selectOption(VENDOR_X)

    await page.getByTestId('bulk-pay-select-all').check()
    await expect(page.getByTestId('bulk-pay-bar')).toContainText('2件を選択中')

    // 現場を切り替える → 選択は捨てられる
    await page.getByTestId('filter-site').selectOption(siteBId)
    await expect(page.getByTestId('bulk-pay-bar'), '★選択が持ち越されない').toHaveCount(0)
  })

  test('★支払い済みタブにはチェックボックスを出さない（一括の対象は未払いだけ）', async ({ page }) => {
    // 先に1件を支払い済みにしておく
    await restSrv(`subcontractor_invoices?id=eq.${inv.a1}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ paid: true, transfer_date: `${YM}-20` }),
    })

    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('invoice-filter-bar')).toBeVisible({ timeout: 15000 })
    // 行の「支払い済みにする」ボタンとも一致してしまうので、タブに限定して押す
    await page.locator('button.tab').filter({ hasText: '支払い済み' }).click()

    await expect(page.getByTestId('bulk-pay-select-all'), '支払い済みタブでは選べない').toHaveCount(0)
  })
})
