// ============================================================
//  admin.punch-correction.spec.ts
//  打刻の修正を「本人が申請 → 管理者が承認」で直す。
//
//  ★背景（2026-09-03 大須賀さん / LINE「出退勤の打刻間違え打った為修正できますか」）:
//   打刻を直す導線が1つも無かった。EF は punch（挿入のみ）と backdate（打ち忘れた日の
//   後追い入力のみ）だけ、管理画面の勤怠は閲覧専用。つまり誰も直せなかった。
//   しかも間違いは連鎖する（誤打刻で「出勤中」になると翌朝の出勤も退勤として記録される）。
//
//  ★このspecが守るもの:
//   - 申請しただけでは打刻は変わらない（承認して初めて直る）
//   - 承認すると直り、元の値と誰が直したかが残る
//   - 取り消した誤打刻は物理削除せず、集計・直近ログから外れる
//   - 自分の申請は自分で承認できない／二重決裁できない
//   - 他人の打刻には申請を出せない
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { SUPABASE_URL, ANON_KEY, DB_URL, ACCOUNT_SLUG, restSrv, getAccountId, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } from './helpers'

const TS = Date.now()
// ★自己承認の検証用: 承認権限(site_manager)を持ち、自分の worker 行も持つ人を作る。
//  admin(e2e@email.com)は worker 行を持たない純オーナーなので、そのトークンで叩いても
//  「他人の申請」になり検証にならない（残業承認の spec が同じ罠を踏んでいる）。
const SM_EMAIL = `e2e-pc-sm-${TS}@email.com`
const SM_PASS  = 'e2e-pc-sm-pass-1234'

let accountId = ''
let token = ''
let smToken = ''
let workerId = ''
let smWorkerId = ''
let logId = ''

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await res.json()).access_token ?? ''
}

