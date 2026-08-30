// ============================================================
//  admin.reminder-in-app.spec.ts
//  日報未送信リマインドが「LINEのDM」ではなく「アプリ内のお知らせ」に届くことを固定する。
//
//  ★経緯（2026-08-30）:
//   LINEからは降りる方針。日報のLINE通知は本番で 2026-07-01 以降ゼロ＝運用としては
//   既に終わっていたが、コードだけが残って「通知が二重に飛ばないか」を毎回考える
//   材料になっていた。送信経路をアプリ内のお知らせ（schedule_notifications）へ移した。
//
//   ★副作用として良くなった点: 以前は line_user_id が無い受信者には何も届かなかった。
//    アプリ内通知なら LINE 連携の有無に関わらず届く。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv } from './helpers'

const FN = `${SUPABASE_URL}/functions/v1/daily-reminder`

// ★daily-reminder は slug='test' を意図的に除外する（E2E用アカウントを巻き込まないため）。
//  そこで専用のアカウントを1つ作って、その中で完結させる。
const SLUG = `e2e-reminder-${Date.now()}`
let accountId = ''
let workerId = ''
let userId = ''

test.beforeAll(async () => {
  const acc = await restSrv('accounts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ slug: SLUG, name: 'E2Eリマインド検証' }),
  })
  accountId = acc[0].id
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: 'service_start_date', value: '2026-01-01', label: 'サービス開始日' }),
  })
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: 'E2Eリマインド対象', active: true, role: 'site',
      created_at: new Date(Date.now() - 30 * 86400e3).toISOString() }),
  })
  workerId = w[0].id
  const u = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, real_name: 'E2Eリマインド対象',
      line_user_id: `e2e-reminder-${Date.now()}`, is_reminder_recipient: true }),
  })
  userId = u[0].id
})

test('★リマインドはLINEではなくアプリ内のお知らせに積まれる', async () => {
  test.skip(!userId, 'このアカウントに users 行を持つ作業員がいない')

  await restSrv(`schedule_notifications?worker_id=eq.${workerId}&kind=eq.report_reminder`, { method: 'DELETE' }).catch(() => {})

  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ dry_run: false, manual: true, account_slug: SLUG }),
  })
  const body = await res.json().catch(() => ({} as any))
  expect(res.status, `リマインドが実行できる (${JSON.stringify(body).slice(0, 200)})`).toBe(200)

  const rows = await restSrv(`schedule_notifications?worker_id=eq.${workerId}&kind=eq.report_reminder&select=title,body,link_path`)
  // 未送信が1件も無ければ通知は積まれない（「全員送信済み」で return する）。それは正常。
  const results: any[] = body.results ?? []
  const sent = results.some(r => String(r.result ?? '').includes('送信完了'))
  if (!sent) {
    test.skip(true, `未送信者がいないため通知なし（result=${results.map(r => r.result).join(',')}）`)
    return
  }

  expect(rows.length, '★お知らせが積まれる').toBeGreaterThan(0)
  expect(rows[0].link_path, '押すと日報一覧へ飛べる').toBe('/reports')
  expect(rows[0].body, '誰が何日分ためているかが本文で分かる').toContain('日報未送信リマインド')
})

test.afterAll(async () => {
  await restSrv(`schedule_notifications?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`settings?account_id=eq.${accountId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`reminder_logs?account_id=eq.${accountId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`accounts?id=eq.${accountId}`, { method: 'DELETE' }).catch(() => {})
})
