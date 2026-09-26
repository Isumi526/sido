// ============================================================
//  liff.inventory-confirm-role.spec.ts
//  在庫③（2026-09-10 SEED 会議・要回答9=C・設計書 I-2）:
//   AI候補の「確認役」を会社ごとに選べる。既定＝申請者本人がその場で品目を確定（従来どおり・liff.inventory.spec）。
//   settings.inventory_confirm_role='office' にすると、作業員は写真＋数量（品目は分かれば）で送り、
//   残数には触れず「確認待ち」になる。事務側が管理画面の未確認一覧で確定した時に残数へ反映される（admin.inventory-confirm.spec）。
//
//  出所: 亥角「人の承認は必要…申請者の方ができればベスト」／大塚「電卓ってやったら出る方がいい」
//
//  ★守ること:
//   1. 事務モードでは品目なしで送れる（写真・数量・現場は従来どおり必須）
//   2. 送っても残数は動かない（inventory_movements は増えず、inventory_pending_moves に pending で残る）
//   3. AI の読み・候補・作業員が選んだ品目が確認待ちに添えられる（事務側の手がかり）
//   4. 画面の「確認待ち」に自分の分が出る。差し戻されたら理由が見える
//   5. 同じ clientRequestId の再送は確認待ちを二重に作らない
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const ITEM = `E2E確認役品目_${TS}`
const SITE = `E2E確認役現場_${TS}`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let accountId = ''
let workerId = ''
let itemId = ''
let siteId = ''

async function stubUpload(page: import('@playwright/test').Page) {
  await page.route('**/functions/v1/expense-receipt-upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: `https://example.test/inv_${Date.now()}.png` }) })
  })
}
async function stubSuggest(page: import('@playwright/test').Page, body: unknown) {
  await page.route('**/functions/v1/inventory', async (route) => {
    let action = ''
    try { action = JSON.parse(route.request().postData() ?? '{}').action } catch { /* noop */ }
    if (action === 'suggest') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...(body as object) }) })
    else await route.continue()
  })
}
async function itemQty(): Promise<number> {
  return Number((await restSrv(`inventory_items?id=eq.${itemId}&select=current_qty`))[0].current_qty)
}

test.describe('在庫③ 確認役＝事務側（作業員アプリ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    await restSrv('worker_consents', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, consent_version: 1, consent_text: 'E2E' }) }).catch(() => {})
    itemId = (await restSrv('inventory_items', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ITEM, unit: '枚', category: 'ボード', current_qty: 10, active: true }) }))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) }))[0].id
    await restSrv('settings', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, key: 'inventory_confirm_role', value: 'office', label: 'E2E' }) })
  })
  test.afterAll(async () => {
    // ★確認役は既定（本人）へ戻す＝行を消す。残したままだと liff.inventory / admin.inventory の残数 assert が崩れる
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.inventory_confirm_role`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_pending_moves?account_id=eq.${accountId}&site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_movements?item_id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_items?id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★品目なしで送れて残数は動かず「確認待ち」に残る（AIの読み・候補が添えられる）', async ({ page }) => {
    await stubUpload(page)
    await stubSuggest(page, { guessName: 'せっこうボード 12.5', guessCategory: 'ボード', candidates: [{ id: itemId, name: ITEM, unit: '枚', category: 'ボード', confidence: 0.8 }] })
    const before = await itemQty()
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('inv-office-note'), '事務モードの案内が出る').toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('inv-kind-return')).toBeChecked()
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('inv-ai-suggest').click()
    await expect(page.getByTestId('inv-ai-candidates').locator('button')).toHaveCount(1)
    // 品目は選ばない（写真＋数量＋現場だけ）
    await page.getByTestId('inv-qty').fill('3')
    await expect(page.getByTestId('inv-submit'), '引き上げは現場が要る').toBeDisabled()
    await page.getByTestId('inv-site').selectOption(siteId)
    await expect(page.getByTestId('inv-submit')).toBeEnabled()
    await expect(page.getByTestId('inv-submit')).toContainText('確認待ち')
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('事務側が品目を確定', { timeout: 20000 })

    expect(await itemQty(), '★残数は動かない').toBe(before)
    const mv = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=id`)
    expect(mv.length, '移動記録は増えない').toBe(0)
    const pd = await restSrv(`inventory_pending_moves?account_id=eq.${accountId}&site_id=eq.${siteId}&select=status,kind,qty,photo_urls,ai_guess_name,ai_candidates,suggested_item_id,created_by_worker_id,client_request_id`)
    expect(pd.length).toBe(1)
    expect(pd[0].status).toBe('pending')
    expect(pd[0].kind).toBe('return')
    expect(Number(pd[0].qty)).toBe(3)
    expect(pd[0].photo_urls.length).toBe(1)
    expect(pd[0].ai_guess_name, 'AIの読みが添えられる').toBe('せっこうボード 12.5')
    expect(pd[0].ai_candidates[0]?.id, 'AIの候補が添えられる').toBe(itemId)
    expect(pd[0].suggested_item_id, '品目を選ばなかったので null').toBeNull()
    expect(pd[0].created_by_worker_id, '登録者は検証済みの身元').toBe(workerId)
    expect(pd[0].client_request_id).toBeTruthy()
    // 画面の「確認待ち」に出る
    await expect(page.getByTestId('inv-pending-row').first()).toContainText('確認待ち')
  })

  test('差し戻されると理由つきで「差し戻し」と出る／同じキーの再送は二重に作らない', async ({ page }) => {
    const rows = await restSrv(`inventory_pending_moves?account_id=eq.${accountId}&site_id=eq.${siteId}&status=eq.pending&select=id,client_request_id`)
    expect(rows.length).toBe(1)
    // 再送（同じ clientRequestId）→ 二重に作らない
    const res = await fetch(`${SUPABASE_URL}/functions/v1/inventory`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', dev_line_user_id: 'dev-user-id', qty: 3, kind: 'return', siteId, photoUrls: ['https://example.test/x.png'], clientRequestId: rows[0].client_request_id }),
    })
    expect((await res.json()).deduped).toBe(true)
    expect((await restSrv(`inventory_pending_moves?account_id=eq.${accountId}&site_id=eq.${siteId}&select=id`)).length).toBe(1)
    // 事務側が差し戻す（admin 側の RPC を service_role で直接）
    await restSrv('rpc/inventory_confirm_pending', { method: 'POST', body: JSON.stringify({ p_pending_id: rows[0].id, p_item_id: null, p_decided_by_name: 'E2E事務', p_reject_reason: '写真が暗くて読めません' }) })
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    const row = page.getByTestId('inv-pending-row').first()
    await expect(row).toContainText('差し戻し', { timeout: 15000 })
    await expect(row).toContainText('写真が暗くて読めません')
  })
})