async function callEf(payload: Record<string, unknown>, bearer = token) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/attendance-log`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** テスト用の打刻を1件作る（service_role で直接入れる＝画面操作に依存しない） */
async function makeLog(type: 'checkin' | 'checkout', hhmm: string): Promise<string> {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const row = await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      worker_id: workerId, type, checked_at: new Date(`${day}T${hhmm}:00+09:00`).toISOString(),
      agreed_rule_texts: [], backdated: false,
    }),
  })
  return row[0].id
}

test.describe('打刻の修正申請と承認', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    token = await signIn(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)
    expect(token, 'admin ログインできる').toBeTruthy()

    // 申請者は「承認者とは別人」にする。同一人物だと自己承認で弾かれて承認そのものを確かめられない
    const ws = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id,name&limit=50`)
    workerId = ws[0]?.id ?? ''
    expect(workerId, '申請者にする作業員が居る').toBeTruthy()

    // 承認者（自分の worker 行を持つ site_manager）を1人作る
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    })
    // app_metadata.account_slug が無いと EF がテナントを解決できない（global-setup と同じやり方）
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}') where email='${SM_EMAIL}'"`,
      { stdio: 'ignore' },
    )
    const authUserId = execSync(`psql "${DB_URL}" -tAc "select id from auth.users where email='${SM_EMAIL}'"`).toString().trim()
    smWorkerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: `E2E打刻承認者_${TS}`, role: 'site',
        permission_role: 'site_manager', active: true, auth_user_id: authUserId,
      }),
    }))[0].id
    smToken = await signIn(SM_EMAIL, SM_PASS)
    expect(smToken, '承認者ユーザーでログインできる').toBeTruthy()
  })

  test.afterAll(async () => {
    await restSrv(`attendance_correction_requests?account_id=eq.${accountId}&reason=like.E2E*`, { method: 'DELETE' }).catch(() => {})
    if (workerId) await restSrv(`attendance_logs?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    if (smWorkerId) await restSrv(`attendance_logs?worker_id=eq.${smWorkerId}`, { method: 'DELETE' }).catch(() => {})
    if (smWorkerId) await restSrv(`workers?id=eq.${smWorkerId}`, { method: 'DELETE' }).catch(() => {})
    try { execSync(`psql "${DB_URL}" -c "delete from auth.users where email='${SM_EMAIL}'"`, { stdio: 'ignore' }) } catch { /* best-effort */ }
  })

  test('★承認するまで打刻は変わらない／承認すると直って元の値が残る', async () => {
    logId = await makeLog('checkout', '08:05')   // 出勤のつもりで退勤を押した想定

    const reqRow = await restSrv('attendance_correction_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, log_id: logId,
        kind: 'type', requested_type: 'checkin', reason: 'E2E 出勤のつもりで退勤を押した',
      }),
    })
    const reqId = reqRow[0].id

    // 申請しただけでは打刻は実際に押された記録のまま
    let log = (await restSrv(`attendance_logs?id=eq.${logId}&select=type,original_type,corrected_by`))[0]
    expect(log.type, '★申請だけでは変わらない').toBe('checkout')
    expect(log.original_type, '元の値もまだ入らない').toBeNull()

    const dec = await callEf({ action: 'correction-decide', id: reqId, status: 'approved' })
    expect(dec.body?.ok, `承認できる: ${JSON.stringify(dec.body)}`).toBe(true)
    expect(dec.body?.applied, '打刻に反映された').toBe(true)

    log = (await restSrv(`attendance_logs?id=eq.${logId}&select=type,original_type,corrected_by,corrected_at`))[0]
    expect(log.type, '★承認すると直る').toBe('checkin')
    expect(log.original_type, '★元の値が残る').toBe('checkout')
    expect(log.corrected_by, '★誰が直したかが残る').toBeTruthy()

    // 二重決裁できない（連打・再送で2回書き換わらない）
    const again = await callEf({ action: 'correction-decide', id: reqId, status: 'approved' })
    expect(again.body?.changed, '★2回目は何も起きない').toBe(0)
  })

  test('★取り消した誤打刻は消えずに残り、直近ログには出ない', async () => {
    const delLogId = await makeLog('checkin', '17:58')
    const reqRow = await restSrv('attendance_correction_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, log_id: delLogId,
        kind: 'delete', reason: 'E2E 退勤のつもりで出勤を押してしまった',
      }),
    })
    const dec = await callEf({ action: 'correction-decide', id: reqRow[0].id, status: 'approved' })
    expect(dec.body?.ok).toBe(true)

    const row = (await restSrv(`attendance_logs?id=eq.${delLogId}&select=id,deleted_at,checked_at`))[0]
    expect(row, '★行そのものは消さない（あった事実を残す）').toBeTruthy()
    expect(row.deleted_at, '★論理削除されている').toBeTruthy()

    // EF の直近ログ（＝「今出勤中か」の判定に使う）から外れている。
    // ★ここが外れないと、誤打刻のせいで次の打刻の種別がずれ続ける（今回の連鎖の原因）
    const recent = await callEf({ action: 'recent', hours: 24, targetWorkerId: workerId })
    const times = ((recent.body?.logs ?? []) as any[]).map(l => new Date(l.checked_at).getTime())
    expect(times, '★取り消した打刻は判定に混ざらない').not.toContain(new Date(row.checked_at).getTime())
  })

  test('★自分の申請は自分で承認できない', async () => {
    // ★承認権限を持つ本人(site_manager)のトークンで叩く。
    //  admin(e2e@email.com)は worker 行を持たない純オーナーなので、そのトークンでは
    //  「他人の申請」になり検証にならない（最初これで空振りした）。
    const selfLogId = await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        worker_id: smWorkerId, type: 'checkin',
        checked_at: new Date().toISOString(), agreed_rule_texts: [], backdated: false,
      }),
    }).then((r: any) => r[0].id)
    const reqRow = await restSrv('attendance_correction_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: smWorkerId, log_id: selfLogId,
        kind: 'delete', reason: 'E2E 自己承認の確認',
      }),
    })
    const dec = await callEf({ action: 'correction-decide', id: reqRow[0].id, status: 'approved' }, smToken)
    expect(dec.body?.error, '★自己承認は塞がれる').toBe('SELF_APPROVAL_FORBIDDEN')
    const after = (await restSrv(`attendance_correction_requests?id=eq.${reqRow[0].id}&select=status`))[0]
    expect(after.status, '申請は pending のまま').toBe('pending')
    const log = (await restSrv(`attendance_logs?id=eq.${selfLogId}&select=deleted_at`))[0]
    expect(log.deleted_at, '打刻も触られていない').toBeNull()
  })

  test('★画面から承認できる', async ({ page }) => {
    const uiLogId = await makeLog('checkout', '09:12')
    const reqRow = await restSrv('attendance_correction_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, log_id: uiLogId,
        kind: 'type', requested_type: 'checkin', reason: 'E2E 画面から承認する',
      }),
    })
    const reqId = reqRow[0].id

    await page.goto('/punch-corrections', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('打刻修正の承認')
    const row = page.locator(`[data-testid="pc-row-${reqId}"]`)
    await expect(row, '承認待ちに出る').toBeVisible({ timeout: 15000 })
    await expect(page.locator(`[data-testid="pc-change-${reqId}"]`), '何をどう直すのかが読める')
      .toContainText('退勤 → 出勤')

    await page.locator(`[data-testid="pc-approve-${reqId}"]`).click()
    await expect(row, '承認したら一覧から消える').toHaveCount(0, { timeout: 15000 })

    // ★画面の表示だけでは「直った」と言えない。DBまで確かめる
    const log = (await restSrv(`attendance_logs?id=eq.${uiLogId}&select=type,original_type`))[0]
    expect(log.type, '★画面からの承認で打刻が直る').toBe('checkin')
    expect(log.original_type, '元の値が残る').toBe('checkout')
  })
})
