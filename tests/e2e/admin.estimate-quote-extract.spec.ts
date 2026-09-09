// ============================================================
//  admin.estimate-quote-extract.spec.ts
//  見積書PDFから明細を読み取って単価履歴に溜める（2026-09-10）
//
//  ★なぜ要るか（実データ調査で分かったこと）
//   本番の estimates（見積書 受領）は総額とPDFしか持てず、明細を持てる
//   estimate_quote_lines は手入力しか経路が無いため **0行** だった。
//   ＝ 機能はあるのに入力コストが釣り合わず、単価履歴が溜まっていなかった。
//   10〜15社ぶんを毎回手で打つ運用は続かないので、PDFから読む。
//
//  ★このspecが固定すること（どれも実際に踏んだ落とし穴）
//   1. 商社の書類は取り込まない
//      同じ画面に商社の資材価格表（吉野石膏の新単価表）も登録されている。
//      混ぜると「ボード560円/枚」が作業の単価候補に出る。
//   2. 諸経費・運搬費などは取り込まない
//      作業の単価ではないので候補に出ると邪魔になる。
//   3. 受け皿の案件に紐づける
//      estimate_quote_requests.project_id は NOT NULL で、さらに
//      estimate_price_history ビューが estimate_projects と内部結合している。
//      案件に紐づけないと **履歴ビューに出てこない＝候補に出ない**。
//   4. 他テナントの見積書は読み取れない
//
//  ※ Gemini を呼ぶ本体（PDF→明細）はAPIキーと外部通信が要るため、
//    ここでは呼ばない。キーが無い環境でも回る範囲を固定する。
//    実データでの抽出精度は手動で確認した（名西商店の見積書＝23明細・3工種）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const VENDOR_TRADE = `E2E業者_${TS}`
const VENDOR_SHOSHA = `E2E商社_${TS}`

let ctx: { accountId: string; tradeId: string; shoshaId: string; estTrade: string; estShosha: string } | null = null

/** 画面と同じ経路でEFを呼ぶ（admin のセッションを使う）。 */
async function callExtract(page: any, estimateId: string) {
  return page.evaluate(async ([url, key, id]: string[]) => {
    const sb = (await import('/src/lib/supabase.ts')).supabase
    const { data: { session } } = await sb.auth.getSession()
    const res = await fetch(`${url}/functions/v1/estimate-quote-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${session!.access_token}` },
      body: JSON.stringify({ estimate_id: id }),
    })
    return { status: res.status, body: await res.json() }
  }, [SUPABASE_URL, ANON_KEY, estimateId])
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const [t] = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: VENDOR_TRADE, active: true, category: '業者' }),
  })
  const [s] = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: VENDOR_SHOSHA, active: true, category: '商社' }),
  })
  const mk = async (subId: string, label: string, withPdf: boolean) => {
    const [e] = await restSrv('estimates', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, subcontractor_id: subId,
        estimate_number: `E2E-${label}-${TS}`, estimate_date: '2026-06-15',
        pdf_path: withPdf ? `${accountId}/estimates/e2e_${label}_${TS}.pdf` : null,
        pdf_bucket: withPdf ? 'admin-docs' : null,
      }),
    })
    return e.id as string
  }
  ctx = {
    accountId, tradeId: t.id, shoshaId: s.id,
    estTrade: await mk(t.id, 'trade', true),
    estShosha: await mk(s.id, 'shosha', true),
  }
})

test.afterAll(async () => {
  if (!ctx) return
  await restSrv(`estimate_quote_lines?account_id=eq.${ctx.accountId}&item_name=like.E2E*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimates?estimate_number=like.E2E-*${TS}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=in.(${ctx.tradeId},${ctx.shoshaId})`, { method: 'DELETE' }).catch(() => {})
})

test.describe('見積書からの明細抽出', () => {
  test('★商社の書類は取り込まない（資材の価格表が作業の候補に混ざるため）', async ({ page }) => {
    await page.goto('/estimates', { waitUntil: 'networkidle' })
    const r = await callExtract(page, ctx!.estShosha)
    expect(r.status).toBe(200)
    expect(r.body.skipped, '商社として弾く').toBe('trading_company')
    expect(r.body.inserted).toBe(0)
    // ★Geminiを呼ぶ前に弾いていること（無駄な課金と待ち時間を避ける）
  })

  test('★PDFが付いていない見積書は明細を作らない', async ({ page }) => {
    const accountId = ctx!.accountId
    const [e] = await restSrv('estimates', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, subcontractor_id: ctx!.tradeId,
        estimate_number: `E2E-nopdf-${TS}`, estimate_date: '2026-06-15',
      }),
    })
    await page.goto('/estimates', { waitUntil: 'networkidle' })
    const r = await callExtract(page, e.id)
    expect(r.body.error).toBe('pdf_not_attached')
    await restSrv(`estimates?id=eq.${e.id}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★公開キーだけでは呼べない（単価は営業上の機密）', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/estimate-quote-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ estimate_id: ctx!.estTrade }),
    })
    expect([401, 403]).toContain(res.status)
  })

  test('★他テナントの見積書は読み取れない', async ({ page }) => {
    // 別アカウントを作り、その見積書のIDを渡す
    const [other] = await restSrv('accounts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ slug: `e2e-other-${TS}`, name: `E2E別会社_${TS}` }),
    })
    const [sub] = await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: other.id, name: `E2E他社業者_${TS}`, active: true, category: '業者' }),
    })
    const [e] = await restSrv('estimates', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: other.id, subcontractor_id: sub.id,
        estimate_number: `E2E-other-${TS}`, estimate_date: '2026-06-15',
        pdf_path: `${other.id}/estimates/x.pdf`, pdf_bucket: 'admin-docs',
      }),
    })
    await page.goto('/estimates', { waitUntil: 'networkidle' })
    const r = await callExtract(page, e.id)
    expect(r.body.error, '他社の見積書は見つからない扱い').toBe('estimate_not_found')

    await restSrv(`estimates?id=eq.${e.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${sub.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`accounts?id=eq.${other.id}`, { method: 'DELETE' }).catch(() => {})
  })
})
