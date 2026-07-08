// ============================================================
//  admin.site-reports-merge-fallback.spec.ts
//  再現spec（本番症状: Notion 3950ff81-…-80c1 / 根本修正: 81fe・commit 928f0a0）
//  マージ孤児＝ site_id 無し・表記ゆれ旧名（inactive現場名）の日報が、
//  現場別集計の読み時フォールバック（resolveSiteRef: 正規化名一致で active 現場へ解決）で
//  active 現場に統合集計されること。
//  本番実例: 「ルルレモン原宿」(inactive・旧名のまま16件) が
//  「ルルレモン　原宿」(active・全角スペース有) に統合されず別バケットだった。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const DST = `E2Eゆれ　原宿${TS}`   // active・全角スペース有（統合先）
const SRC = `E2Eゆれ原宿${TS}`     // inactive・スペース無（マージ済み相当の旧名）
const NOTE = `E2Eゆれ_${TS}`

let accountId = '', devUserId = ''
const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
const D1 = `${ym}-10`, D2 = `${ym}-11`

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  // 統合先=active / 統合元=inactive（過去にマージ済みで旧名日報だけが残った状態を再現）
  await rest('sites', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: DST, active: true }) })
  await rest('sites', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: SRC, active: false }) })
  // どちらも site_id 無し（バックフィル前の旧データ相当）
  const mkReport = (date: string, siteName: string) => rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date, is_working: true, note: NOTE,
      sites: [{ siteName, workers: [], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
    }),
  })
  await mkReport(D1, DST)
  await mkReport(D2, SRC)   // ← 旧名参照（本番の孤児16件と同じ形）
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(NOTE)}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?name=like.E2Eゆれ*${TS}`, { method: 'DELETE' }).catch(() => {})
})

test('表記ゆれ・マージ孤児の旧名日報（site_id無し）が読み時に active 現場へ統合集計される', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')

  // 統合先タブが存在する
  const dstTab = page.locator('.tab', { hasText: DST })
  await expect(dstTab).toBeVisible({ timeout: 10000 })

  // 核心: 旧名(SRC)が独立バケットにならない＝E2Eゆれ系タブは統合先の1つだけ
  await expect(page.locator('.tab', { hasText: `E2Eゆれ` }).filter({ hasText: `${TS}` })).toHaveCount(1)

  // 統合先タブに両日付の日報が合算されている（統合失敗なら1行しか出ない）
  await dstTab.click()
  await expect(page.locator('.table tbody tr')).toHaveCount(2, { timeout: 10000 })
})
