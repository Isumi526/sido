// ============================================================
//  liff.site-not-in-register.spec.ts
//  現場が台帳に無くても行き止まりにならないこと。
//
//  ★経緯（2026-08-27 の現場未登録の報告 → 調査で判明）:
//   職人は現場を新規作成できない（権限が admin/office/site_manager のみ）。
//   日報だけは「現場未設定（あとで紐付け）」の逃げ道があったが、他の画面には無く
//   行き止まりになっていた。
//
//   ★一番の実害は残業申請だった: 現場を選べなくても申請自体は通るが、
//    クライアントが `efUrl && sites.length` で通知を止めていて、さらにEF側も
//    site_names が空なら no_sites で終了していた。つまり
//    **申請は成立しているのに誰にも気づかれないまま放置される**。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, ensureDevWorker } from './helpers'

let accountId = ''
let workerId = ''
const DATE = '2026-10-23'

test.beforeAll(async () => {
  accountId = await getAccountId()
  const dev = await ensureDevWorker('site-not-in-register')
  workerId = dev.workerId
})

test.afterAll(async () => {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
})

test('★現場が選べていない残業申請でも通知が飛ぶ（黙って放置されない）', async () => {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  // 現場未選択（site_names=[]）の申請を作る＝台帳に無い現場で申請した状態
  await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: DATE,
      requested_end_time: '20:00', reason: 'E2E: 台帳に無い現場',
      site_names: [], status: 'pending',
    }),
  })

  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-overtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ accountSlug: 'test', worker_id: workerId, date: DATE }),
  })
  const body = await res.json().catch(() => ({} as any))
  expect(res.status, `EFが応答する (${JSON.stringify(body).slice(0, 200)})`).toBe(200)
  // ★以前はここが skipped:'no_sites' で終わっていた。現場が無くても宛先を探しに行くこと。
  expect(body.skipped, `★現場が無いことを理由に通知を捨てない (${JSON.stringify(body)})`).not.toBe('no_sites')
})

test('★予定管理に「台帳に無い現場」の逃げ道がある（職人が行き止まりにならない）', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // 予定の追加モーダルを開く（現場の選択肢はモーダルの中にある）
  await page.locator('.cell-add-btn').first().click()
  await expect(page.getByTestId('site-select'), '現場の選択欄が出る').toBeVisible({ timeout: 10000 })

  // 現場の選択肢に __unset__ が用意されているか（権限が無い人にだけ出る）
  const hasUnset = await page.evaluate(() =>
    Array.from(document.querySelectorAll('option')).some(o => (o as HTMLOptionElement).value === '__unset__'),
  )
  const canCreate = await page.evaluate(() =>
    Array.from(document.querySelectorAll('option')).some(o => (o as HTMLOptionElement).value === '__other__'),
  )
  // 権限者は「新しい現場を登録する」が使えるので __unset__ は出さない＝どちらかが必ずある
  expect(hasUnset || canCreate, '★現場を選べない行き止まりを作らない').toBe(true)
})
