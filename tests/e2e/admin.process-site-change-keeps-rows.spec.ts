// ============================================================
//  admin.process-site-change-keeps-rows.spec.ts
//  バグ修正: 工程の一括追加モーダルで、未保存の行（Excel取込 or 手入力＝id無し行）を入れた後に
//  「現場」プルダウンで現場を選び直すと取込内容が全部消える不具合の回帰テスト。
//  修正後は editorPickSite が未保存かつ内容ありの行を新現場へ引き継ぎ、保存で新現場に紐づく。
//  ※ Excel/EF に依存せず、手入力の未保存行（＝取込行と同じ id無し行）で決定論的に検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_A = `E2E工程現場A_${TS}`
const SITE_B = `E2E工程現場B_${TS}`
const TASK = `E2E未保存工程_${TS}`

let siteA = ''
let siteB = ''

test.describe('工程管理 現場選び直しで未保存行が消えない', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const a = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE_A, active: true }) })
    const b = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE_B, active: true }) })
    siteA = a[0].id; siteB = b[0].id
  })

  test.afterAll(async () => {
    await restSrv(`process_tasks?site_id=in.(${siteA},${siteB})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${siteA},${siteB})`, { method: 'DELETE' }).catch(() => {})
  })

  test('未保存の行を入れて現場を選び直しても消えず、保存すると選び直した現場に紐づく', async ({ page }) => {
    await page.goto('/process', { waitUntil: 'networkidle' })
    await page.locator('.site-select').selectOption(siteA)
    await page.locator('.btn-add').click()
    await expect(page.locator('.editor-modal')).toBeVisible({ timeout: 10000 })
    await page.locator('.editor-modal .ed-site select').selectOption(siteA)

    // 未保存の行に入力（Excel取込で入る id無し行と同じ状態）
    await page.locator('.editor-modal .ed-name').first().fill(TASK)

    // 現場を B に選び直す
    await page.locator('.editor-modal .ed-site select').selectOption(siteB)

    // ★ 修正前は行が丸ごと破棄され空になる。修正後は未保存行が引き継がれ先頭に残る。
    await expect(page.locator('.editor-modal .ed-name').first()).toHaveValue(TASK)

    // 保存 → 選び直した現場 B に紐づく（A には作られない）
    await page.locator('.btn-save').click()
    await expect(page.locator('.editor-modal')).toBeHidden({ timeout: 10000 })
    const rowsB = await restSrv(`process_tasks?site_id=eq.${siteB}&name=eq.${encodeURIComponent(TASK)}&select=id`)
    const rowsA = await restSrv(`process_tasks?site_id=eq.${siteA}&name=eq.${encodeURIComponent(TASK)}&select=id`)
    expect(rowsB.length, '選び直した現場Bに保存される').toBe(1)
    expect(rowsA.length, '元の現場Aには作られない').toBe(0)
  })
})
