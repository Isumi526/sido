// ============================================================
//  liff.subcontractors.spec.ts （dev モード）
//  下請け業者 作業員UI（LIFF Phase 2）
//   AC1: 登録（詳細・工種・エリア）→ 一覧に反映
//   AC2: フリーワード / 工種 / エリアで絞り込み（AND）
//   AC3: 編集 → 反映
//   AC4: コメント投稿 → 表示・本人は編集/削除できる
//   AC5: 電話/メールがタップ連絡（tel:/mailto:）リンクになっている
//   AC6: 削除（論理削除）→ 一覧から消える
//  design: docs/design/subcontractor-detail-search.md
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

const NAME  = `E2E下請LIFF_${Date.now()}`
const NAME2 = `E2E別業者_${Date.now()}`
const REP   = '田中E2E'
const AREA  = '東京都E2E'
const PHONE = '090-1234-5678'
const MAIL  = 'e2e@example.com'
const TRADE_HAVE  = 'ボード工事'   // 付与する工種（プリセット）
const TRADE_OTHER = '塗装工事'     // 付与しない工種

test.describe.configure({ mode: 'serial' })

async function cleanup() {
  for (const nm of [NAME, NAME2]) {
    try {
      const rows = await rest(`subcontractors?name=eq.${encodeURIComponent(nm)}&select=id`)
      for (const r of rows ?? []) {
        await rest(`subcontractor_edit_logs?subcontractor_id=eq.${r.id}`,   { method: 'DELETE' }).catch(() => {})
        await rest(`subcontractor_trade_types?subcontractor_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
        await rest(`subcontractor_comments?subcontractor_id=eq.${r.id}`,    { method: 'DELETE' }).catch(() => {})
      }
    } catch { /* ignore */ }
    await rest(`subcontractors?name=eq.${encodeURIComponent(nm)}`, { method: 'DELETE' }).catch(() => {})
  }
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

test('AC1: 業者を登録 → 一覧に工種・対応エリアが反映される', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })

  // もう1件（絞り込みの非表示確認用）を先に登録
  await registerSub(page, NAME2, { trade: TRADE_OTHER })
  // 本命を登録
  await registerSub(page, NAME, { rep: REP, area: AREA, phone: PHONE, mail: MAIL, trade: TRADE_HAVE })

  const card = page.locator('.sub-card', { hasText: NAME })
  await expect(card).toBeVisible()
  await expect(card).toContainText(TRADE_HAVE)
  await expect(card).toContainText(AREA)
})

test('AC2: フリーワード / 工種 / エリアで絞り込める', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await expect(page.locator('.sub-card', { hasText: NAME })).toBeVisible()

  // フリーワード（代表者名でヒット）
  await page.locator('.search-input').fill(REP)
  await expect(page.locator('.sub-card', { hasText: NAME })).toBeVisible()
  await expect(page.locator('.sub-card', { hasText: NAME2 })).toHaveCount(0)
  await page.locator('.search-input').fill('')

  // 工種で絞り込み（付与した方 → 表示 / 付与していない方 → 非表示）
  await page.locator('.filter-select').selectOption(TRADE_HAVE)
  await expect(page.locator('.sub-card', { hasText: NAME })).toBeVisible()
  await expect(page.locator('.sub-card', { hasText: NAME2 })).toHaveCount(0)
  await page.locator('.filter-select').selectOption('')

  // エリアで絞り込み
  await page.locator('.filter-area').fill(AREA)
  await expect(page.locator('.sub-card', { hasText: NAME })).toBeVisible()
  await expect(page.locator('.sub-card', { hasText: NAME2 })).toHaveCount(0)
})

test('AC5: 詳細で電話/メールがタップ連絡リンクになっている', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await page.locator('.sub-card', { hasText: NAME }).click()
  const sheet = page.locator('.sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator(`a[href="tel:${PHONE}"]`)).toBeVisible()
  await expect(sheet.locator(`a[href="mailto:${MAIL}"]`)).toBeVisible()
})

test('AC4: コメントを投稿でき、本人は編集・削除できる', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await page.locator('.sub-card', { hasText: NAME }).click()
  const sheet = page.locator('.sheet')
  await expect(sheet).toBeVisible()

  // 投稿
  await sheet.locator('.comment-input').fill('対応が早くて助かりました')
  await sheet.locator('.btn-comment').click()
  await expect(sheet.locator('.comment-body', { hasText: '対応が早くて助かりました' })).toBeVisible()

  // 編集（本人）
  await sheet.locator('.comment .comment-link', { hasText: '編集' }).first().click()
  await sheet.locator('.comment-edit').fill('対応が早くて助かりました（追記）')
  await sheet.locator('.btn-mini', { hasText: '保存' }).click()
  await expect(sheet.locator('.comment-body', { hasText: '（追記）' })).toBeVisible()

  // 削除（本人）
  page.on('dialog', (d) => d.accept())
  await sheet.locator('.comment .comment-link.danger', { hasText: '削除' }).first().click()
  await expect(sheet.locator('.comment-body', { hasText: '対応が早くて助かりました' })).toHaveCount(0)
})

test('AC3: 編集 → 反映される', async ({ page }) => {
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await page.locator('.sub-card', { hasText: NAME }).click()
  await page.locator('.sheet .btn-edit').click()

  // 代表者名を変更（編集シートは詳細シートの上に開く）
  const editSheet = page.locator('.sheet').last()
  await editSheet.getByPlaceholder('例：山田太郎').fill('佐藤E2E')
  await editSheet.locator('.btn-save').click()

  // 編集シートが閉じ、詳細シートがその場で更新後の代表者名を表示する
  await expect(page.locator('.sheet')).toHaveCount(1)
  await expect(page.locator('.sheet')).toContainText('佐藤E2E')
})

test('AC6: 削除（論理削除）→ 一覧から消える', async ({ page }) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/subcontractors', { waitUntil: 'networkidle' })
  await page.locator('.sub-card', { hasText: NAME }).click()
  await page.locator('.sheet .btn-delete').click()
  await expect(page.locator('.sub-card', { hasText: NAME })).toHaveCount(0)
})

// ── ヘルパー：登録シートで1件作る ──
async function registerSub(
  page: import('@playwright/test').Page,
  name: string,
  opts: { rep?: string; area?: string; phone?: string; mail?: string; trade?: string } = {},
) {
  await page.locator('.btn-register').click()
  const sheet = page.locator('.sheet')
  await expect(sheet).toBeVisible()
  await sheet.getByPlaceholder('例：○○工務店').fill(name)
  if (opts.rep)   await sheet.getByPlaceholder('例：山田太郎').fill(opts.rep)
  if (opts.phone) await sheet.getByPlaceholder('090-...').fill(opts.phone)
  if (opts.mail)  await sheet.getByPlaceholder('info@example.com').fill(opts.mail)
  if (opts.area) {
    await sheet.getByPlaceholder('エリアを入力').fill(opts.area)
    await sheet.getByPlaceholder('エリアを入力').press('Enter')
  }
  if (opts.trade) await sheet.locator('.preset-btn', { hasText: opts.trade }).click()
  await sheet.locator('.btn-save').click()
  await expect(sheet).toBeHidden()
}
