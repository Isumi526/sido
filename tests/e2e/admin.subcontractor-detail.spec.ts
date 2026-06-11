// ============================================================
//  admin.subcontractor-detail.spec.ts
//  下請け業者 詳細管理（admin Phase 1）
//   AC1: 詳細(代表者名/対応エリア/工種)を登録→一覧に反映
//   AC2: 工種で絞り込み（該当のみ表示）
//   AC3: 論理削除→一覧から消える→削除済み表示で復元
//  design: docs/design/subcontractor-detail-search.md
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

const NAME = `E2E下請_${Date.now()}`
const REP  = '山田E2E'
const AREA = '東京都E2E'
const TRADE_HAVE   = 'ボード工事'   // 付与する工種（プリセット）
const TRADE_OTHER  = '塗装工事'     // 付与しない工種（絞り込みで非表示確認用）

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  // edit_logs/trade_types/comments を先に消してから本体を削除（FK制約のため）
  try {
    const rows = await rest(`subcontractors?name=eq.${encodeURIComponent(NAME)}&select=id`)
    for (const r of rows ?? []) {
      await rest(`subcontractor_edit_logs?subcontractor_id=eq.${r.id}`,  { method: 'DELETE' }).catch(() => {})
      await rest(`subcontractor_trade_types?subcontractor_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await rest(`subcontractor_comments?subcontractor_id=eq.${r.id}`,    { method: 'DELETE' }).catch(() => {})
    }
  } catch { /* ignore */ }
  await rest(`subcontractors?name=eq.${encodeURIComponent(NAME)}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1: 詳細を登録 → 一覧に工種・対応エリアが反映される', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('下請け業者マスタ')

  await page.locator('.btn-add').click()
  const modal = page.locator('.modal.wide')
  await expect(modal).toBeVisible()
  await modal.getByPlaceholder('例：○○工務店').fill(NAME)
  await modal.locator('select').first().selectOption('業者')
  await modal.getByPlaceholder('例：山田太郎').fill(REP)
  // 対応エリア（タグ）
  await modal.getByPlaceholder('エリアを入力しEnter').fill(AREA)
  await modal.getByPlaceholder('エリアを入力しEnter').press('Enter')
  // 工種（プリセットをトグル）
  await modal.locator('.preset-btn', { hasText: TRADE_HAVE }).click()
  await modal.locator('.btn-save').click()

  const row = page.locator('tr', { hasText: NAME })
  await expect(row).toBeVisible()
  await expect(row).toContainText(TRADE_HAVE)
  await expect(row).toContainText(AREA)
})

test('AC2: 工種で絞り込むと該当業者だけ表示される', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: NAME })
  await expect(row).toBeVisible()

  // 付与した工種で絞り込み → 表示される
  await page.locator('.filter-input').nth(1).selectOption(TRADE_HAVE)
  await expect(row).toBeVisible()

  // 付与していない工種で絞り込み → 消える
  await page.locator('.filter-input').nth(1).selectOption(TRADE_OTHER)
  await expect(row).toHaveCount(0)
})

test('AC3: 論理削除 → 一覧から消え、削除済み表示で復元できる', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: NAME })
  await expect(row).toBeVisible()

  // 削除 → 既定一覧から消える
  await row.getByRole('button', { name: '削除' }).click()
  await expect(page.locator('tr', { hasText: NAME })).toHaveCount(0)

  // 削除済みを表示 → 復活（削除済みバッジ付き）
  await page.locator('.toggle input[type="checkbox"]').check()
  const delRow = page.locator('tr', { hasText: NAME })
  await expect(delRow).toBeVisible()
  await expect(delRow).toContainText('削除済み')

  // 復元 → バッジが消える
  await delRow.getByRole('button', { name: '復元' }).click()
  await expect(page.locator('tr', { hasText: NAME })).not.toContainText('削除済み')
})
