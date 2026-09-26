// ============================================================
//  liff.tools-checkout-return.spec.ts
//  道具②（2026-09-10 SEED 会議・設計書 T-1・確認事項2=A 仮置き）: QR で 持出→又貸し→返却 の一連。
//   - 持出: 持出先（現場 or 拠点）必須（既定＝当日の日報の現場）。位置情報は抑止目的＝取れなくても記録できる（「位置なし」）
//   - 又貸し: 別の人が持出中の道具を「持ち出す」と所持者が移る（kind=transfer）。前の人にアプリ内お知らせ（＋メール best-effort）
//   - 返却: 場所QR→「どれを返しますか」→道具→確定。本人以外でも可。tools.current_location_id に返した場所
//   - 同じ clientRequestId の再送は二重に記録しない
//  出所: 大塚「大塚社長が持っていって登録すれば（責任が移る）」「俺らがどこで返してるかわからんよね」
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
let accountId = ''
let workerId = ''
let otherWorkerId = ''
let baseSiteId = ''
let locationId = ''
let siteId = ''
let toolId = ''

async function ef(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/tools`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, dev_line_user_id: 'dev-user-id', ...payload }),
  })
  return { status: res.status, body: await res.json() }
}
const toolRow = async () => (await restSrv(`tools?id=eq.${toolId}&select=status,holder_worker_id,site_id,current_location_id`))[0]
const events = async () => restSrv(`tool_events?tool_id=eq.${toolId}&select=kind,worker_id,from_worker_id,site_id,location_id,lat,lng,accuracy,client_request_id&order=created_at`)

test.describe('道具② 持出→又貸し→返却（作業員アプリ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    await restSrv('worker_consents', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, consent_version: 1, consent_text: 'E2E' }) }).catch(() => {})
    otherWorkerId = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E前の所持者_${TS}`, role: 'site', active: true }) }))[0].id
    baseSiteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E道具拠点_${TS}`, kind: 'office', active: true }) }))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E道具現場_${TS}`, active: true }) }))[0].id
    locationId = (await restSrv('tool_locations', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, base_site_id: baseSiteId, name: '倉庫A' }) }))[0].id
    toolId = (await restSrv('tools', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2Eインパクト_${TS}`, kind: '電動工具', code: 'I-1', location_id: locationId }) }))[0].id
  })
  test.afterAll(async () => {
    await restSrv(`schedule_notifications?worker_id=eq.${otherWorkerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tool_events?tool_id=eq.${toolId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tools?id=eq.${toolId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tool_locations?id=eq.${locationId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${baseSiteId},${siteId})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${otherWorkerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★持出: 持出先を選ばないと押せない／位置情報つきで記録され status=out・所持者＝自分', async ({ page }) => {
    await page.context().grantPermissions(['geolocation'])
    await page.context().setGeolocation({ latitude: 35.1709, longitude: 136.8815, accuracy: 12 })
    await page.goto(`/tools/${toolId}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('tool-checkout-card')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('tool-checkout-submit'), '★持出先は必須').toBeDisabled()
    await page.getByTestId('tool-site-select').selectOption(siteId)
    await page.getByTestId('tool-geo-get').click()
    await expect(page.getByTestId('tool-geo-state')).toContainText('取得しました', { timeout: 15000 })
    await page.getByTestId('tool-checkout-submit').click()
    await expect(page.getByTestId('tool-done-card')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('tool-msg')).toContainText('持出を記録')
    await expect(page.getByTestId('tool-no-location')).toHaveCount(0)
    const t = await toolRow()
    expect(t.status).toBe('out'); expect(t.holder_worker_id).toBe(workerId); expect(t.site_id).toBe(siteId)
    const ev = await events()
    expect(ev.length).toBe(1)
    expect(ev[0].kind).toBe('checkout'); expect(ev[0].worker_id).toBe(workerId); expect(ev[0].site_id).toBe(siteId)
    expect(Number(ev[0].lat)).toBeCloseTo(35.1709, 3); expect(Number(ev[0].accuracy)).toBe(12)
    expect(ev[0].client_request_id, 'べき等キーが残る').toBeTruthy()
  })

  test('★又貸し: 別の人が持出中の道具を持ち出すと所持者が移り、前の人にお知らせが残る／同じキーの再送は二重にならない', async () => {
    // 前の所持者を別の作業員にしておく
    await restSrv(`tools?id=eq.${toolId}`, { method: 'PATCH', body: JSON.stringify({ status: 'out', holder_worker_id: otherWorkerId, site_id: siteId }) })
    const clientRequestId = crypto.randomUUID()
    const r1 = await ef('checkout', { toolId, siteId: baseSiteId, clientRequestId })   // 位置なし（確認事項2=A）
    expect(r1.status).toBe(200)
    expect(r1.body.kind, '所持者移転').toBe('transfer')
    expect(r1.body.prevHolderId).toBe(otherWorkerId)
    expect(r1.body.located, '位置なしでも記録できる').toBe(false)
    const t = await toolRow()
    expect(t.holder_worker_id).toBe(workerId); expect(t.site_id).toBe(baseSiteId); expect(t.status).toBe('out')
    const ev = await events()
    const tr = ev.find((e: any) => e.kind === 'transfer')
    expect(tr.from_worker_id).toBe(otherWorkerId); expect(tr.worker_id).toBe(workerId); expect(tr.lat).toBeNull()
    const notif = await restSrv(`schedule_notifications?worker_id=eq.${otherWorkerId}&kind=eq.tool&select=title,link_path`)
    expect(notif.length, '前の所持者にアプリ内お知らせ').toBe(1)
    expect(notif[0].title).toContain(`E2Eインパクト_${TS}`)
    expect(notif[0].link_path).toBe(`/tools/${toolId}`)
    // 再送（同じ clientRequestId）→ 二重に記録しない
    const r2 = await ef('checkout', { toolId, siteId: baseSiteId, clientRequestId })
    expect(r2.body.deduped).toBe(true)
    expect((await events()).length).toBe(2)
  })

  test('★返却: 場所QR→「どれを返しますか」→確定で status=available・返した場所が残る（本人以外でも可）', async ({ page }) => {
    // 持出中（所持者＝別の人）にして、自分が返す
    await restSrv(`tools?id=eq.${toolId}`, { method: 'PATCH', body: JSON.stringify({ status: 'out', holder_worker_id: otherWorkerId, site_id: siteId, current_location_id: null }) })
    await page.goto(`/tool-locations/${locationId}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('location-return-hint')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('location-my-tools')).toHaveCount(0)
    await page.getByTestId('location-others-toggle').click()
    await page.getByTestId(`location-return-${toolId}`).click()
    await expect(page.getByTestId('tool-return-card')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('tool-return-card')).toContainText(`E2E道具拠点_${TS}＞倉庫A`)
    await page.getByTestId('tool-return-submit').click()   // 位置情報は取らずに記録（確認事項2=A）
    await expect(page.getByTestId('tool-done-card')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('tool-msg')).toContainText('返却を記録')
    await expect(page.getByTestId('tool-no-location'), '位置なしで記録した旨').toBeVisible()
    const t = await toolRow()
    expect(t.status).toBe('available'); expect(t.holder_worker_id).toBeNull(); expect(t.site_id).toBeNull()
    expect(t.current_location_id, '返した場所が残る').toBe(locationId)
    const ev = await events()
    const rt = ev.find((e: any) => e.kind === 'return')
    expect(rt.location_id).toBe(locationId); expect(rt.worker_id).toBe(workerId); expect(rt.from_worker_id, '前の所持者').toBe(otherWorkerId)
    // 道具ページに「今ある場所」
    await page.goto(`/tools/${toolId}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('tool-current')).toContainText('倉庫A', { timeout: 15000 })
    await expect(page.getByTestId('tool-return-card'), '返却後は返却モードが解除される').toHaveCount(0)
  })
})
