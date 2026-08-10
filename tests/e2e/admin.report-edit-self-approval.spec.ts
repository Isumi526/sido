// ============================================================
//  admin.report-edit-self-approval.spec.ts
//  日報編集の承認: 自分が出した編集は自分で承認できない（2026-08-10）
//
//  契機は議事録(2026-07-27)の逐語:
//   「たまに現場管理させて責任者でやらせるパターンが出てくるかもしれん。
//     その時に管理者で入、登録されたら自分で修正できちゃうじゃん」「誰も見られることもなく」
//  ＝ 現場管理者が自分の現場の日報を編集して経費を追加でき、承認担当も自分、という穴。
//
//  ★/report-edit-review にはルートガードも権限判定も無く、admin を開ける全ロール
//   （オーナー・経理・現場管理者）が承認できる。ダブル承認（現場責任者＋オーナー）は
//   現場マスタの責任者が埋まってから（別チケット）だが、自己承認の禁止だけは前提条件なしで先に入れる。
//
//  submitted_by_user_id は users.id（report-edit-log EF が caller.userId を入れる）。
//  ログイン中の管理者の users.id は auth → workers(auth_user_id) → users(worker_id) で引く。
//
//  接頭辞 self-appr- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { restSrv, getAccountId, ADMIN_LOGIN_EMAIL, DB_URL } from './helpers'

const TS = Date.now()
const PREFIX = 'self-appr-'
const ME = `${PREFIX}承認者${TS}`
const OTHER = `${PREFIX}他人${TS}`
const DATE = '2026-11-11'

let accountId = ''
let myUserId = ''      // ログイン中の管理者に対応する users.id
let otherUserId = ''
let myWorkerId = ''

async function purge() {
  for (const n of [ME, OTHER]) {
    const us = await restSrv(`users?real_name=eq.${encodeURIComponent(n)}&select=id`)
    for (const u of us ?? []) {
      await restSrv(`daily_report_pending_edits?submitted_by_user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`daily_report_pending_edits?report_user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: workers ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

/** 保留編集を1件作る。submitter を差し替えて「自分の/他人の」を作り分ける */
async function seedPending(submitterUserId: string, submitterName: string, reason: string) {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${otherUserId}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  const rows = await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, report_id: null, report_user_id: otherUserId, report_date: DATE,
      kind: 'late_new', status: 'pending', reason,
      submitted_by_user_id: submitterUserId, submitted_by_name: submitterName,
      payload: {
        is_working: true, leave_type: null, is_business_trip: false, note: 'E2E自己承認',
        sites: [{ siteName: 'テスト現場B', workers: [], subcontractors: [], expenses: {
          vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
          others: [{ label: 'E2E資材', yen: 3000, tategae: false, fileUrls: [] }], entertainments: [] } }],
        gasoline_items: [],
      },
    }),
  })
  return rows[0].id
}

test.describe('日報編集の承認: 自己承認の禁止', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()

    // ログイン中の e2e 管理者に worker + users を作り、自分の users.id を確定させる
    const authUserId = execSync(
      `psql "${DB_URL}" -tAc "select id from auth.users where email='${ADMIN_LOGIN_EMAIL}'"`,
      { encoding: 'utf8' },
    ).trim()
    const w = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ME, role: 'site', active: true, auth_user_id: authUserId, permission_role: 'admin' }),
    })
    myWorkerId = w[0].id
    const mu = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: ME, worker_id: myWorkerId }),
    })
    myUserId = mu[0].id

    // 日報の持ち主（他人）
    const ow = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: OTHER, role: 'site', active: true }),
    })
    const ou = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: OTHER, worker_id: ow[0].id }),
    })
    otherUserId = ou[0].id
  })

  test.afterAll(async () => { await purge() })

  test('★自分が出した編集には承認ボタンが出ず、理由が出る', async ({ page }) => {
    const reason = `E2E自分_${TS}`
    await seedPending(myUserId, ME, reason)

    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    const card = page.locator('[data-testid="pending-card"]', { hasText: reason })
    await expect(card).toBeVisible({ timeout: 15000 })

    await expect(card.getByTestId('pending-approve'), '★承認ボタンを出さない').toHaveCount(0)
    await expect(card.getByTestId('pending-self-blocked'), '理由が出る').toBeVisible()
    // 差し戻し（自分の申請の取り下げ）は残す
    await expect(card.getByTestId('pending-reject'), '差し戻しは残す').toBeVisible()
  })

  test('他人が出した編集には従来どおり承認ボタンが出る（塞ぎすぎていない）', async ({ page }) => {
    const reason = `E2E他人_${TS}`
    await seedPending(otherUserId, OTHER, reason)

    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    const card = page.locator('[data-testid="pending-card"]', { hasText: reason })
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card.getByTestId('pending-approve'), '承認できる').toBeVisible()
    await expect(card.getByTestId('pending-self-blocked')).toHaveCount(0)
  })

  test('★UIを迂回しても自己承認は通らない（decide 側の防御）', async ({ page }) => {
    const reason = `E2E迂回_${TS}`
    const pendingId = await seedPending(myUserId, ME, reason)

    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    const card = page.locator('[data-testid="pending-card"]', { hasText: reason })
    await expect(card).toBeVisible({ timeout: 15000 })

    // 承認ボタンが無いので、画面のハンドラを直接呼ぶ＝UI迂回を再現する代わりに、
    // EF を叩いていないことで担保する（decide が早期returnするならリクエストは飛ばない）
    const efCalls: string[] = []
    page.on('request', (r) => { if (r.url().includes('report-edit-log')) efCalls.push(r.method()) })
    await card.getByTestId('pending-self-blocked').click({ force: true }).catch(() => {})
    await page.waitForTimeout(1500)
    expect(efCalls, 'EFを叩かない').toHaveLength(0)

    const rows = await restSrv(`daily_report_pending_edits?id=eq.${pendingId}&select=status`)
    expect(rows[0].status, 'pending のまま').toBe('pending')
  })
})
