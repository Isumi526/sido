// ============================================================
//  admin.estimate-drawing-quantity.spec.ts
//  【見積Q7】図面凡例から確定数量を自動取込（床/置床/天井/建具/器具）
//
//  ★実施図面を全数解析した結果、床・置床・天井の面積、建具・器具の台数、紙管の本数は
//   設計者が凡例に明記していると分かった（拾い直す必要がない）。面積を計算するのではなく
//   「書いてある数字」を転記する機能。
//  ★天井合計 ≒ 通り芯面積 の検算を自動で走らせる（北新宿の実例: 71.0㎡ ≒ 10.2×6.95=70.9㎡）。
//   AIの抽出は間違いうるので「桁違い・部屋1つ分の取りこぼし」を機械で弾くのが要。
//  ★壁は対象外（面積が図面に無い）。ロス率は人が付ける。
//
//  ★解析AI(Gemini)は非決定・課金されるので呼ばない。EFの応答を差し替えて
//   抽出→検算→明細投入までの流れを決定的に検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const PROJ = `E2E数量抽出_${TS}`
let projId = ''

/** 最小PDF（2ページ） */
function makePdf(pages: number): Buffer {
  const objs: string[] = []
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  for (let i = 0; i < pages; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`)
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xrefAt = body.length
  const size = objs.length + 1
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  return Buffer.from(body + xref + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1')
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  projId = (await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId, name: PROJ }),
  }))[0].id
})

test.afterAll(async () => {
  await restSrv(`estimate_items?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_project_attachments?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
})

/**
 * 図面を添付して数量抽出を走らせ、結果パネルを開く。EFの応答は差し替える。
 * gridY を変えることで検算の乖離を作れる（警告テスト用）。
 */
async function runQuantityExtract(page: any, label: string, gridY: number) {
  // 1ページ目=天井の凡例（合計71.0㎡）＋通り芯 / 2ページ目=床と建具
  const byPage: Record<number, any> = {
    1: {
      parts: [{
        part: '天井',
        rows: [
          { code: 'C-01', spec: '岩綿吸音板', value: 6.5, unit: '㎡' },
          { code: 'C-03', spec: '化粧석膏ボード', value: 43.5, unit: '㎡' },
          { code: 'C-04', spec: 'AEP', value: 21.0, unit: '㎡' },
        ],
      }],
      gridSpanX: 10.2, gridSpanY: gridY, ceilingHeights: ['CH=2400'],
    },
    2: {
      parts: [
        { part: '床', rows: [{ code: 'F-01', spec: 'タイルカーペット', value: 21.3, unit: '㎡' }] },
        { part: '建具', rows: [{ code: 'AD-1', spec: '片開き', value: 1, unit: '台' }] },
      ],
      gridSpanX: null, gridSpanY: null, ceilingHeights: [],
    },
  }
  await page.route('**/functions/v1/drawing-quantity-extract', async (route: any) => {
    const body = JSON.parse(route.request().postData() || '{}')
    const d = byPage[body.page] ?? { parts: [], gridSpanX: null, gridSpanY: null, ceilingHeights: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, page: body.page, ...d }) })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  const fileName = `E2E数量図面_${label}.pdf`
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: fileName, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText(fileName, { timeout: 20000 })
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${projId}&name=eq.${encodeURIComponent(fileName)}&select=id`)
  await page.locator(`[data-testid="dqty-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dqty-panel"]')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('[data-testid="dqty-busy"]')).toHaveCount(0, { timeout: 40000 })
}

test('AC1★: 凡例の確定数量（床/天井/建具）が抽出されて一覧に出る', async ({ page }) => {
  // 天井71.0 vs 通り芯 10.2×6.95=70.9 → 乖離0.1%＝正常
  await runQuantityExtract(page, 'ac1', 6.95)

  const panel = page.locator('[data-testid="dqty-panel"]')
  await expect(panel, '天井の凡例が出る').toContainText('C-01')
  await expect(panel, '床の凡例が出る').toContainText('F-01')
  await expect(panel, '建具の台数も出る').toContainText('AD-1')
  await expect(panel, '面積の単位').toContainText('㎡')
  await expect(panel, '台数の単位').toContainText('台')
  // 壁は対象外であることを画面で明示している
  await expect(panel, '壁は対象外と明示').toContainText('壁は対象外')
  // ロス率は人が付ける（図面に「ロスは見込んでください」とあるため）
  await expect(panel, 'ロス率は人が付けると明示').toContainText('ロス率は人が付けて')
})

test('AC★: 天井合計と通り芯面積の検算が走り、妥当なら一致として出る', async ({ page }) => {
  await runQuantityExtract(page, 'ok', 6.95)

  const check = page.getByTestId('dqty-check')
  await expect(check, '検算結果が出る').toBeVisible()
  await expect(check, '天井合計71.0が出る').toContainText('71㎡')
  await expect(check, '通り芯面積70.9が出る').toContainText('70.9㎡')
  await expect(check, '妥当と判定').toContainText('妥当な範囲')
  await expect(page.getByTestId('dqty-check-warn'), '警告は出ない').toHaveCount(0)
})

