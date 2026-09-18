// ============================================================
//  liff.inventory-ai-item.spec.ts
//  在庫②（2026-09-10 SEED 会議・2026-09-12 決定）:
//   品目マスタ「区分→詳細」＋予測検索／写真→AI品目候補／無ければその場で新規登録／訂正履歴は自社内で学習。
//  出所: 大塚「電卓ってやったら出る方がいい」「区分を作って、区分からの詳細」
//        亥角「これはこの品番だよっていう履歴をひたすらAIに学習」
//
//  ★守ること:
//   1. 区分チップで絞れ、検索語で部分一致（全角/半角・空白を無視）した候補が出る
//   2. AI候補（EF の suggest。本 spec は Gemini を呼ばず EF 応答をスタブ）をタップすると品目が確定する
//   3. 登録後、訂正履歴 inventory_item_corrections に account_id つきで1行残る（AIの読み・確定品目・matched）
//   4. 候補が無い品目は現場からその場で新規登録でき（承認なし）、同名は二重に作られない
//   5. AI は補助である旨が画面に出る
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let accountId = ''
let workerId = ''
let boardId = ''
let calcId = ''

async function stubUpload(page: import('@playwright/test').Page) {
  await page.route('**/functions/v1/expense-receipt-upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: `https://example.test/inv_${Date.now()}.png` }) })
  })
}
/** suggest だけスタブ（Gemini を叩かない）。他の action は素通し */
async function stubSuggest(page: import('@playwright/test').Page, body: unknown) {
  await page.route('**/functions/v1/inventory', async (route) => {
    const req = route.request()
    let action = ''
    try { action = JSON.parse(req.postData() ?? '{}').action } catch { /* noop */ }
    if (action === 'suggest') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...(body as object) }) })
    else await route.continue()
  })
}

