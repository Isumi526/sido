// ============================================================
//  admin.distance-approvals.spec.ts
//  距離Step2（2026-09-20）: 距離の超過申請の承認。
//   AC5 承認すると距離欄が申請値に差し替わり（＝集計に反映）、却下なら既定値のまま
//   AC6 自己承認できない・二重決裁にならない（EF 直叩きで確かめる＝画面のガードは迂回できる）
//   AC7 承認待ちの件数がナビのバッジに出る
//  申請は LIFF が日報 JSON に埋める（liff.distance-overage.spec.ts）。ここでは seed で直接埋める。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, DB_URL, ACCOUNT_SLUG, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } from './helpers'

const TS = Date.now()
const DATE = '2026-10-26'
const DEFAULT_KM = 40
const SM_EMAIL = `e2e-dist-sm-${TS}@email.com`
const SM_PASS = 'e2e-pass-1234'

let accountId = ''
let workerId = ''      // 申請者（作業員）
let userId = ''        // 申請者の users.id
let smWorkerId = ''    // 承認者（site_manager・自分の申請も持つ）
let smUserId = ''
let smToken = ''

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await res.json()).access_token ?? ''
}

function overageSites(siteName: string) {
  return [{
    siteName, workers: [], subcontractors: [],
    expenses: {
      vehicles: [{
        vehicleName: 'ハイエース', distanceKm: DEFAULT_KM,
        overages: { distanceKm: { requestedKm: 65, defaultKm: DEFAULT_KM, reason: `E2E理由_${TS}`, status: 'pending', requestedAt: new Date().toISOString() } },
      }],
      parkings: [], highways: [], trains: [], hotels: [], entertainments: [], others: [],
    },
  }]
}

async function seedReport(uid: string, date: string, siteName: string): Promise<string> {
  await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
  const rows = await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, user_id: uid, date, is_working: true, note: 'E2E距離承認', sites: overageSites(siteName) }),
  })
  return rows[0].id
}

async function vehicleOf(reportId: string) {
  const r = await restSrv(`daily_reports?id=eq.${reportId}&select=sites`)
  return r?.[0]?.sites?.[0]?.expenses?.vehicles?.[0] ?? null
}

