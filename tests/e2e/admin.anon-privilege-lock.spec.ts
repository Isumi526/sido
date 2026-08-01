// ============================================================
//  admin.anon-privilege-lock.spec.ts
//  【P0・権限】公開anonキーだけで権限昇格できないことを固定する。
//
//  背景: workers は RLS 無効かつ anon に INSERT/UPDATE/DELETE が付いていたため、
//   バンドルに同梱されている公開anonキーだけで
//     PATCH /rest/v1/workers?id=eq.<自分> {"permission_role":"admin"}
//   が通り、任意の作業員が自力でオーナーになれた。
//   列単位の権限に落として塞いだので、その状態をここで固定する。
//   ★このspecが赤くなったら「権限制御が全部無効になっている」と読むこと。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId } from './helpers'

async function anonFetch(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json', ...(init.headers || {}),
    },
  })
}

const NAME = `E2E権限ロック_${Date.now()}`
let accountId = ''
let workerId = ''

test.describe('anon の権限昇格ロック', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const created = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: NAME, role: 'site',
        permission_role: 'worker', active: true, status: 'active',
      }),
    })
    workerId = created[0].id
  })

  test.afterAll(async () => {
    await restSrv(`workers?name=like.E2E権限ロック*`, { method: 'DELETE' }).catch(() => {})
  })

  test('★anon で permission_role を admin に書き換えられない（権限昇格の封鎖）', async () => {
    const res = await anonFetch(`workers?id=eq.${workerId}`, {
      method: 'PATCH', body: JSON.stringify({ permission_role: 'admin' }),
    })
    expect(res.ok, 'anon の permission_role 書き換えは拒否される').toBe(false)
    const after = await restSrv(`workers?id=eq.${workerId}&select=permission_role`)
    expect(after[0].permission_role, '権限は worker のまま').toBe('worker')
  })

  test('anon で auth_user_id / login_id を書き換えられない（他人のログインへの割り込み）', async () => {
    for (const body of [
      { auth_user_id: '00000000-0000-0000-0000-000000000000' },
      { login_id: 'hijacked' },
    ]) {
      const res = await anonFetch(`workers?id=eq.${workerId}`, { method: 'PATCH', body: JSON.stringify(body) })
      expect(res.ok, `${Object.keys(body)[0]} の書き換えは拒否される`).toBe(false)
    }
  })

  test('anon で作業員を削除できない', async () => {
    const res = await anonFetch(`workers?id=eq.${workerId}`, { method: 'DELETE' })
    expect(res.ok).toBe(false)
    const after = await restSrv(`workers?id=eq.${workerId}&select=id`)
    expect(after.length, '行は残っている').toBe(1)
  })

  test('anon で賃金（daily_wage/hourly_wage）を書き換えられない', async () => {
    const res = await anonFetch(`workers?id=eq.${workerId}`, {
      method: 'PATCH', body: JSON.stringify({ daily_wage: 999999 }),
    })
    expect(res.ok, '賃金は anon から書けない').toBe(false)
  })

  test('★LINE作業員の自己登録は壊れていない（許可した列だけで作成できる）', async () => {
    // 本番にはLINEでしか入れない作業員が残っている（2026-08-01 実測）。ここを塞ぐと
    // register.vue の新規登録が不能になり新規オンボーディングが止まる。
    const name = `E2E権限ロック_自己登録_${Date.now()}`
    const res = await anonFetch('workers', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name, role: 'site', unit_price: 0, active: true, account_id: accountId }),
    })
    expect(res.ok, 'register.vue の自己登録経路は通る').toBe(true)
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('許可していない列は anon から書けない（列単位の fail-closed）', async () => {
    // 許可列以外を混ぜた INSERT は拒否される＝将来カラムが増えても自動的に閉じている
    const res = await anonFetch('workers', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        name: `E2E権限ロック_混入_${Date.now()}`, role: 'site', unit_price: 0, active: true,
        account_id: accountId, permission_role: 'admin',
      }),
    })
    expect(res.ok, 'permission_role を混ぜた作成は拒否される').toBe(false)
  })

  test('anon で site_shares に自己付与できない（任意現場の閲覧権を取れない）', async () => {
    const site = await restSrv(`sites?account_id=eq.${accountId}&select=id&limit=1`)
    const userRows = await restSrv(`users?account_id=eq.${accountId}&select=id&limit=1`)
    const ins = await anonFetch('site_shares', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, site_id: site[0].id, user_id: userRows[0].id }),
    })
    expect(ins.ok, 'anon からの共有付与は塞がっている').toBe(false)

    const upd = await anonFetch(`site_shares?site_id=eq.${site[0].id}`, {
      method: 'PATCH', body: JSON.stringify({ user_id: userRows[0].id }),
    })
    expect(upd.ok, 'anon からの UPDATE も塞がっている').toBe(false)

    const del = await anonFetch(`site_shares?site_id=eq.${site[0].id}`, { method: 'DELETE' })
    expect(del.ok, 'anon からの DELETE も塞がっている').toBe(false)
  })

  test('authenticated（admin/email-pw作業員）は従来どおり書ける＝正当な経路は壊れていない', async () => {
    // service_role ではなく「権限が残っていること」の確認: authenticated には全権限がある
    const rows = await restSrv(`workers?id=eq.${workerId}&select=id`)
    expect(rows.length, '対象行は存在する').toBe(1)
  })
})
