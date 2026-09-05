// ============================================================
//  admin.site-owner-rls.spec.ts
//  「現場管理者の所有権モデル」Step1: sites テーブルのRLS
//  （2026-07-31 ユーザー方針・Q1〜Q4確定・2026-09-03実装）
//
//  UIのガードではなくRLSそのものを検証する（画面を経由せず、site_managerの
//  JWTで直接REST APIを叩く＝「APIを直接叩けば書き換えられる」の再現）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, getAccountId, restSrv, authAdmin } from './helpers'

const TS = Date.now()

async function makeSiteManager() {
  const accountId = await getAccountId()
  const email = `e2e-sm-${TS}@example.com`
  const password = 'e2e-sm-pass-1234'

  const res = await authAdmin('admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { account_slug: ACCOUNT_SLUG } }),
  })
  if (!res.ok) throw new Error(`auth user作成失敗: ${res.status} ${await res.text()}`)
  const { id: authUserId } = await res.json()

  const [worker] = await restSrv('workers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: `E2E現場管理者_${TS}`, role: 'site',
      permission_role: 'site_manager', auth_user_id: authUserId, active: true,
    }),
  })

  const [ownSite] = await restSrv('sites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E自分の現場_${TS}`, active: true, responsible_worker_id: worker.id }),
  })
  const [otherSite] = await restSrv('sites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E他人の現場_${TS}`, active: true, responsible_worker_id: null }),
  })

  const tokRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { access_token: accessToken } = await tokRes.json()

  return { accountId, authUserId, workerId: worker.id, ownSiteId: ownSite.id, otherSiteId: otherSite.id, accessToken }
}

async function patchAsSiteManager(accessToken: string, siteId: string, body: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/rest/v1/sites?id=eq.${siteId}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
}

async function cleanup(t: { accountId: string; authUserId: string; workerId: string; ownSiteId: string; otherSiteId: string }) {
  await restSrv(`sites?id=in.(${t.ownSiteId},${t.otherSiteId})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${t.workerId}`, { method: 'DELETE' }).catch(() => {})
  await authAdmin(`admin/users/${t.authUserId}`, { method: 'DELETE' }).catch(() => {})
}

test('★RLS: site_managerは自分が責任者の現場は書き換えられ、他人の現場はAPIを直接叩いても書き換えられない', async () => {
  const t = await makeSiteManager()
  try {
    // 自分が責任者の現場: 更新できる
    const okRes = await patchAsSiteManager(t.accessToken, t.ownSiteId, { memo: 'e2e-updated-own' })
    expect(okRes.status, '自分の現場は更新できる').toBeLessThan(300)
    const okBody = await okRes.json()
    expect(okBody, '★更新が実際に反映されている(行が返る)').toHaveLength(1)
    expect(okBody[0].memo).toBe('e2e-updated-own')

    // 他人の現場: PostgRESTはRLSでUPDATE対象0件になると200+空配列を返す（エラーにならない）。
    // 「成功したように見えて実は書き換わっていない」を正しくassertするため、必ずDBの実値も確認する。
    const ngRes = await patchAsSiteManager(t.accessToken, t.otherSiteId, { memo: 'e2e-should-not-apply' })
    const ngBody = await ngRes.json()
    expect(ngBody, '★他人の現場はRLSで0件更新（本文が空配列）').toEqual([])

    const [reloaded] = await restSrv(`sites?id=eq.${t.otherSiteId}&select=memo`)
    expect(reloaded.memo, '★DB上も書き換わっていない').not.toBe('e2e-should-not-apply')
  } finally {
    await cleanup(t)
  }
})

test('★RLS: 責任者未設定の現場もsite_managerからは更新できない（owner/admin/officeのみ）', async () => {
  const t = await makeSiteManager()
  try {
    // otherSiteId は responsible_worker_id=null（未設定）。site_managerからは編集不可(Q4)。
    const res = await patchAsSiteManager(t.accessToken, t.otherSiteId, { active: false })
    const body = await res.json()
    expect(body, '★責任者未設定の現場も更新できない').toEqual([])
  } finally {
    await cleanup(t)
  }
})
