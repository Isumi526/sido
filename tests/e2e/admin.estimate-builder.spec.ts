// ============================================================
//  admin.estimate-builder.spec.ts
//  【見積】E1 全体見積→工種別 自動分割（手コピペ撲滅）
//   AC1: 全体見積で入力した明細が、転記操作なしで工種別に集計される
//   AC2: 工種別に金額が集計される（軽鉄=2行の合計、工種別合計と総合計）
//   ※ estimate_* は RLS 有効（admin authenticated のみ）。検証/cleanup は service_role(restSrv)。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

const TS = Date.now()
const PROJ = `E2E見積_${TS}`
const TRADE_A = `軽鉄_${TS}`   // 2行: 2000 + 3000 = 5000
const TRADE_B = `ボード_${TS}` // 1行: 5000

test.describe.configure({ mode: 'serial' })

test.describe('見積もり 全体見積→工種別自動集計', () => {
  test.afterAll(async () => {
    const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ)}&select=id`).catch(() => [])
    for (const p of projs ?? []) {
      await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_trades?name=eq.${encodeURIComponent(TRADE_A)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_trades?name=eq.${encodeURIComponent(TRADE_B)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/AC2: 明細入力→工種別に自動集計され、DBにも反映される', async ({ page }) => {
    await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('見積もり')

    // 案件を追加
    await page.locator('[data-testid="new-project-name"]').fill(PROJ)
    await page.locator('[data-testid="add-project"]').click()
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ)

    // 工種を2つ追加
    await page.locator('[data-testid="new-trade-name"]').fill(TRADE_A)
    await page.locator('[data-testid="add-trade"]').click()
    await page.locator('[data-testid="new-trade-name"]').fill(TRADE_B)
    await page.locator('[data-testid="add-trade"]').click()

    // 明細3行（軽鉄2000・ボード5000・軽鉄3000）
    const addLine = async (i: number, trade: string, name: string, qty: number, price: number) => {
      await page.locator('[data-testid="add-row"]').click()
      await page.locator(`[data-testid="item-trade-${i}"]`).selectOption({ label: trade })
      await page.locator(`[data-testid="item-name-${i}"]`).fill(name)
      await page.locator(`[data-testid="item-qty-${i}"]`).fill(String(qty))
      await page.locator(`[data-testid="item-price-${i}"]`).fill(String(price))
    }
    await addLine(0, TRADE_A, 'スタッド', 2, 1000)   // 2000
    await addLine(1, TRADE_B, 'PB12.5', 1, 5000)     // 5000
    await addLine(2, TRADE_A, 'ランナー', 3, 1000)   // 3000

    // 工種別内訳パネル（転記操作なしで集計）
    const panel = page.locator('section.panel', { hasText: '工種別 内訳' })
    await expect(panel.locator('tr', { hasText: TRADE_A }).locator('.num')).toHaveText('¥5,000')
    await expect(panel.locator('tr', { hasText: TRADE_B }).locator('.num')).toHaveText('¥5,000')
    await expect(page.locator('[data-testid="grand-total"]')).toHaveText('¥10,000')

    // 保存 → DB（生成列 amount 含む）
    await page.locator('[data-testid="save-items"]').click()
    await expect.poll(async () => {
      const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ)}&select=id`)
      const pid = projs?.[0]?.id
      if (!pid) return null
      const items = await restSrv(`estimate_items?project_id=eq.${pid}&select=amount`)
      if (!items || items.length !== 3) return `count=${items?.length}`
      return items.reduce((s: number, r: any) => s + Number(r.amount), 0)
    }, { timeout: 10000 }).toBe(10000)
  })
})
