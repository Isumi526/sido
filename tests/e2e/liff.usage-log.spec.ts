// ============================================================
//  liff.usage-log.spec.ts
//  効果測定の計測を主要機能全体へ広げる（2026-09-20）— LIFF 側の計測経路。
//   AC2 LINE 作業員（Supabase JWT 無し）は EF `usage-log` 経由で計測される
//       ＝ authenticated 前提の INSERT ポリシーに依存しない。身元はサーバ側で解決
//   AC4 追記専用（anon は触れない・登録簿に無いキーは 400・身元不明は 401）
//   ＋ 画面から実際に1件ログが飛ぶ（日報履歴の閲覧）
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, ensureDevWorker, useDevWorker } from './helpers'

const KEY_UID = 'usage-log'
let accountId = ''
let workerId = ''
let lineUserId = ''

async function callUsageLog(body: Record<string, unknown>, auth = ANON_KEY) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/usage-log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${auth}` },
    body: JSON.stringify({ action: 'log', ...body }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
async function countFor(key: string): Promise<number> {
  const rows = await restSrv(`feature_usage_events?account_id=eq.${accountId}&worker_id=eq.${workerId}&feature_key=eq.${key}&select=id`)
  return rows?.length ?? 0
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await ensureDevWorker(KEY_UID)
  workerId = w.workerId; lineUserId = w.lineUserId
})
test.afterAll(async () => {
  await restSrv(`feature_usage_events?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
})

test('AC2★: LINE作業員の身元（ローカルは dev_line_user_id）で EF がテナント/作業員を解決して記録する', async () => {
  const before = await countFor('punch_recorded')
  const r = await callUsageLog({ key: 'punch_recorded', dev_line_user_id: lineUserId })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect(await countFor('punch_recorded'), '★account_id/worker_id はサーバ側で解決される（クライアントは名乗っていない）').toBe(before + 1)
})

test('AC4★: 身元不明は 401・登録簿に無いキーは 400・anon はテーブルに直接書けない', async () => {
  const noId = await callUsageLog({ key: 'punch_recorded' })
  expect(noId.status, '身元が解決できなければ書かない').toBe(401)
  const badKey = await callUsageLog({ key: 'not_a_feature', dev_line_user_id: lineUserId })
  expect(badKey.status, '登録簿に無いキーは弾く').toBe(400)
  // anon キーでの直接 INSERT は権限剥奪済み
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feature_usage_events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ account_id: accountId, feature_key: 'punch_recorded' }),
  })
  expect([401, 403], 'anon は直接書けない').toContain(res.status)
})

test('★画面から計測が飛ぶ: 日報履歴を開くと report_history_viewed が1件増える', async ({ page }) => {
  const before = await countFor('report_history_viewed')
  await useDevWorker(page, KEY_UID)
  await page.goto('/history', { waitUntil: 'networkidle' })
  await expect.poll(() => countFor('report_history_viewed'), { timeout: 15000 }).toBe(before + 1)
})
