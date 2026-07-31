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

  test('LINE作業員の自己登録（許可された列だけ）は壊れていない', async () => {
    const selfName = `E2E権限ロック_自己登録_${Date.now()}`
    const res = await anonFetch('workers', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name: selfName, role: 'site', unit_price: 0, active: true, account_id: accountId }),
    })
    expect(res.ok, 'register.vue の自己登録経路は通る').toBe(true)
  })

  test('anon で site_shares を UPDATE できない', async () => {
    const res = await anonFetch(`site_shares?site_id=eq.00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH', body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000' }),
    })
    expect(res.ok).toBe(false)
  })
})
