// ============================================================
//  admin.purchase-order.spec.ts
//  注文書発行（admin / 見積→注文→請求エピック）
//   AC1: 見積書がある場合のみ発行でき、注文書番号(PO-<年>-<連番>)が採番される
//   AC2: 注文書に 合計金額・現場・受注者(担当者)・支払条件・特記事項 を含む
//   AC3: 注文書PDFが生成される（pdf_path / PDFリンク）
//   AC4: 発行で受注者担当者にトークンURL付きメールが送信される（dev=test関数・実送信なし）
//  ※ 承諾画面・署名は別チケット。ここは発行＋メール（トークン作成）まで。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E注文_${TS}`              // estimates.note に入れて後始末
const CONTACT_EMAIL = `e2e-po-${TS}@example.com`

let accountId = ''
let subId = ''
let siteName = ''
let contactId = ''
let estimateId = ''
let orderId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 既存のアクティブ業者・現場を1件ずつ拝借
  const subs  = await restSrv(`subcontractors?account_id=eq.${accountId}&active=eq.true&select=id,name&limit=1`)
  const sites = await restSrv(`sites?account_id=eq.${accountId}&active=eq.true&select=id,name&limit=1`)
  subId = subs[0].id
  siteName = sites[0].name
  const siteId = sites[0].id

  // 担当者（メール付き）を作成 → 注文書メールの宛先になる
  const c = await restSrv('subcontractor_contacts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, subcontractor_id: subId,
      name: `E2E担当_${TS}`, email: CONTACT_EMAIL, phone: '090-0000-0000', sort_order: 0, is_deleted: false,
    }),
  })
  contactId = c[0].id

  // 見積書を作成（注文書の正本・縛り）
  const e = await restSrv('estimates', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, subcontractor_id: subId, site_id: siteId,
      estimate_number: `E2E-EST-${TS}`, total_amount: 333000, construction_details: 'E2E 内装一式', note: TOKEN, is_deleted: false,
    }),
  })
  estimateId = e[0].id
})

test.afterAll(async () => {
  // 後始末：注文書 → トークン → 見積 → 担当者
  if (orderId) {
    await restSrv(`document_access_tokens?document_id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`purchase_orders?id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`purchase_orders?estimate_id=eq.${estimateId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimates?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
  if (contactId) await restSrv(`subcontractor_contacts?id=eq.${contactId}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1〜AC4: 見積書から注文書を発行 → 採番・PDF・承諾メール送信', async ({ page }) => {
  await page.goto('/purchase-orders', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('注文書発行')

  // 発行モーダルを開く
  await page.locator('.btn-add').click()
  const modal = page.locator('.modal.wide')
  await expect(modal).toBeVisible()

  // 見積書を選択（value=estimateId）→ 受注者・現場・金額が自動反映
  await modal.locator('select').first().selectOption(estimateId)
  // 担当者を選択（value=contactId）
  await modal.locator('select').nth(1).selectOption(contactId)

  // プレビューに受注者名・現場・承諾文言が出る（AC2）
  const doc = modal.locator('.po-doc')
  await expect(doc).toContainText('御中')
  await expect(doc).toContainText(siteName)
  await expect(doc).toContainText('¥333,000')
  await expect(doc).toContainText('承諾手続き')          // 方式X承諾文言

  // 発行（dev: test-send-purchase-order = 実メールなし）
  await modal.locator('.btn-save').click()
  // 成功するとモーダルが閉じる
  await expect(modal).toBeHidden({ timeout: 20000 })

  // DB 検証：注文書 + トークン（order_accept / purchase_order）が作られている
  // ※一覧の行は「自分の注文書番号」で特定する（他の注文書データ混在・並び順に強い）
  const orders = await restSrv(`purchase_orders?estimate_id=eq.${estimateId}&select=id,order_number,total_amount,email_sent_at,pdf_path,vendor_contact_name,payment_terms`)
  expect(orders.length).toBe(1)
  orderId = orders[0].id
  expect(orders[0].order_number).toMatch(/^PO-\d{4}-\d{4}$/)

  // 一覧で自分の注文書の行を検証（承諾済バッジ .badge.ok.link と区別するため :not(.link)）
  const row = page.locator('table.table tbody tr', { hasText: orders[0].order_number })
  await expect(row.locator('.mono')).toHaveText(orders[0].order_number)        // AC1: 採番
  await expect(row.locator('.badge.ok:not(.link)')).toHaveText('送信済み')      // AC4: メール送信済み
  await expect(row.locator('.pdf-link')).toBeVisible()                         // AC3: PDF生成

  expect(orders[0].total_amount).toBe(333000)
  expect(orders[0].email_sent_at).toBeTruthy()            // AC4
  expect(orders[0].pdf_path).toBeTruthy()                 // AC3
  expect(orders[0].payment_terms).toBeTruthy()            // AC2: 支払条件含む

  const tokens = await restSrv(`document_access_tokens?document_id=eq.${orderId}&purpose=eq.order_accept&document_type=eq.purchase_order&select=id,token_hash`)
  expect(tokens.length).toBeGreaterThanOrEqual(1)
  expect(tokens[0].token_hash).toBeTruthy()               // 平文ではなくハッシュが保存される
})

test('縛り: 発行済みの見積書は再発行の選択肢に出ない（1:1）', async ({ page }) => {
  await page.goto('/purchase-orders', { waitUntil: 'networkidle' })
  await page.locator('.btn-add').click()
  const modal = page.locator('.modal.wide')
  await expect(modal).toBeVisible()
  // 1件目で発行済みの見積書(E2E-EST-<ts>)は availableEstimates から除外される
  const optionTexts = await modal.locator('select').first().locator('option').allInnerTexts()
  expect(optionTexts.join('\n')).not.toContain(`E2E-EST-${TS}`)
})
