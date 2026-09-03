// ============================================================
//  admin.trial-notice.spec.ts
//  無償試用期間の満了を「20日前までに」告知し、確認した履歴を残す
//  （契約書第22条の3第2項・2026-09-01弁護士打合せ）:
//   - 満了20日前ウィンドウに入り、月額が設定されていれば、オーナー/管理者ログイン時に
//     ブロッキングのポップアップが出る（チェックしないと閉じられない）
//   - 確認すると trial_notice_acks に記録され、再読込しても再表示されない
//   - 月額(monthly_fee_yen)が未設定なら、ウィンドウに入っていてもポップアップは出ない
//     （誤った金額を出さないフェイルセーフ）
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, authAdmin } from './helpers'

const TS = Date.now()

async function makeTrialTenant(opts: { feeYen: number | null; daysLeft: number }) {
  const slug = `e2e-trial-${TS}-${Math.random().toString(36).slice(2, 8)}-${opts.feeYen === null ? 'nofee' : 'ok'}`
  const email = `${slug}@email.com`
  const password = 'e2e-trial-pass-1234'

  const trialEndsAt = new Date(Date.now() + opts.daysLeft * 86400000).toISOString().slice(0, 10)
  const [acct] = await restSrv('accounts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: `E2E無償満了テナント_${TS}`, slug,
      billing_status: 'trial',
      contract_started_at: new Date().toISOString().slice(0, 10),
      trial_ends_at: trialEndsAt,
      ...(opts.feeYen != null ? { monthly_fee_yen: opts.feeYen } : {}),
    }),
  })

  const res = await authAdmin('admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { account_slug: slug } }),
  })
  if (!res.ok) throw new Error(`auth user作成失敗: ${res.status} ${await res.text()}`)
  const { id: authUserId } = await res.json()

  await restSrv(`accounts?id=eq.${acct.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ owner_auth_user_id: authUserId }),
  })

  return { slug, email, password, accountId: acct.id, authUserId, trialEndsAt }
}

async function cleanup(t: { slug: string; authUserId: string; accountId: string }) {
  await restSrv(`trial_notice_acks?account_id=eq.${t.accountId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`accounts?id=eq.${t.accountId}`, { method: 'PATCH', body: JSON.stringify({ owner_auth_user_id: null }) }).catch(() => {})
  await restSrv(`accounts?id=eq.${t.accountId}`, { method: 'DELETE' }).catch(() => {})
  await authAdmin(`admin/users/${t.authUserId}`, { method: 'DELETE' }).catch(() => {})
}

test('★満了20日前・月額設定済みなら、ログイン時にブロッキングの告知ポップアップが出て確認できる', async ({ page }) => {
  const t = await makeTrialTenant({ feeYen: 60000, daysLeft: 15 })
  try {
    await page.goto(`/login?id=${encodeURIComponent(t.slug)}&pass=${encodeURIComponent(t.password)}`, { waitUntil: 'networkidle' })

    const gate = page.getByTestId('trial-notice-gate')
    await expect(gate).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('tn-fee')).toContainText('60,000')

    // チェックしないと確認ボタンが押せない
    const confirmBtn = page.getByTestId('tn-confirm')
    await expect(confirmBtn).toBeDisabled()
    await page.getByTestId('tn-checkbox').check()
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()
    await expect(gate).toBeHidden({ timeout: 8000 })

    // DBに確認履歴が残る
    const [ack] = await restSrv(`trial_notice_acks?account_id=eq.${t.accountId}&select=monthly_fee_yen,shown_content`)
    expect(ack).toBeTruthy()
    expect(ack.monthly_fee_yen).toBe(60000)
    expect(ack.shown_content.trialEndsAt).toBe(t.trialEndsAt)

    // 再読込しても、確認済みなので再表示されない
    await page.reload({ waitUntil: 'networkidle' })
    await expect(gate).toHaveCount(0)
  } finally {
    await cleanup(t)
  }
})

test('月額が未設定なら、満了20日前ウィンドウでもポップアップは出さない（誤った金額を出さないフェイルセーフ）', async ({ page }) => {
  const t = await makeTrialTenant({ feeYen: null, daysLeft: 15 })
  try {
    await page.goto(`/login?id=${encodeURIComponent(t.slug)}&pass=${encodeURIComponent(t.password)}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('trial-notice-gate')).toHaveCount(0)
  } finally {
    await cleanup(t)
  }
})

test('満了まで21日以上あるうちは、ウィンドウ外なのでポップアップは出さない', async ({ page }) => {
  const t = await makeTrialTenant({ feeYen: 50000, daysLeft: 30 })
  try {
    await page.goto(`/login?id=${encodeURIComponent(t.slug)}&pass=${encodeURIComponent(t.password)}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('trial-notice-gate')).toHaveCount(0)
  } finally {
    await cleanup(t)
  }
})
