// ============================================================
//  liff.self-register.spec.ts
//  LINE から来た「まだ登録していない人」の自己登録（worker-self-register EF）
//
//  ★このspecが存在する理由（2026-09-08 本番障害）
//   2026-08-01 の anon ロックダウン以降、LINE からの新規登録が **全件 401** で
//   失敗していたのに、**1ヶ月以上誰も気づかなかった**。
//   原因は「この経路を通す回帰テストが1本も無かった」こと。
//   実測: users.line_user_id が付いた行は 2026-06-25 を最後に 0 件。
//
//   なのでこのspecは「登録が通ること」だけでなく
//   **「anon の直書きが依然として塞がっていること」** も同時に固定する。
//   どちらか片方だけだと、また同じ壊れ方をする:
//   - 登録だけ見る → 権限を緩めて直しても気づけない（昇格P0が再び開く）
//   - 封鎖だけ見る → 封鎖の巻き添えで登録が死んでも気づけない（今回これ）
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, getAccountId, restSrv } from './helpers'

const TS = Date.now()
const EF = `${SUPABASE_URL}/functions/v1/worker-self-register`

// 未登録の LINE ユーザーを装う。EF はローカル(IS_LOCAL)でのみ dev_line_user_id を受ける。
async function callEf(body: Record<string, unknown>) {
  const res = await fetch(EF, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_slug: ACCOUNT_SLUG, ...body }),
  })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}

const createdWorkerIds: string[] = []
const createdLineIds: string[] = []

test.afterAll(async () => {
  if (createdLineIds.length) {
    await restSrv(`users?line_user_id=in.(${createdLineIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  }
  if (createdWorkerIds.length) {
    await restSrv(`workers?id=in.(${createdWorkerIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  }
})

test.describe('LINE 未登録ユーザーの自己登録', () => {
  test('★一覧が取れる（登録画面なのに登録済みでないと使えない、を再発させない）', async () => {
    const line = `U_e2e_opt_${TS}`
    const r = await callEf({ action: 'options', dev_line_user_id: line })
    expect(r.status, 'options は 200').toBe(200)
    expect(r.body?.ok).toBe(true)
    expect(Array.isArray(r.body?.workers)).toBe(true)
    expect(r.body.workers.length, '未登録でも作業員一覧が返る').toBeGreaterThan(0)
    // ★最小限しか返さない。単価・賃金・連絡先が混ざっていたら情報漏れ
    for (const w of r.body.workers.slice(0, 5)) {
      expect(Object.keys(w).sort()).toEqual(['id', 'name', 'name_kana', 'role'])
    }
  })

  test('★新しい名前で登録できる（作業員と LINE 紐付けが作られる）', async () => {
    const line = `U_e2e_new_${TS}`
    const name = `E2E自己登録_${TS}`
    createdLineIds.push(line)
    const r = await callEf({ action: 'register', dev_line_user_id: line, name, role: 'site' })
    expect(r.status, `登録は 200 (body=${JSON.stringify(r.body)})`).toBe(200)
    expect(r.body?.ok).toBe(true)
    expect(r.body?.user?.line_user_id).toBe(line)
    expect(r.body?.user?.worker_id, '作業員が紐づく').toBeTruthy()
    createdWorkerIds.push(r.body.user.worker_id)

    // DBの実値で確認（レスポンスだけ見て通ったことにしない）
    const rows = await restSrv(`workers?id=eq.${r.body.user.worker_id}&select=name,active,unit_price,permission_role`)
    expect(rows[0].name).toBe(name)
    expect(rows[0].active).toBe(true)
    // ★自己登録から権限を持てないこと（2026-08-01 に塞いだ昇格穴を別経路で開けない）
    expect(rows[0].permission_role ?? 'worker', '自己登録で権限は付かない').toBe('worker')
  })

  test('★同じ本人が入り直しても、作業員も users 行も増えない', async () => {
    const line = `U_e2e_new_${TS}`          // 1つ前のテストと同じ本人
    const name = `E2E自己登録_${TS}`
    const r = await callEf({ action: 'register', dev_line_user_id: line, name, role: 'site' })
    expect(r.status, '同じ本人の再登録は通る').toBe(200)
    const accountId = await getAccountId()
    const ws = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id`)
    expect(ws.length, '同名の作業員が二重に作られない').toBe(1)
    const us = await restSrv(`users?line_user_id=eq.${line}&select=id`)
    expect(us.length, 'users 行が二重に作られない（履歴が出なくなる実害の再発防止）').toBe(1)
  })

  test('★★管理画面で先にログインを発行された人（users 行あり・LINE未紐付）でも二重行を作らない', async () => {
    const accountId = await getAccountId()
    const name = `E2E先行発行_${TS}`
    const [w] = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, role: 'site', unit_price: 0, active: true }),
    })
    createdWorkerIds.push(w.id)
    // 管理画面のログイン発行相当: users 行はあるが line_user_id は NULL
    await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: name, worker_id: w.id, permission_role: 'worker' }),
    })
    const line = `U_e2e_pre_${TS}`
    createdLineIds.push(line)
    const r = await callEf({ action: 'register', dev_line_user_id: line, worker_id: w.id })
    expect(r.status, `登録は通る (body=${JSON.stringify(r.body)})`).toBe(200)
    const us = await restSrv(`users?worker_id=eq.${w.id}&select=id,line_user_id`)
    expect(us.length, '既存の未紐付け行が使われ、行は増えない').toBe(1)
    expect(us[0].line_user_id, 'その行に LINE が紐づく').toBe(line)
  })

  test('★既に別の LINE アカウントに紐づいた作業員は横取りできない（409）', async () => {
    const accountId = await getAccountId()
    const name = `E2E横取り対象_${TS}`
    const [w] = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, role: 'site', unit_price: 0, active: true }),
    })
    createdWorkerIds.push(w.id)
    const owner = `U_e2e_owner_${TS}`
    createdLineIds.push(owner)
    const first = await callEf({ action: 'register', dev_line_user_id: owner, worker_id: w.id })
    expect(first.status, '1人目は登録できる').toBe(200)

    const attacker = `U_e2e_attacker_${TS}`
    const second = await callEf({ action: 'register', dev_line_user_id: attacker, worker_id: w.id })
    expect(second.status, '別のLINEからの紐付けは拒否').toBe(409)
    expect(second.body?.error).toBe('worker_already_linked')
  })

  test('LINE の身元が無ければ何もできない（401）', async () => {
    const r = await callEf({ action: 'options' })   // dev_line_user_id も token も無し
    expect(r.status).toBe(401)
    expect(r.body?.error).toBe('unauthorized')
  })

  test('★★anon から workers への直書きは依然として塞がっている（昇格P0を再び開けない）', async () => {
    const accountId = await getAccountId()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workers?on_conflict=name,account_id`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([{ name: `E2E直書き_${TS}`, role: 'site', unit_price: 0, active: true, account_id: accountId }]),
    })
    expect(res.status, 'anon の upsert は拒否されたまま').toBeGreaterThanOrEqual(400)
  })
})
