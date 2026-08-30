// ============================================================
//  admin.external-consents.spec.ts
//  外部者（協力業者ポータル）の規約同意（契約対応②・契約 別紙2§9）
//
//  ★契約は「協力業者ポータル・チャット招待ゲストに同意文言を表示・記録する機能を提供」と
//   書いているのに未実装だった。契約と実態のズレを埋める。
//
//  ★方針（/ball 2026-08-30）: 仕組みを先に作り、文言は後入れ。
//   文言の本文はプレースホルダで、確定後にバージョン1として差し替える。
//
//  ★このテストが守る一番大事なこと:
//   「同意した版」だけでなく **同意した時点の文面そのもの** が残ること。
//   文言を差し替えた後で「あの業者は何に同意したのか」を遡れなくなると、
//   記録として意味がない（契約上も証跡にならない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId } from './helpers'

const FN = `${SUPABASE_URL}/functions/v1/subcontractor-portal`
const TS = Date.now()

let accountId = ''
let subId = ''
let token = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const sub = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E同意業者_${TS}`, category: '商社' }),
  })
  subId = sub[0].id

  // ポータルのトークンを1つ発行する（実運用と同じ形で作る）
  token = `e2e-consent-${TS}`
  const { createHash } = await import('node:crypto')
  await restSrv('document_access_tokens', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, subcontractor_id: subId, purpose: 'vendor_register',
      token_hash: createHash('sha256').update(token).digest('hex'),
      expires_at: new Date(Date.now() + 86400e3).toISOString(),
    }),
  })
})

test.afterAll(async () => {
  await restSrv(`external_consents?subject_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`document_access_tokens?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

async function call(action: string) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action, token }),
  })
  return { status: res.status, body: await res.json().catch(() => ({} as any)) }
}

test('★同意していない外部者には「未同意」と文言が返る', async () => {
  const r = await call('consent_state')
  expect(r.status, `状態を取れる (${JSON.stringify(r.body).slice(0, 200)})`).toBe(200)
  expect(r.body.agreed, '★まだ同意していない').toBe(false)
  expect(String(r.body.text ?? ''), '同意文言が返る（空だと同意のしようがない）').not.toBe('')
  expect(String(r.body.version ?? ''), 'バージョンが返る').not.toBe('')
})

test('★同意すると、版だけでなく同意した文面そのものが残る', async () => {
  const before = await call('consent_state')
  const shownText = String(before.body.text)
  const shownVersion = String(before.body.version)

  const r = await call('consent_agree')
  expect(r.status).toBe(200)
  expect(r.body.agreed).toBe(true)

  const rows = await restSrv(`external_consents?subject_id=eq.${subId}&select=terms_version,consented_text,subject_kind,subject_label,consented_at`)
  expect(rows.length, '記録が1件できる').toBe(1)
  expect(rows[0].terms_version, '同意した版が残る').toBe(shownVersion)
  expect(rows[0].consented_text, '★表示した文面そのものが残る（後で文言を変えても遡れる）').toBe(shownText)
  expect(rows[0].subject_kind).toBe('subcontractor_portal')
  expect(rows[0].subject_label, '誰が同意したか分かる').toContain('E2E同意業者')
})

test('★同じ相手・同じ版で二度押しても記録は増えない', async () => {
  await call('consent_agree')
  await call('consent_agree')
  const rows = await restSrv(`external_consents?subject_id=eq.${subId}&select=id`)
  expect(rows.length, '★再訪のたびに行が増えない').toBe(1)

  const st = await call('consent_state')
  expect(st.body.agreed, '2回目以降は同意済みとして扱う').toBe(true)
})

test('管理画面で「誰がいつ何に同意したか」を確認でき、文言を差し替えられる', async ({ page }) => {
  await call('consent_agree')
  await page.goto('/external-consents', { waitUntil: 'networkidle' })

  const row = page.getByTestId('consent-row').filter({ hasText: 'E2E同意業者' }).first()
  await expect(row, '★同意の記録が見える').toBeVisible({ timeout: 15000 })
  await expect(row, '種別が分かる').toContainText('協力業者ポータル')

  // 文言の差し替えができる（ACの「管理者が差し替え可能・版管理」）
  await expect(page.getByTestId('terms-text'), '文言を編集できる').toBeVisible()
  await expect(page.getByTestId('terms-version'), 'バージョンを編集できる').toBeVisible()
})

// ============================================================
//  ポータル画面のゲート（同意しないと先へ進めない）
//  ★ACの一番の要件。記録だけ作って画面が素通りでは契約を満たさない。
// ============================================================
test('★同意していない外部者はポータルの操作へ進めない', async ({ page }) => {
  // この業者の同意記録を消して「未同意」に戻す
  await restSrv(`external_consents?subject_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})

  await page.goto(`http://localhost:3000/p/${token}`, { waitUntil: 'networkidle' })

  const gate = page.getByTestId('consent-gate')
  await expect(gate, '★同意のゲートが出る').toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('consent-text'), '同意文言が表示される').not.toBeEmpty()
  // 業者登録フォームはまだ出ていない（＝先へ進めていない）
  await expect(page.locator('input, textarea').first(), '入力フォームは出していない').toHaveCount(0)

  await page.getByTestId('consent-agree').click()
  await expect(gate, '★同意すると先へ進める').toBeHidden({ timeout: 20000 })

  const rows = await restSrv(`external_consents?subject_id=eq.${subId}&select=id`)
  expect(rows.length, '画面から同意した記録が残る').toBe(1)
})
