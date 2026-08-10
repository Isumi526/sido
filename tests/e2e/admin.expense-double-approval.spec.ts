// ============================================================
//  admin.expense-double-approval.spec.ts
//  経費精算のダブル承認（緊急・議事録2026-07-27）
//
//  ★問題意識（議事録）: 「管理者で登録されたら自分で修正できちゃう／誰も見られることもなく」
//   ＝**自己承認できてしまう**こと。段を分けるだけでは足りず、
//   「申請者本人は承認できない」「一次を飛ばして支払い確定できない」の両方を塞いで初めて目的を果たす。
//
//  フロー: 申請中 →(一次承認: 役員・経理以上)→ 一次承認済み →(最終承認: オーナー)→ 支払い済み
//
//  ★ここで固定するのは「段が飛ばせないこと」＝DB更新の条件。
//   ロールごとの見え方はE2Eのログイン主体を替えられないため人力チェックに回す。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E二段承認_${TS}`
const PERIOD = '2026-05-first'

let accountId = ''
let workerId = ''
let userId = ''

async function settlement(): Promise<any> {
  const rows = await restSrv(`expense_settlements?user_id=eq.${userId}&period_key=eq.${PERIOD}&select=*`)
  return rows?.[0] ?? null
}

async function setStatus(status: string) {
  await restSrv(`expense_settlements?user_id=eq.${userId}&period_key=eq.${PERIOD}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status, first_approved_at: null, first_approved_by: null, first_approved_name: null,
      final_approved_by: null, final_approved_name: null, paid_on: null, payment_method: null,
    }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
  })
  workerId = w[0].id
  const u = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: workerId }),
  })
  userId = u[0].id
  await restSrv('expense_settlements', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, period_key: PERIOD,
      status: '申請中', applied_at: new Date().toISOString(),
    }),
  })
  // 精算行だけだと画面に出ないので、個人経費を1件付ける
  await restSrv('personal_expenses', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: '2026-05-10',
      account_category: '消耗品費', amount: 5000, payee: 'E2E店', tategae: true,
    }),
  })
})

test.afterAll(async () => {
  await restSrv(`personal_expenses?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`expense_settlements?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
})

/** 対象の精算行を開く */
async function open(page: import('@playwright/test').Page) {
  await page.goto('/expenses?ym=2026-05', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: WORKER }).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.click()
  // 状態によって出るボタンが違う（申請中/一次承認済み=差し戻し・支払い済み=申請中に戻す）
  await expect(page.locator('.settle-row').first()).toBeVisible({ timeout: 15000 })
}

test('AC★: 申請中では「一次承認」だけが出る（いきなり支払い確定はできない）', async ({ page }) => {
  await setStatus('申請中')
  await open(page)

  await expect(page.getByTestId('exp-first-approve'), '一次承認は出る').toBeVisible()
  // ★段を飛ばす導線が無いこと。あると二段にした意味がない
  await expect(page.getByTestId('exp-final-approve'), '支払い確定は出ない').toHaveCount(0)
})

test('AC★: 一次承認すると「一次承認済み」になり、承認者が記録される', async ({ page }) => {
  await setStatus('申請中')
  await open(page)

  await page.getByTestId('exp-first-approve').click()
  await expect.poll(async () => (await settlement())?.status, { timeout: 15000 }).toBe('一次承認済み')

  const s = await settlement()
  expect(s.first_approved_at, '承認日時が入る').toBeTruthy()
  // ★誰が通したか残らないと監査にならない（退職しても残るよう氏名も保存する）
  expect(s.first_approved_name, '承認者名が残る').toBeTruthy()
})

test('AC★: 一次承認済みで初めて「支払い済みにする」が出る', async ({ page }) => {
  await setStatus('申請中')
  await open(page)
  await page.getByTestId('exp-first-approve').click()
  await expect.poll(async () => (await settlement())?.status, { timeout: 15000 }).toBe('一次承認済み')

  await open(page)
  await expect(page.getByTestId('exp-first-approver'), '一次承認者が見える').toBeVisible()
  await expect(page.getByTestId('exp-final-approve'), '最終承認が出る').toBeVisible()
})

test('★一次承認を飛ばした支払い確定はDB側で弾かれる（UIを迂回されても段は飛ばせない）', async () => {
  await setStatus('申請中')
  // 画面を通さず「申請中」のまま支払い済みにしようとする＝アプリのUPDATE条件を再現
  await restSrv(`expense_settlements?user_id=eq.${userId}&period_key=eq.${PERIOD}&status=eq.一次承認済み`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: '支払い済み' }),
  }).catch(() => {})

  // 申請中のままなので1件も更新されない
  expect((await settlement())?.status, '段を飛ばせない').toBe('申請中')
})

// ★2026-08-10 レビューで発見: 差し戻しは status だけ変えて一次承認の記録を消しておらず、
//  作業員が LIFF で再申請（applySettlement は status を '申請中' に戻すが first_approved_* に触らない）
//  すると「申請中なのに一次承認済みの記録がある」状態が残った。
//  「支払い済み→申請中に戻す」経路では消していたのに、差し戻し経路だけ素通りしていた。
test('★差し戻すと一次承認の記録も消える（再申請で「申請中なのに承認済み」を作らない）', async ({ page }) => {
  await setStatus('申請中')
  await open(page)
  await page.getByTestId('exp-first-approve').click()
  await expect.poll(async () => (await settlement())?.status, { timeout: 15000 }).toBe('一次承認済み')
  expect((await settlement())?.first_approved_at, '前提: 承認記録が入っている').not.toBeNull()

  // 差し戻す（理由必須）
  await open(page)
  await page.getByTestId('exp-reject').click()
  await page.locator('.reject-textarea').fill('E2E: 領収書の添付漏れ')
  await page.locator('.btn-reject-confirm').click()
  await expect.poll(async () => (await settlement())?.status, { timeout: 15000 }).toBe('差し戻し')

  const s = await settlement()
  expect(s.first_approved_at, '★一次承認の記録が消える').toBeNull()
  expect(s.first_approved_by, '★承認者も消える').toBeNull()
  expect(s.first_approved_name, '★承認者名も消える').toBeNull()

  // 作業員の再申請を再現（LIFF applySettlement 相当）→ 申請中に戻っても承認記録は無いまま
  await restSrv(`expense_settlements?user_id=eq.${userId}&period_key=eq.${PERIOD}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: '申請中', reject_reason: null, rejected_at: null }),
  })
  const re = await settlement()
  expect(re.status).toBe('申請中')
  expect(re.first_approved_at, '★再申請後も「申請中なのに承認済み」にならない').toBeNull()
})

test('★申請中に戻すと一次承認の記録も消える（承認済みなのに申請中を作らない）', async ({ page }) => {
  await setStatus('申請中')
  await open(page)
  await page.getByTestId('exp-first-approve').click()
  await expect.poll(async () => (await settlement())?.status, { timeout: 15000 }).toBe('一次承認済み')

  // 支払い済みまで進めてから戻す
  await restSrv(`expense_settlements?user_id=eq.${userId}&period_key=eq.${PERIOD}&status=eq.一次承認済み`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: '支払い済み', paid_on: '2026-05-20', payment_method: '振込' }),
  })
  await open(page)
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await page.locator('.btn-status-link').first().click()
  const ok = page.locator('.btn-confirm-ok').first()
  if (await ok.count()) await ok.click()

  await expect.poll(async () => (await settlement())?.status, { timeout: 15000 }).toBe('申請中')
  const s = await settlement()
  expect(s.first_approved_at, '一次承認の記録も消える').toBeNull()
  expect(s.first_approved_name).toBeNull()
})