test.describe('在庫②（作業員アプリ・区分→詳細・AI候補・新規登録）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    await restSrv('worker_consents', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, consent_version: 1, consent_text: 'E2E' }) }).catch(() => {})
    const mk = async (name: string, category: string, unit: string) => (await restSrv('inventory_items', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, category, unit, current_qty: 10, active: true }),
    }))[0].id
    boardId = await mk(`E2E石膏ボード12.5_${TS}`, 'ボード', '枚')
    calcId = await mk(`E2Eケイカル板 t6_${TS}`, 'ボード', '枚')
    await mk(`E2E電卓_${TS}`, '養生・消耗品', '個')
  })
  test.afterAll(async () => {
    const rows = await restSrv(`inventory_items?account_id=eq.${accountId}&name=like.E2E*_${TS}*&select=id`).catch(() => [])
    for (const r of rows ?? []) {
      await restSrv(`inventory_item_corrections?item_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`inventory_movements?item_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`inventory_items?account_id=eq.${accountId}&name=like.E2E*_${TS}*`, { method: 'DELETE' }).catch(() => {})
  })

  test('★区分で絞り→予測検索で選べる（全角/空白ゆれも当たる）', async ({ page }) => {
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await expect(page.locator('.ai-note'), 'AIは補助と明記').toContainText('AIは補助')
    // 区分「ボード」で絞ると電卓は出ない
    await page.getByTestId('inv-cat-ボード').click()
    await expect(page.getByTestId('inv-item-matches')).toContainText('E2E石膏ボード')
    await expect(page.getByTestId('inv-item-matches')).not.toContainText('E2E電卓')
    // 検索（全角・空白ゆれ）
    await page.getByTestId('inv-item-search').fill('ケイカル板　Ｔ６')
    await expect(page.getByTestId('inv-item-matches').locator('button')).toHaveCount(1)
    await page.getByTestId(`inv-item-opt-${calcId}`).click()
    await expect(page.getByTestId('inv-item-picked')).toContainText('ケイカル板')
    await page.getByTestId('inv-item-clear').click()
    await page.getByTestId('inv-cat-all').click()
    await page.getByTestId('inv-item-search').fill('電卓')
    await expect(page.getByTestId('inv-item-matches')).toContainText('E2E電卓')
  })

  test('★写真→AI候補をタップして登録すると、訂正履歴が自社の account_id で残る', async ({ page }) => {
    await stubUpload(page)
    await stubSuggest(page, { guessName: 'せっこうボード 12.5', guessCategory: 'ボード', candidates: [{ id: boardId, name: `E2E石膏ボード12.5_${TS}`, unit: '枚', category: 'ボード', confidence: 0.9 }, { id: calcId, name: `E2Eケイカル板 t6_${TS}`, unit: '枚', category: 'ボード', confidence: 0.3 }] })
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await page.getByTestId('inv-kind-in').check()
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('inv-ai-suggest').click()
    await expect(page.getByTestId('inv-ai-candidates').locator('button')).toHaveCount(2)
    // 人が第2候補（ケイカル）に訂正して確定
    await page.getByTestId(`inv-ai-cand-${calcId}`).click()
    await expect(page.getByTestId('inv-item-picked')).toContainText('ケイカル板')
    await page.getByTestId('inv-qty').fill('2')
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('登録しました', { timeout: 20000 })

    const corr = await restSrv(`inventory_item_corrections?item_id=eq.${calcId}&select=account_id,ai_guess,ai_category,matched,worker_id,photo_url`)
    expect(corr.length, '★訂正履歴が1行').toBe(1)
    expect(corr[0].account_id, '★自社の account_id で閉じる').toBe(accountId)
    expect(corr[0].ai_guess).toBe('せっこうボード 12.5')
    expect(corr[0].matched, '第1候補と違う品目を確定＝訂正').toBe(false)
    expect(corr[0].worker_id, '登録者は検証済みの身元').toBe(workerId)
    expect(corr[0].photo_url, '写真URLが残る').toBeTruthy()
    // 同じ写真×品目の再送は二重に残らない（べき等・Gemini 指摘）
    const { ANON_KEY, SUPABASE_URL } = await import('./helpers')
    await fetch(`${SUPABASE_URL}/functions/v1/inventory`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'correction', dev_line_user_id: 'dev-user-id', itemId: calcId, aiGuess: 'せっこうボード 12.5', photoUrl: corr[0].photo_url }) })
    const corr2 = await restSrv(`inventory_item_corrections?item_id=eq.${calcId}&select=id`)
    expect(corr2.length, '★再送しても1行のまま').toBe(1)
  })

  test('候補に無い品目はその場で新規登録でき、同名は二重に作られない', async ({ page }) => {
    await stubSuggest(page, { guessName: `E2E新規ビス_${TS}`, guessCategory: 'ビス・金物', candidates: [] })
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('inv-ai-suggest').click()
    // マスタに無い → 新規登録の下書きに AI の読みが入る
    await expect(page.getByTestId('inv-new-box')).toBeVisible()
    await expect(page.getByTestId('inv-new-name')).toHaveValue(`E2E新規ビス_${TS}`)
    await expect(page.getByTestId('inv-new-category')).toHaveValue('ビス・金物')
    await page.getByTestId('inv-new-unit').fill('箱')
    await page.getByTestId('inv-new-save').click()
    await expect(page.getByTestId('inv-item-picked')).toContainText(`E2E新規ビス_${TS}`)
    const created = await restSrv(`inventory_items?account_id=eq.${accountId}&name=eq.${encodeURIComponent(`E2E新規ビス_${TS}`)}&select=id,category,unit,current_qty`)
    expect(created.length, '★承認なしで即登録').toBe(1)
    expect(created[0].category).toBe('ビス・金物')
    expect(created[0].unit).toBe('箱')
    expect(Number(created[0].current_qty)).toBe(0)

    // 同名（全角/空白ゆれ）でもう一度登録しても増えない
    await page.getByTestId('inv-item-clear').click()
    await page.getByTestId('inv-new-open').click()
    await page.getByTestId('inv-new-name').fill(`Ｅ２Ｅ新規ビス_${TS} `)
    await page.getByTestId('inv-new-save').click()
    await expect(page.getByTestId('inv-msg')).toContainText('既に登録されていた')
    const again = await restSrv(`inventory_items?account_id=eq.${accountId}&name=like.*新規ビス_${TS}*&select=id`)
    expect(again.length, '★同名は二重に作られない').toBe(1)
  })
})
