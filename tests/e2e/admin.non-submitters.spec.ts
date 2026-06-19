// ============================================================
//  admin.non-submitters.spec.ts
//  未送信者リスト（admin）
//   AC1: ページが開き、未送信者が一覧表示される
//   AC2: 朝リマインドと同じ整形のプレビュー本文が出る
//   AC3: 「LINE用にコピー」でクリップボードに本文がコピーされる
//  対象: 紐付けユーザーの無い active worker は「LINE未紐付け」として全期間未送信に出る
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const WORKER = `E2E未送信_${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const accountId = await getAccountId()
  await rest('workers', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
  })
})

test.afterAll(async () => {
  await rest(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1/AC2: 一覧に未送信者が出て、リマインドと同じ整形プレビューが表示される', async ({ page }) => {
  await page.goto('/non-submitters', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('未送信者リスト')

  // 紐付けユーザーの無い active worker は「LINE未紐付け」で出る
  const row = page.locator('tr', { hasText: WORKER })
  await expect(row).toBeVisible()
  await expect(row).toContainText('LINE未紐付け')

  // プレビュー本文が朝リマインドと同じヘッダ＋対象者を含む
  const preview = page.locator('.preview-body')
  await expect(preview).toContainText('📋 日報未送信リマインド（敬称略）')
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
  expect(clip).toContain('📋 日報未送信リマインド（敬称略）')
  expect(clip).toContain(WORKER)
  expect(clip).toBe(previewText)
})
