// ============================================================
//  admin.broadcast-notice.spec.ts
//  一斉お知らせ（料金改定・サービス更新の案内をアプリ内お知らせで全員へ）#e97ff2e0
//
//  ★方向性（/ball 2026-08-27・運用者選択 A）:
//   ベル＋一覧（既読管理あり）。ログイン時のモーダル強制表示は不採用。
//   重要な案内は既存の一斉メールと併用。
//
//  ★ここで一番大事なのは「誰に届くか」。過去に全社共通グループへ送る実装で
//   クロステナント漏洩を起こしているので、宛先は必ず呼び出し元のアカウントから
//   導出する（クライアントが account_id を名乗れない）ことを固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId } from './helpers'

const FN = `${SUPABASE_URL}/functions/v1/broadcast-notice`
const TITLE = `E2E一斉お知らせ_${Date.now()}`

let accountId = ''
let otherAccountId = ''
let otherWorkerId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 別テナントを1つ作り、そこに作業員を置く（漏れていないことを見るため）
  const acc = await restSrv('accounts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ slug: `e2e-other-${Date.now()}`, name: 'E2E別テナント' }),
  })
  otherAccountId = acc[0].id
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: otherAccountId, name: 'E2E別テナント作業員', active: true, role: 'site' }),
  })
  otherWorkerId = w[0].id
})

test.afterAll(async () => {
  await restSrv(`schedule_notifications?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${otherWorkerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`accounts?id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
})

test('★公開キーだけでは送れない（作業員が全員に通知を飛ばせない）', async () => {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action: 'send', title: TITLE }),
  })
  expect(res.status, '★匿名では403（管理者だけが送れる）').toBe(403)
})

test('管理者が送ると自テナントの作業員に届き、他テナントには届かない', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('broadcast-box')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('notice-title').fill(TITLE)
  await page.getByTestId('notice-body').fill('E2E: 料金改定のお知らせ本文')

  // 送信先の確認（誰に届くかを先に見せる）
  await page.getByTestId('notice-preview').click()
  await expect(page.getByTestId('notice-result')).toContainText(/名へ届きます|送信先の作業員がいません/, { timeout: 15000 })

  page.on('dialog', d => d.accept().catch(() => {}))
  await page.getByTestId('notice-send').click()
  await expect(page.getByTestId('notice-result')).toContainText(/名へ送りました/, { timeout: 20000 })

  const mine = await restSrv(`schedule_notifications?title=eq.${encodeURIComponent(TITLE)}&select=account_id,worker_id,kind,body`)
  expect(mine.length, '自テナントの作業員に届く').toBeGreaterThan(0)
  expect(mine[0].kind, 'お知らせとして積まれる').toBe('announcement')
  expect(mine[0].body, '本文も入る').toContain('料金改定')

  const leaked = (mine as any[]).filter(r => r.account_id !== accountId)
  expect(leaked.length, '★他テナントへ配信していない').toBe(0)
  const toOther = (mine as any[]).filter(r => r.worker_id === otherWorkerId)
  expect(toOther.length, '★別テナントの作業員には届かない').toBe(0)
})
