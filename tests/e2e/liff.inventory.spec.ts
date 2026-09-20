// ============================================================
//  liff.inventory.spec.ts
//  在庫①（2026-09-10 SEED 会議・2026-09-12 決定）:
//   作業員アプリの「在庫」画面で入荷・持出を写真つきで記録する。移動記録に 種別・現場・写真・登録者 が残り、現在庫が増減する。
//  ★2026-09-18 main基点で切り直し：「日報の1問からの引き上げ登録」は方向転換（保留）した
//   report-tail-question に相乗りしていたため、第2フォーム（ステップ式）の引き上げステップへ移す
//   （https://app.notion.com/p/3d90ff81c56b818f82a3c857a4f15367）。ここでは対象外＝独立した①〜②のみ検証。
//
//  出所: 大塚「納品書で百本あっても…15本残ってましたよ…知らずに永遠と置いてある」
//        亥角「持ち出した時と引き上げの最低限、写真を残すのはマスト」
//
//  ★2026-09-19 レビュー（亥角）で軸を「引き上げ中心」に直した:
//   会議の主役は「引き上げ（余りを倉庫へ戻す）→ 何が残っているか見える → 次の現場で使う」。
//   大塚「15本残りましたよって帰ってきてその辺に置いとく…現場で使えばよかった」／今井「入ってもその出すだけ」。
//   → 画面の1番目＝引き上げ（既定）、2番目＝持出、3番目＝入荷。テナント別フラグ（feature.inventory・既定OFF）でベータ。
//   → /ship の独立レビュー（Gemini）指摘: 連打・再送で二重登録 → clientRequestId でべき等に。
//
//  ★守ること:
//   1. 写真が無いと登録できない（作業員の最低限入力＝写真）
//   2. 引き上げは現場つきで delta=＋数量、記録に kind='return'・site_id・photo_urls・登録者が残る（既定の種別）
//   3. 持出は現場つきで delta=−数量、記録に kind='out' が残る
//   4. 画面に「会計在庫ではありません」と出る
//   5. 同じ clientRequestId の再送は二重に増減しない
//   6. フラグOFF＝メニューに出ない・画面は閉じる・EF は 403
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, setFeatureFlag, FEATURE_KEY_INVENTORY, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const ITEM = `E2E在庫品目_${TS}`
const SITE = `E2E在庫現場_${TS}`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let accountId = ''
let userId = ''
let workerId = ''
let itemId = ''
let siteId = ''

/** 写真のアップロードは対象外なので通す（ストレージを汚さない） */
async function stubUpload(page: import('@playwright/test').Page) {
  await page.route('**/functions/v1/expense-receipt-upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: `https://example.test/inv_${Date.now()}.png` }) })
  })
}
async function itemQty(): Promise<number> {
  return Number((await restSrv(`inventory_items?id=eq.${itemId}&select=current_qty`))[0].current_qty)
}

