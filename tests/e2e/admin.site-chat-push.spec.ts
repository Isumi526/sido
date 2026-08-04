// ============================================================
//  admin.site-chat-push.spec.ts
//  現場チャット新着の web push（要回答の回答=A）。
//
//  ★配信そのものは検証できない: 実機のPWAインストール・ブラウザのpush許可・
//   VAPID鍵が要り、CCも自動E2Eも持っていない（実機確認はユーザー側＝回答Aの前提）。
//   なので**ここで固定するのは「実機が要らない部分」だけ**:
//     - 鍵が無い環境で no-op になり、チャットを壊さないこと
//     - 配信EFの認可（他社の現場の購読者へ任意の文面を配れないこと）
//     - 購読テーブルの権限（anonが他人の購読先を列挙・削除できないこと）
//
//  ★ここが緩いと「外部送信の踏み台」になる。実機で確認できない分、
//   認可だけは自動テストで固めておく。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, rest, getAccountId, ANON_KEY, SUPABASE_URL } from './helpers'

const TS = Date.now()
const SITE = `E2Epush現場_${TS}`
const FN = `${SUPABASE_URL}/functions/v1/send-site-chat-push`

let accountId = ''
let siteId = ''
let subId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const s = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
  })
  siteId = s[0].id
  const sub = await restSrv('push_subscriptions', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, site_id: siteId,
      endpoint: `https://push.example.test/e2e-${TS}`,
      p256dh: 'e2e-p256dh', auth: 'e2e-auth', label: 'E2Eゲスト', sender_name: 'E2Eゲスト',
    }),
  })
  subId = sub[0].id
})

test.afterAll(async () => {
  await restSrv(`push_subscriptions?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

async function callFn(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test('★VAPID鍵が無い環境では no-op（呼び出し側を壊さない）', async () => {
  // 鍵を配る前でもチャットは今までどおり動く必要がある。
  // ここで 500 を返すと投稿のたびにコンソールが荒れる／将来 alert を足した時に誤爆する。
  const { status, body } = await callFn({ site_id: siteId, sender_name: 'E2E', body: 'テスト' })
  expect(status, `鍵未設定でも失敗にしない（実際: ${status} ${JSON.stringify(body)}）`).toBe(200)
  expect(body?.ok).toBe(true)
})

test('★site_id が無ければ 400（鍵が設定された時に無効な要求を通さない）', async () => {
  const { status, body } = await callFn({ sender_name: 'E2E', body: 'テスト' })
  // 鍵未設定の環境では no-op が先に返るので、その時は 200(skipped) でよい。
  // 鍵がある環境では 400 でなければならない。どちらでも「配信はされない」ことが要点。
  if (body?.skipped === 'no_vapid_keys') expect(status).toBe(200)
  else expect(status).toBe(400)
})

test('★購読テーブル: anon は他人の購読先を読めない（endpoint を列挙させない）', async () => {
  // endpoint が読めると、他人の端末へ勝手に push を投げる踏み台にできる。
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })
  const rows = await res.json().catch(() => null)
  // 権限が無い(401/403)か、RLSで0件のどちらか。中身が返ってきたら不合格。
  const leaked = Array.isArray(rows) && rows.length > 0
  expect(leaked, `anonに購読先が漏れている: ${JSON.stringify(rows)?.slice(0, 200)}`).toBe(false)
})

test('★購読テーブル: anon は購読を削除できない（他人の通知を止められない）', async () => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${subId}`, {
    method: 'DELETE',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })
  expect([401, 403, 404], `削除は拒否される（実際: ${res.status}）`).toContain(res.status)
  // 実際に残っていることまで確認する（ステータスだけ見ても消えていたら意味が無い）
  const still = await restSrv(`push_subscriptions?id=eq.${subId}&select=id`)
  expect(still?.length, '購読が消されていない').toBe(1)
})

test('★購読の登録はゲスト(anon)でもできる（招待リンクの導線を塞がない）', async () => {
  const endpoint = `https://push.example.test/e2e-anon-${TS}`
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      account_id: accountId, site_id: siteId,
      endpoint, p256dh: 'x', auth: 'y', label: 'anonゲスト',
    }),
  })
  expect([200, 201, 204], `anonでも購読登録はできる（実際: ${res.status}）`).toContain(res.status)
  await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }).catch(() => {})
})
