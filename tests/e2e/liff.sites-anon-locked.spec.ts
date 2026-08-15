// ============================================================
//  liff.sites-anon-locked.spec.ts
//  現場・元請け・現場×協力業者の紐付けが公開キー（anon）から触れないこと。
//
//  ★背景（2026-08-15 実測・本番）:
//   公開キーだけで sites / contractors / site_subcontractors が全テナント分読めた。
//   どの会社がどの現場を持ち、どの元請けと組み、どの業者を入れているか——
//   つまり顧客リストと取引関係が、外から丸ごと取れる状態だった。
//   anon キーは LIFF の JS に埋め込まれて配信されるので、サイトを開けば誰でも入手できる。
//   さらに INSERT/UPDATE が素通しで、他社の現場名を書き換えることもできた。
//
//   LIFF の読み書きは Edge Function master-data 経由に全部移してある。
//   画面が動いていることは他の spec が見ているので、ここは「DBが守っているか」だけを、
//   画面を通さずキーで直接叩いて確かめる。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E現場遮断_${TS}`
const CONTRACTOR = `E2E元請け遮断_${TS}`
const SUB = `E2E業者遮断_${TS}`

let accountId = ''
let siteId = ''
let contractorId = ''
let subId = ''

/** anon キーだけで PostgREST を直接叩く（LIFF の JS が持っているのと同じ権限） */
async function asAnon(pathAndQuery: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  return { status: res.status, text: await res.text() }
}

test.describe('現場・元請け・紐付けは公開キーから触れない', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    // 読めてはいけないデータを実際に置く（空だから0件、では検証にならない）
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
    contractorId = (await restSrv('contractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: CONTRACTOR, active: true }),
    }))[0].id
    subId = (await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SUB, active: true }),
    }))[0].id
    await restSrv('site_subcontractors', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, site_id: siteId, subcontractor_id: subId }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`site_subcontractors?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`contractors?id=eq.${contractorId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★anonキーでは現場を1件も読めない（他社の現場名が見えない）', async () => {
    const r = await asAnon('sites?select=*')
    expect(r.status, `★公開キーで読めてはいけない (返答: ${r.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)
    expect(r.text, '現場名が漏れていない').not.toContain(SITE)
  })

  test('★anonキーでは元請けを1件も読めない（取引先リストが見えない）', async () => {
    const r = await asAnon('contractors?select=*')
    expect(r.status, `★公開キーで読めてはいけない (返答: ${r.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)
    expect(r.text, '元請け名が漏れていない').not.toContain(CONTRACTOR)
  })

  test('★anonキーでは現場×協力業者の紐付けを読めない（どこに誰を入れたかが見えない）', async () => {
    const r = await asAnon('site_subcontractors?select=*')
    expect(r.status, `★公開キーで読めてはいけない (返答: ${r.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)
    expect(r.text, '紐付けが漏れていない').not.toContain(siteId)
  })

  test('★anonキーでは現場を作れない・書き換えられない・消せない', async () => {
    const ins = await asAnon('sites', {
      method: 'POST', body: JSON.stringify({ account_id: accountId, name: `${SITE}_捏造`, active: true }),
    })
    expect(ins.status, `★公開キーで現場を作れてはいけない (返答: ${ins.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)

    const upd = await asAnon(`sites?id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ name: '書き換えられた' }) })
    expect(upd.status).toBeGreaterThanOrEqual(400)

    const del = await asAnon(`sites?id=eq.${siteId}`, { method: 'DELETE' })
    expect(del.status).toBeGreaterThanOrEqual(400)

    const rows = await restSrv(`sites?id=eq.${siteId}&select=name`)
    expect(rows.length, '消されていない').toBe(1)
    expect(rows[0].name, '書き換えられていない').toBe(SITE)
    const forged = await restSrv(`sites?name=eq.${encodeURIComponent(`${SITE}_捏造`)}&select=id`)
    expect(forged.length, '捏造した現場が入っていない').toBe(0)
  })

  test('★anonキーでは元請け・紐付けも作れない', async () => {
    const c = await asAnon('contractors', {
      method: 'POST', body: JSON.stringify({ account_id: accountId, name: `${CONTRACTOR}_捏造`, active: true }),
    })
    expect(c.status).toBeGreaterThanOrEqual(400)

    const l = await asAnon('site_subcontractors', {
      method: 'POST', body: JSON.stringify({ account_id: accountId, site_id: siteId, subcontractor_id: subId }),
    })
    expect(l.status).toBeGreaterThanOrEqual(400)
  })

  test('★協力業者は列が絞られている（振込先口座・単価は公開キーで読めない）', async () => {
    // subcontractors は LIFF の協力業者ページが今も直接読むためテーブルごとは閉じていない。
    // 閉じていない代わりに「口座・単価は列ごと剥がしてある」ことをここで固定する。
    for (const col of ['bank_account_number', 'bank_account_holder', 'bank_name', 'unit_price', 'address']) {
      const r = await asAnon(`subcontractors?select=${col}`)
      expect(r.status, `★${col} は公開キーで読めてはいけない (返答: ${r.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)
    }
    // 業務上必要な列は引き続き読める（絞りすぎて協力業者ページが壊れていないこと）
    const ok = await asAnon('subcontractors?select=id,name,active')
    expect(ok.status, '名前は読める').toBe(200)
  })
})