async function decideViaEf(token: string, reportId: string, status: 'approved' | 'rejected') {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/report-distance`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'decide', reportId, siteIndex: 0, vehicleIndex: 0, field: 'distanceKm', status }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

test.describe('距離の超過申請の承認', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    accountId = await getAccountId()
    // 申請者（作業員）と users 行
    workerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E距離申請者_${TS}`, role: 'site', active: true }),
    }))[0].id
    userId = (await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: `E2E距離申請者_${TS}`, worker_id: workerId, line_user_id: `e2e-dist-${TS}` }),
    }))[0].id
    // 承認者（site_manager）＝自己承認の検証用に自分の worker/users 行も持つ
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    })
    execSync(`psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}') where email='${SM_EMAIL}'"`, { stdio: 'ignore' })
    const authUserId = execSync(`psql "${DB_URL}" -tAc "select id from auth.users where email='${SM_EMAIL}'"`).toString().trim()
    smWorkerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E距離承認者_${TS}`, role: 'site', permission_role: 'site_manager', active: true, auth_user_id: authUserId }),
    }))[0].id
    smUserId = (await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: `E2E距離承認者_${TS}`, worker_id: smWorkerId, line_user_id: `e2e-dist-sm-${TS}` }),
    }))[0].id
    smToken = await signIn(SM_EMAIL, SM_PASS)
    expect(smToken).toBeTruthy()
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?user_id=in.(${userId},${smUserId})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=in.(${userId},${smUserId})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=in.(${workerId},${smWorkerId})`, { method: 'DELETE' }).catch(() => {})
    execSync(`psql "${DB_URL}" -c "delete from auth.users where email='${SM_EMAIL}'"`, { stdio: 'ignore' })
  })

  test('AC7/AC5★: 承認待ちがバッジと一覧に出て、承認すると距離欄が申請値に差し替わる', async ({ page }) => {
    const reportId = await seedReport(userId, DATE, `E2E距離現場_${TS}`)
    await page.goto('/distance-approvals', { waitUntil: 'networkidle' })

    const key = `${reportId}-0-0-distanceKm`
    await expect(page.getByTestId(`da-row-${key}`), '申請が一覧に出る').toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId(`da-change-${key}`)).toContainText('40km')
    await expect(page.getByTestId(`da-change-${key}`)).toContainText('65km')
    await expect(page.getByTestId('nav-badge-distance'), '★ナビのバッジに件数が出る').toBeVisible()
    const before = Number((await page.getByTestId('nav-badge-distance').textContent())?.trim())
    expect(before).toBeGreaterThanOrEqual(1)

    // 承認前は既定値のまま（金額が動かない）
    expect(Number((await vehicleOf(reportId)).distanceKm)).toBe(DEFAULT_KM)

    await page.getByTestId(`da-approve-${key}`).click()
    await expect(page.getByTestId(`da-row-${key}`), '一覧から消える').toHaveCount(0, { timeout: 15000 })

    const v = await vehicleOf(reportId)
    expect(Number(v.distanceKm), '★承認で距離欄が申請値に差し替わる（＝集計に反映）').toBe(65)
    expect(v.overages.distanceKm.status).toBe('approved')
    expect(v.overages.distanceKm.decidedBy, '承認者名がサーバ側で確定する').toBeTruthy()
    // 履歴に出る
    await expect(page.getByTestId('da-history').getByText(`E2E距離申請者_${TS}`).first()).toBeVisible()
    // バッジが減る（0なら消える）
    const badge = page.getByTestId('nav-badge-distance')
    if (before === 1) await expect(badge).toHaveCount(0)
    else expect(Number((await badge.textContent())?.trim())).toBe(before - 1)
  })

  test('AC5★: 却下すると既定値のまま（申請値に差し替わらない）', async ({ page }) => {
    const reportId = await seedReport(userId, '2026-10-27', `E2E距離現場2_${TS}`)
    await page.goto('/distance-approvals', { waitUntil: 'networkidle' })
    const key = `${reportId}-0-0-distanceKm`
    await expect(page.getByTestId(`da-row-${key}`)).toBeVisible({ timeout: 15000 })
    await page.getByTestId(`da-reject-${key}`).click()
    await expect(page.getByTestId(`da-row-${key}`)).toHaveCount(0, { timeout: 15000 })
    const v = await vehicleOf(reportId)
    expect(Number(v.distanceKm), '却下なら既定値のまま').toBe(DEFAULT_KM)
    expect(v.overages.distanceKm.status).toBe('rejected')
  })

  test('AC6★: 自己承認は EF が 403 で弾き、二重決裁は changed=0 で何も書き換えない', async () => {
    // 自分（承認者）の日報にある申請 → SELF_APPROVAL_FORBIDDEN
    const mine = await seedReport(smUserId, '2026-10-28', `E2E距離自分_${TS}`)
    const self = await decideViaEf(smToken, mine, 'approved')
    expect(self.status, '自己承認は 403').toBe(403)
    expect(self.body.error).toBe('SELF_APPROVAL_FORBIDDEN')
    expect(Number((await vehicleOf(mine)).distanceKm), '何も変わらない').toBe(DEFAULT_KM)

    // 他人の申請: 1回目は通り、2回目（連打・再送）は changed=0
    const other = await seedReport(userId, '2026-10-29', `E2E距離他人_${TS}`)
    const first = await decideViaEf(smToken, other, 'approved')
    expect(first.status).toBe(200)
    expect(first.body.changed).toBe(1)
    const second = await decideViaEf(smToken, other, 'rejected')
    expect(second.status).toBe(200)
    expect(second.body.changed, '★二重決裁は何も書き換えない').toBe(0)
    const v = await vehicleOf(other)
    expect(v.overages.distanceKm.status, '最初の決裁が残る').toBe('approved')
    expect(Number(v.distanceKm)).toBe(65)

    // 匿名（anon キーそのもの）は 401
    const anon = await decideViaEf(ANON_KEY, other, 'approved')
    expect(anon.status).toBe(401)
  })
})