test.describe('在庫（作業員アプリ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
    itemId = (await restSrv('inventory_items', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ITEM, unit: '枚', current_qty: 10, active: true }),
    }))[0].id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
    // ★同意済みにしておく（helpers.ts の ensureDevWorker と同じ理由）。未同意だと ConsentGate が
    //  全画面オーバーレイでポインタを奪い、在庫画面の操作が「visible/enabled なのにクリックできない」で落ちる
    await restSrv('worker_consents', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, consent_version: 1, consent_text: 'E2E: 同意済みの既定状態' }),
    }).catch(() => {})
  })
  test.afterAll(async () => {
    await restSrv(`inventory_movements?item_id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_items?id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&note=eq.E2E在庫引き上げ`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★引き上げが1番目・既定で、写真つきで記録すると現在庫が増え、kind=return・現場・写真・登録者が残る（写真なしは登録できない）', async ({ page }) => {
    await stubUpload(page)
    const before = await itemQty()
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('inv-note'), '会計在庫ではないと明記').toContainText('会計在庫ではありません')
    // 並び＝引き上げ／持出／入荷。既定は引き上げ（会議の主役）
    const kinds = page.locator('.kinds input[type=radio]')
    await expect(kinds).toHaveCount(3)
    await expect(kinds.nth(0)).toHaveAttribute('value', 'return')
    await expect(kinds.nth(1)).toHaveAttribute('value', 'out')
    await expect(kinds.nth(2)).toHaveAttribute('value', 'in')
    await expect(page.getByTestId('inv-kind-return')).toBeChecked()
    await page.getByTestId('inv-item-search').fill(ITEM)
    await page.getByTestId(`inv-item-opt-${itemId}`).click()
    await page.getByTestId('inv-qty').fill('4')
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await expect(page.getByTestId('inv-submit'), '★引き上げは「どの現場から」が要る').toBeDisabled()
    await page.getByTestId('inv-site').selectOption(siteId)
    await expect(page.getByTestId('inv-submit')).toBeEnabled()
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('登録しました', { timeout: 20000 })
    await expect.poll(itemQty, { timeout: 10000 }).toBe(before + 4)
    const rv = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=kind,delta,site_id,photo_urls,created_by_worker_id,client_request_id&order=created_at.desc&limit=1`)
    expect(rv[0].kind).toBe('return')
    expect(Number(rv[0].delta)).toBe(4)
    expect(rv[0].site_id, 'どの現場から引き上げたかが残る').toBe(siteId)
    expect(rv[0].photo_urls.length, '写真が残る').toBe(1)
    expect(rv[0].created_by_worker_id, '★登録者は検証済みの身元（クライアント申告ではない）').toBe(workerId)
    expect(rv[0].client_request_id, 'べき等キーが残る').toBeTruthy()
  })

  test('持出を写真つきで記録すると現在庫が減り、種別・現場・写真・登録者が残る（写真なしは登録できない）', async ({ page }) => {
    await stubUpload(page)
    const before = await itemQty()
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await page.getByTestId('inv-kind-out').check()
    // 在庫②で品目選択は予測検索になった（区分→詳細）。検索して候補をタップ
    await page.getByTestId('inv-item-search').fill(ITEM)
    await page.getByTestId(`inv-item-opt-${itemId}`).click()
    await page.getByTestId('inv-qty').fill('3')
    await page.getByTestId('inv-site').selectOption(siteId)
    await expect(page.getByTestId('inv-submit'), '★写真が無いと登録できない').toBeDisabled()
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await expect(page.getByTestId('inv-submit')).toBeEnabled()
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('登録しました', { timeout: 20000 })

    await expect.poll(itemQty, { timeout: 10000 }).toBe(before - 3)
    const mv = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=kind,delta,site_id,photo_urls,created_by_worker_id,created_by_name&order=created_at.desc&limit=1`)
    expect(mv[0].kind).toBe('out')
    expect(Number(mv[0].delta)).toBe(-3)
    expect(mv[0].site_id, '現場が残る').toBe(siteId)
    expect(mv[0].photo_urls.length, '写真が残る').toBe(1)
    expect(mv[0].created_by_worker_id, '★登録者は検証済みの身元（クライアント申告ではない）').toBe(workerId)
    // 画面の履歴にも出る
    await expect(page.getByTestId('inv-recent-row').first()).toContainText(ITEM)
  })

  test('入荷は現場なしで記録でき、現在庫が増える', async ({ page }) => {
    await stubUpload(page)
    const before = await itemQty()
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await page.getByTestId('inv-kind-in').check()
    // 在庫②で品目選択は予測検索になった（区分→詳細）。検索して候補をタップ
    await page.getByTestId('inv-item-search').fill(ITEM)
    await page.getByTestId(`inv-item-opt-${itemId}`).click()
    await page.getByTestId('inv-qty').fill('5')
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('登録しました', { timeout: 20000 })
    await expect.poll(itemQty, { timeout: 10000 }).toBe(before + 5)
  })

  test('★同じ clientRequestId の再送は二重に増減しない（連打・通信断からの再送）', async () => {
    const before = await itemQty()
    const clientRequestId = crypto.randomUUID()
    const call = () => fetch(`${SUPABASE_URL}/functions/v1/inventory`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', dev_line_user_id: 'dev-user-id', itemId, qty: 2, kind: 'return', siteId, photoUrls: ['https://example.test/idem.png'], clientRequestId }),
    })
    const r1 = await call(); expect(r1.status).toBe(200)
    const r2 = await call(); expect(r2.status).toBe(200)
    expect((await r2.json()).ok).toBe(true)
    await expect.poll(itemQty, { timeout: 10000 }).toBe(before + 2)
    const rows = await restSrv(`inventory_movements?item_id=eq.${itemId}&client_request_id=eq.${clientRequestId}&select=id`)
    expect(rows.length, '同じキーは1行だけ').toBe(1)
  })

  test('★フラグOFF＝メニューに出ない・画面は閉じる・EF は 403（ONに戻すと出る）', async ({ page }) => {
    await setFeatureFlag(FEATURE_KEY_INVENTORY, false)
    try {
      await page.goto('/', { waitUntil: 'networkidle' })
      await expect(page.locator('a.menu-card[href="/sites"]'), 'ホームのメニューが描画されてから判定').toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('menu-inventory')).toHaveCount(0)
      await page.goto('/inventory', { waitUntil: 'networkidle' })
      await expect(page.getByTestId('inv-disabled')).toBeVisible({ timeout: 15000 })
      await expect(page.getByTestId('inv-form')).toHaveCount(0)
      const res = await fetch(`${SUPABASE_URL}/functions/v1/inventory`, {
        method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'items', dev_line_user_id: 'dev-user-id' }),
      })
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('feature_disabled')
    } finally {
      await setFeatureFlag(FEATURE_KEY_INVENTORY, true)   // ★必ず戻す（後続の在庫 spec が落ちる）
    }
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('menu-inventory').first()).toBeVisible({ timeout: 15000 })
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('inv-form')).toBeVisible({ timeout: 15000 })
  })

})