// ★これが検算の存在価値。抽出漏れ・二重計上を機械で拾う
test('AC★: 天井合計が通り芯面積と大きく乖離したら警告する', async ({ page }) => {
  // 通り芯を 10.2×3.0=30.6㎡ にすると 天井71.0 は +132% 乖離
  await runQuantityExtract(page, 'warn', 3.0)

  const warn = page.getByTestId('dqty-check-warn')
  await expect(warn, '乖離が大きいと警告が出る').toBeVisible()
  await expect(warn).toContainText('乖離')
  await expect(warn, '何を疑えばよいか書いてある').toContainText('抽出漏れ・二重計上')
})

test('AC★: 選んだ数量が明細の初期値として入る（確定はしない）', async ({ page }) => {
  await runQuantityExtract(page, 'apply', 6.95)

  // 全解除してから床の1行だけ選ぶ（全部入れない＝人が選ぶ）
  await page.getByTestId('dqty-none').click()
  const rows = page.locator('[data-testid^="dqty-row-"]')
  const n = await rows.count()
  let floorIdx = -1
  for (let i = 0; i < n; i++) {
    if ((await rows.nth(i).innerText()).includes('F-01')) { floorIdx = i; break }
  }
  expect(floorIdx, '床の行が見つかる').toBeGreaterThanOrEqual(0)
  await page.getByTestId(`dqty-pick-${floorIdx}`).check()
  await page.getByTestId('dqty-apply').click()

  await expect(page.getByTestId('dqty-msg'), '単価とロスは人が入れると案内').toContainText('ロス率は人が入れて')

  // 明細に数量が入る（★単価は入れない＝確定しない）
  await expect.poll(async () => {
    const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=item_name,quantity,unit,unit_price`)
    return (items ?? []).filter((r: any) => String(r.item_name ?? '').includes('F-01')).length
  }, { timeout: 20000 }).toBe(1)

  const items = await restSrv(`estimate_items?project_id=eq.${projId}&select=item_name,quantity,unit,unit_price`)
  const floor = items.find((r: any) => String(r.item_name ?? '').includes('F-01'))
  expect(Number(floor.quantity), '凡例の面積がそのまま入る').toBe(21.3)
  expect(floor.unit).toBe('㎡')
  expect(Number(floor.unit_price) || 0, '★単価は入れない（確定しない）').toBe(0)
  // 選ばなかった天井は入っていない
  expect(items.some((r: any) => String(r.item_name ?? '').includes('C-01')), '選ばなかった行は入らない').toBe(false)
})

test('★1ページが504で落ちても他のページは取れ、そのページだけ再試行できる', async ({ page }) => {
  // 2026-08-18 通しレビュー: 実図面で 504 が出た。当時は1ページ失敗で break していたため、
  // 以降のページが丸ごと未処理のまま終わっていた（画面には途中までの結果だけが残る）。
  // ★「途中で落ちても残りは取れる」「落ちたページだけやり直せる」を固定する。
  let firstPageCalls = 0
  await page.route('**/functions/v1/drawing-quantity-extract', async (route: any) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.page === 1) {
      firstPageCalls++
      // 1回目だけ落とす（再試行で回復することを見るため）
      if (firstPageCalls === 1) {
        await route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: '解析エラー(504)' }) })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, page: 1, gridSpanX: 10.2, gridSpanY: 6.95, ceilingHeights: [],
          parts: [{ part: '天井', rows: [{ code: 'C-01', spec: '再試行で取れた', value: 71.0, unit: '㎡' }] }] }),
      })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, page: body.page, gridSpanX: null, gridSpanY: null, ceilingHeights: [],
        parts: [{ part: '床', rows: [{ code: 'F-01', spec: '2ページ目は取れる', value: 21.3, unit: '㎡' }] }] }),
    })
  })

  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'intake', '[data-testid="intake-dropzone"]')
  const fileName = `E2E数量図面_retry_${TS}.pdf`
  await page.locator('[data-testid="intake-file"]').setInputFiles({
    name: fileName, mimeType: 'application/pdf', buffer: makePdf(2),
  })
  await expect(page.locator('[data-testid="intake-att-list"]')).toContainText(fileName, { timeout: 20000 })
  const att = await restSrv(`estimate_project_attachments?project_id=eq.${projId}&name=eq.${encodeURIComponent(fileName)}&select=id`)
  await page.locator(`[data-testid="dqty-open-${att[0].id}"]`).click()
  await expect(page.locator('[data-testid="dqty-panel"]')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('[data-testid="dqty-busy"]')).toHaveCount(0, { timeout: 40000 })

  // ★2ページ目は取れている（1ページ目の失敗で全体が止まっていない）
  await expect(page.locator('[data-testid="dqty-panel"]'), '★落ちたページ以外は取れる').toContainText('2ページ目は取れる')
  // 失敗ページが提示されている
  const failed = page.locator('[data-testid="dqty-failed-pages"]')
  await expect(failed, '★失敗ページが分かる').toBeVisible()
  await expect(failed).toContainText('P.1')

  // 再試行するとそのページだけ取り直せて、失敗一覧から消える
  await page.locator('[data-testid="dqty-retry-page"]').click()
  await expect(page.locator('[data-testid="dqty-panel"]'), '★再試行で取れる').toContainText('再試行で取れた', { timeout: 20000 })
  await expect(failed, '★直ったら失敗一覧から消える').toHaveCount(0, { timeout: 10000 })
})

