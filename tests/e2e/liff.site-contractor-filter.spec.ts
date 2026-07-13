// ============================================================
//  liff.site-contractor-filter.spec.ts （dev モード）
//  日報で元請けを選ぶと、その元請けに紐づく現場だけに現場プルダウンが絞り込まれる。
//   - AC2: 元請け選択→紐づく現場のみ
//   - AC3: 紐づく現場が無い/元請け未選択は全現場（後方互換）
//  紐付き現場と未紐付き現場を1つずつシードして検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'
import { FEAT_C_DATE } from './global-setup'

const TS = Date.now()
const CON   = `E2E元請_${TS}`
const LINKED = `E2E紐付現場_${TS}`
const FREE   = `E2E無紐付現場_${TS}`

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const c = await rest('contractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: CON, active: true, sort_order: 0 }),
  })
  const contractorId = c[0].id
  await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: LINKED, active: true, contractor_id: contractorId }),
  })
  await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: FREE, active: true, contractor_id: null }),
  })
})

test.afterAll(async () => {
  await rest(`sites?name=like.E2E*${TS}`, { method: 'DELETE' }).catch(() => {})
  await rest(`contractors?name=eq.${encodeURIComponent(CON)}`, { method: 'DELETE' }).catch(() => {})
})

test('日報: 元請け選択で紐づく現場のみに絞り込まれる', async ({ page }) => {
  // 新規(/report)は「次の未送信日」に依存し、1回のフルランで複数specが新規送信するため
  // 枯渇すると「送信済みです」になりフォームが出ない。この spec は送信しない（絞り込みチェックのみ）ので、
  // global-setupが必ず用意する既存日報(FEAT_C・テスト現場A)を編集モードで開き、枯渇の影響を受けないようにする。
  // 古いマスタキャッシュを消してからフォームを開く（force fetch される）
  try { await page.goto(`/report?edit=${FEAT_C_DATE}`, { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  await page.evaluate(() => localStorage.removeItem('app_master_cache'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 現場セレクト（__other__「新しい現場」optionを持つのが現場select＝安定特定・絞り込み後も不変）
  const siteSelect = page.locator('select.select[required]').filter({ has: page.locator('option[value="__other__"]') }).first()
  await expect(siteSelect).toBeVisible()
  await expect(siteSelect.locator('option', { hasText: LINKED })).toHaveCount(1)
  await expect(siteSelect.locator('option', { hasText: FREE })).toHaveCount(1)

  // 元請けを選択 → 現場が「紐づく現場」「その他の現場」の2 optgroup に階層化される
  // （d65e1a0・2026-07-09。旧: 未紐付け現場は非表示 → 新: 下部の「その他」optgroupに残す方針に変更）
  const conSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: CON }) }).first()
  await conSelect.selectOption({ label: CON })

  const linkedGroup = siteSelect.locator('optgroup[label="この元請けに紐づく現場"]')
  const otherGroup  = siteSelect.locator('optgroup[label="その他の現場"]')
  await expect(linkedGroup.locator('option', { hasText: LINKED })).toHaveCount(1)   // 紐づく現場は「紐づく現場」グループに残る
  await expect(linkedGroup.locator('option', { hasText: FREE })).toHaveCount(0)     // 未紐付け現場は「紐づく現場」グループには出ない
  await expect(otherGroup.locator('option', { hasText: FREE })).toHaveCount(1)      // 未紐付け現場は「その他」グループへ降格して残る
})
