// ============================================================
//  admin.non-submitters.spec.ts
//  未送信者リスト（admin）
//   AC1: ページが開き、未送信者が一覧表示される
//   AC2: 朝リマインドと同じ整形のプレビュー本文が出る
//   AC3: 「LINE用にコピー」でクリップボードに本文がコピーされる
//  対象: 紐付けユーザーの無い active worker が全期間未送信に出る
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const WORKER = `E2E未送信_${Date.now()}`
const WORKER_NEW = `E2E新規W_${Date.now()}`   // 本日登録＝登録前の未送信を出さない検証用

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // created_at を過去日に固定＝service_start_date より前から在籍する worker（登録日起点で全期間出る）
  await rest('workers', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true, created_at: '2024-01-01T00:00:00Z' }),
  })
  // created_at=now＝本日登録の未紐付け worker。登録日起点なので過去（service_start_date〜昨日）の未送信は出ない。
  await rest('workers', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, name: WORKER_NEW, role: 'site', active: true, created_at: new Date().toISOString() }),
  })
})

test.afterAll(async () => {
  await rest(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  await rest(`workers?name=eq.${encodeURIComponent(WORKER_NEW)}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1/AC2: 一覧に未送信者が出て、リマインドと同じ整形プレビューが表示される', async ({ page }) => {
  await page.goto('/non-submitters', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('未送信者リスト')

  // 紐付けユーザーの無い active worker が未送信者として出る（「LINE未紐付け」ラベルは廃止）
  const row = page.locator('tr', { hasText: WORKER })
  await expect(row).toBeVisible()
  // 登録日起点: 本日登録した worker は登録前（service_start_date〜昨日）の未送信に出ない
  await expect(page.locator('tr', { hasText: WORKER_NEW })).toHaveCount(0)

  // プレビュー本文が朝リマインドと同じヘッダ＋対象者を含む
  // 15222cb(UI絵文字全廃)で見出しの📋は【】表記に変更済み
  const preview = page.locator('.preview-body')
  await expect(preview).toContainText('【日報未送信リマインド】（敬称略）')
  // 「いつ時点か」を時刻まで含める（時点（M/D HH:MM 現在））／転送文言は削除済み
  await expect(preview).toContainText(/時点（\d{1,2}\/\d{1,2} \d{2}:\d{2} 現在）/)
  await expect(preview).not.toContainText('※このメッセージをグループに転送してください')
  await expect(preview).toContainText(WORKER)
})

test('AC3: 「LINE用にコピー」でクリップボードに本文がコピーされる', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/non-submitters', { waitUntil: 'networkidle' })

  await expect(page.locator('tr', { hasText: WORKER })).toBeVisible()
  const previewText = (await page.locator('.preview-body').innerText()).trim()

  await page.locator('.btn-copy').click()
  await expect(page.locator('.btn-copy')).toContainText('コピーしました')

  const clip = (await page.evaluate(() => navigator.clipboard.readText())).trim()
  expect(clip).toContain('【日報未送信リマインド】（敬称略）')
  expect(clip).toContain(WORKER)
  expect(clip).toBe(previewText)
})
