// ============================================================
//  admin.reminder-recipients.spec.ts
//  未送信者リマインドを指定ユーザーの個人LINEへ送る機能
//   - AC1/AC2: ユーザー管理で「リマインド受信」「未送信チェック除外」をトグル→DB反映
//   - AC3/AC4: daily-reminder(dry-run)で 除外ユーザーが未送信に出ない／受信者が送信先に出る
//     ※test アカウントは関数が除外するため、非testの sample-construction で検証
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const FN = `${SUPABASE_URL}/functions/v1/test-daily-reminder`

async function callReminderDryRun(slug: string) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ dry_run: true, manual: true, account_slug: slug }),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

test.describe('未送信者リマインド：受信者/除外フラグ', () => {
  // ── AC1/AC2: ユーザー管理のトグル（test アカウント）──
  const uiName = `E2EリマインドUI_${TS}`
  let uiUserId: string

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const rows = await rest('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: uiName, worker_role: 'site', line_user_id: `e2e-ui-${TS}` }),
    })
    uiUserId = rows?.[0]?.id
  })

  test.afterAll(async () => {
    await rest(`users?id=eq.${uiUserId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/AC2: 「リマインド受信」「未送信チェック除外」をトグルしDBに反映', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: uiName })
    await expect(row).toBeVisible({ timeout: 10000 })

    // 受信トグル（1つ目）
    const recvToggle = row.locator('td.center .toggle').nth(0)
    await recvToggle.click()
    await expect(recvToggle).toHaveClass(/on/)
    // 除外トグル（2つ目）
    const exemptToggle = row.locator('td.center .toggle').nth(1)
    await exemptToggle.click()
    await expect(exemptToggle).toHaveClass(/on/)

    // DB反映を確認
    await expect.poll(async () => {
      const r = await rest(`users?id=eq.${uiUserId}&select=is_reminder_recipient,reminder_exempt`)
      return `${r?.[0]?.is_reminder_recipient}/${r?.[0]?.reminder_exempt}`
    }, { timeout: 10000 }).toBe('true/true')

    // リロード後も保持
    await page.reload({ waitUntil: 'networkidle' })
    const row2 = page.locator('tr', { hasText: uiName })
    await expect(row2.locator('td.center .toggle').nth(0)).toHaveClass(/on/)
    await expect(row2.locator('td.center .toggle').nth(1)).toHaveClass(/on/)
  })

  // ── AC3/AC4: 関数の dry-run（非test: sample-construction）──
  const SC_SLUG = 'sample-construction'
  const unsub = `E2E未送信SC_${TS}`
  const exempt = `E2E除外SC_${TS}`
  const recv = `E2E受信SC_${TS}`
  const late = `E2E新規SC_${TS}`   // service_start_date 後に登録＝登録前の未送信を出さない検証用
  let scAccountId = ''
  let prevStartDate: string | null = null
  let fnAvailable = true

  test.beforeAll(async () => {
    // 関数が到達可能か（functions serve 起動）確認。不可ならこのブロックはskip
    try {
      const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true, manual: true, account_slug: '__none__' }) })
      if (!r.ok && r.status !== 404) fnAvailable = false
    } catch { fnAvailable = false }
    if (!fnAvailable) return

    const acc = await rest(`accounts?slug=eq.${SC_SLUG}&select=id`)
    scAccountId = acc?.[0]?.id
    if (!scAccountId) { fnAvailable = false; return }

    // service_start_date を昨日に設定（既存値は退避して後で復元）
    const cur = await rest(`settings?account_id=eq.${scAccountId}&key=eq.service_start_date&select=value`)
    prevStartDate = cur?.[0]?.value ?? null
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    await rest('settings?on_conflict=key,account_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: 'service_start_date', value: y, label: 'サービス開始日', account_id: scAccountId }),
    })

    // ユーザーを用意（日報は無し＝未送信扱い）。
    // unsub/exempt/recv は service_start_date より前から在籍する既存ユーザー（created_at を過去日に固定）。
    // late は service_start_date より後に登録した新規ユーザー（created_at=now）＝登録前の未送信は出ない。
    // PostgREST のバッチ insert は全オブジェクトのキー集合が一致する必要があるため created_at を全員に付与。
    const ESTABLISHED = '2024-01-01T00:00:00Z'
    const NOW = new Date().toISOString()
    await rest('users', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { account_id: scAccountId, real_name: unsub,  worker_role: 'site', line_user_id: `e2e-sc-unsub-${TS}`,  is_reminder_recipient: false, reminder_exempt: false, created_at: ESTABLISHED },
        { account_id: scAccountId, real_name: exempt, worker_role: 'site', line_user_id: `e2e-sc-exempt-${TS}`, is_reminder_recipient: false, reminder_exempt: true,  created_at: ESTABLISHED },
        { account_id: scAccountId, real_name: recv,   worker_role: 'site', line_user_id: `e2e-sc-recv-${TS}`,   is_reminder_recipient: true,  reminder_exempt: false, created_at: ESTABLISHED },
        { account_id: scAccountId, real_name: late,   worker_role: 'site', line_user_id: `e2e-sc-late-${TS}`,   is_reminder_recipient: false, reminder_exempt: false, created_at: NOW },
      ]),
    })
  })

  test.afterAll(async () => {
    if (!scAccountId) return
    for (const n of [unsub, exempt, recv, late]) {
      await rest(`users?account_id=eq.${scAccountId}&real_name=eq.${encodeURIComponent(n)}`, { method: 'DELETE' }).catch(() => {})
    }
    // service_start_date を復元（無かったら削除）
    if (prevStartDate === null) {
      await rest(`settings?account_id=eq.${scAccountId}&key=eq.service_start_date`, { method: 'DELETE' }).catch(() => {})
    } else {
      await rest('settings?on_conflict=key,account_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'service_start_date', value: prevStartDate, label: 'サービス開始日', account_id: scAccountId }),
      }).catch(() => {})
    }
  })

  test('AC3/AC4: dry-runで除外ユーザーは未送信に出ず、受信者が送信先に出る', async () => {
    test.skip(!fnAvailable, 'functions serve 未起動のためskip')
    const { status, json } = await callReminderDryRun(SC_SLUG)
    expect(status).toBe(200)
    const r = (json?.results ?? []).find((x: any) => x.slug === SC_SLUG)
    expect(r, 'sample-construction の結果が返る').toBeTruthy()

    const unsubNames = (r.unsubmitted ?? []).map((u: any) => u.name)
    // AC3: 未送信者は出る／除外フラグの人は出ない
    expect(unsubNames).toContain(unsub)
    expect(unsubNames).not.toContain(exempt)
    // AC5（登録日起点）: service_start_date より後に登録した新規ユーザーは、登録前の未送信を出さない。
    //   対象期間は service_start_date=昨日のみ＝late は本日登録のため未送信に出ない。
    expect(unsubNames).not.toContain(late)
    // AC4: 受信者プレビューに受信フラグの人が連携済みで出る
    const recvNames = (r.recipients ?? []).map((x: any) => x.name)
    expect(recvNames).toContain(recv)
    const recvEntry = (r.recipients ?? []).find((x: any) => x.name === recv)
    expect(recvEntry?.linked).toBe(true)
  })
})
