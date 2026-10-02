// ============================================================
//  admin.site-addresses.spec.ts
//  住所の無い現場（2026-10-02 設計「入力の手間を減らす」I-4）。
//
//  ★守ること:
//   1. 住所の無い現場（失注を除く）が一覧に出て、その場で住所を入れられる。入れたら一覧から消える
//   2. 住所を書き換えると、古い位置（緯度経度）は消える（距離の候補が狂わないように）
//   3. Google の鍵が無い間は「候補を探す」を出さず、手で入れる案内を出す
//   4. 候補を出す口は、ログインした承認者だけが使える
//  ★候補の検索そのもの（Google）は鍵が要るので、ここでは見ない（鍵を入れた後に人が確かめる）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, ANON_KEY, SUPABASE_URL } from './helpers'

const TS = Date.now()
const SITE = `E2E住所なし現場_${TS}`
const LOST = `E2E住所なし失注_${TS}`
let siteId = ''
let lostId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const rows = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([
    { account_id: accountId, name: SITE, status: 'in_progress', active: true },
    { account_id: accountId, name: LOST, status: 'lost', active: true },
  ]) })
  siteId = rows.find((r: any) => r.name === SITE).id
  lostId = rows.find((r: any) => r.name === LOST).id
})
test.afterAll(async () => {
  await restSrv(`sites?id=in.(${siteId},${lostId})`, { method: 'DELETE' }).catch(() => {})
})

test('★住所の無い現場に、その場で住所を入れられる（失注は出ない・鍵が無い間は手で入れる案内）', async ({ page }) => {
  await page.goto('/site-addresses', { waitUntil: 'networkidle' })
  await page.getByTestId('addresses-search').fill(`_${TS}`)
  const row = page.getByTestId(`addresses-row-${siteId}`)
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId(`addresses-row-${lostId}`), '失注は出ない').toHaveCount(0)
  await expect(page.getByTestId('addresses-no-key'), '鍵が無い間の案内').toBeVisible()
  await expect(page.getByTestId(`addresses-suggest-${siteId}`), '鍵が無い間は候補を探さない').toHaveCount(0)

  await page.getByTestId(`addresses-input-${siteId}`).fill('愛知県名古屋市中区栄3-1-1')
  await page.getByTestId(`addresses-save-${siteId}`).click()
  await expect(row, '入れたら一覧から消える').toHaveCount(0, { timeout: 10000 })
  const s = (await restSrv(`sites?id=eq.${siteId}&select=location,lat,lng`))[0]
  expect(s.location).toBe('愛知県名古屋市中区栄3-1-1')
  expect(s.lat, '手で入れた住所には位置は入らない').toBeNull()
})

test('★住所を書き換えると、古い位置は消える', async () => {
  await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ location: '愛知県名古屋市中区栄3-1-1', lat: 35.16, lng: 136.9, geocoded_at: new Date().toISOString() }) })
  expect((await restSrv(`sites?id=eq.${siteId}&select=lat`))[0].lat, '位置と一緒なら入る').toBe(35.16)
  await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ location: '東京都渋谷区1-1' }) })
  const s = (await restSrv(`sites?id=eq.${siteId}&select=lat,lng,geocoded_at`))[0]
  expect(s.lat, '住所だけ変えたら位置は消える').toBeNull()
  expect(s.lng).toBeNull()
  expect(s.geocoded_at).toBeNull()
})

test('★候補を出す口は、身元の無い呼び出しを断る', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/site-address-suggest`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'search', query: '名古屋駅' }),
  })
  expect(res.status).toBe(401)
})
