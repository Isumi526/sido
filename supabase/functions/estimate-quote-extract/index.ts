// ============================================================
//  estimate-quote-extract
//  下請けから受け取った見積書PDFから明細を読み取り、単価履歴に溜める。
//
//  ★何のためか（2026-07-26 打ち合わせ②／2026-09-10 実データ調査）
//   見積で一番工数がかかっているのは「この作業をこの業者に頼んだらいくらか」を
//   過去の見積書から探す作業。大塚さん本人の言葉:
//     「GenlinkにPDFで返してもらうたら、Genlinkが自動で業者の見積書を暗記してくれる」
//   本番の estimates には総額とPDFしか無く（実測3件・うち1件は総額も空）、
//   明細を持てる estimate_quote_lines は手入力しか経路が無いため0行だった。
//   ＝ 機能はあるのに入力コストが釣り合わず、履歴が溜まっていなかった。
//   PDFから読み取ればその断絶が埋まる。
//
//  ★実データで確認済み（2026-09-10）
//   本番3件ともテキスト層があり OCR は不要。名西商店の見積書は
//     「1.LGS工事 → 天井下地組 ｗ19型 149.8㎡ 1,650」
//   のように工種見出し付きの明細で、そのまま単価履歴に落とせる形だった。
//
//  ★商社は対象外にする。
//   同じ「見積書（受領）」に商社の資材価格表（吉野石膏の新単価表など）も
//   登録されている。混ぜると「ボード560円/枚」が作業の候補として出てしまう。
//   subcontractors.category='商社' は取り込まない。
//
//  ※ verify_jwt=false で deploy（他のEFと同様に関数内で認可する）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

const PROMPT = `あなたは内装工事の見積書を読む担当者です。
この見積書PDFから「明細」を抜き出し、JSONだけを返してください。説明文は不要です。

{
  "is_material_price_list": false,
  "lines": [
    { "trade": "LGS工事", "item_name": "天井下地組", "spec": "ｗ19型 JIS材",
      "quantity": 149.8, "unit_code": "SQM", "unit_raw": "㎡", "unit_price": 1650, "amount": 247170 }
  ]
}

規則:
- item_name は作業の名前だけ。仕様や寸法は spec へ分ける
- trade は「1.LGS工事」「2.PB工事」のような見出しがあればその名前（番号は除く）。無ければ null
- unit_price は1単位あたりの金額（税抜）。整数
- 小計・合計・消費税の行は含めない
- 端数調整・値引きの行は含めない
- ★単位は必ず unit_code（下の記号のどれか1つ）で返すこと。
  文字をそのまま返すと ㎡ が m に潰れて「面積が長さ」になり、
  次に見積もる時の数量の判断が狂う。
    SQM=平米(㎡)  M=メートル(m,ｍ)  SET=式  MANDAY=人工  PIECE=本
    SHEET=枚  UNIT=台  SPOT=箇所/カ所  TSUBO=坪  KG=kg  OTHER=それ以外
  unit_raw には書類上の表記をそのまま入れる（OTHER の時に使う）
- ★次の行は含めない（作業の単価ではないため、単価の候補に出ると邪魔になる）:
  諸経費 / 資材搬入費 / 資材運搬費 / 副資材 / 消耗品 / 現場管理費 / 出張費 /
  値引き / 端数調整 / 小計 / 合計 / 消費税
- 「一式」の作業行は含めてよい（上の除外に当たらないもの）
- ★この書類が工事の見積書ではなく「資材の価格表・単価表」（品番と定価が並ぶだけで
  工事の数量が無いもの）の場合は is_material_price_list を true にし、lines は空配列にする`

/** 作業の単価ではない行（候補に出ると邪魔になる）。AIが取りこぼした分をここでも落とす。 */
const NON_WORK = /諸経費|現場管理費|資材(搬入|運搬)|運搬費|副資材|消耗品|出張|値引|端数|小計|合計|消費税/

type Line = {
  trade: string | null; item_name: string; spec: string | null
  quantity: number | null; unit_code: string | null; unit_raw: string | null
  unit_price: number | null; amount: number | null
}

/** ★AIは ㎡ を m に正規化してしまうため、記号で受け取って我々が戻す。 */
const UNIT_BY_CODE: Record<string, string> = {
  SQM: '㎡', M: 'm', SET: '式', MANDAY: '人工', PIECE: '本',
  SHEET: '枚', UNIT: '台', SPOT: '箇所', TSUBO: '坪', KG: 'kg',
}
function resolveUnit(l: Line): string | null {
  const code = (l.unit_code ?? '').toUpperCase()
  if (UNIT_BY_CODE[code]) return UNIT_BY_CODE[code]
  const raw = (l.unit_raw ?? '').trim()
  return raw ? raw.slice(0, 20) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  const estimateId = typeof body.estimate_id === 'string' ? body.estimate_id : ''
  if (!estimateId) return json({ ok: false, error: 'estimate_id_required' }, 400)

  // ── 認可：管理画面(authenticated)の呼び出しだけ通す ──
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth || auth.endsWith(ANON_KEY)) return json({ ok: false, error: 'unauthorized' }, 401)
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: au } = await cli.auth.getUser()
  const slug = ((au?.user?.app_metadata ?? {}) as Record<string, unknown>).account_slug as string | undefined
  if (!slug) return json({ ok: false, error: 'unauthorized' }, 401)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
  const accountId = (acct as { id?: string } | null)?.id
  if (!accountId) return json({ ok: false, error: 'unauthorized' }, 401)

  // ── 対象の見積書。★呼び出し元のアカウントのものだけ ──
  const { data: est } = await svc.from('estimates')
    .select('id, account_id, subcontractor_id, estimate_date, pdf_path, pdf_bucket')
    .eq('id', estimateId).eq('account_id', accountId).maybeSingle()
  if (!est) return json({ ok: false, error: 'estimate_not_found' }, 404)
  const e = est as Record<string, unknown>
  if (!e.pdf_path) return json({ ok: false, error: 'pdf_not_attached' }, 400)

  // ── 商社は取り込まない（資材の価格表が作業の候補に混ざるため）──
  const { data: sub } = await svc.from('subcontractors')
    .select('id, name, category').eq('id', e.subcontractor_id as string).maybeSingle()
  const vendor = sub as { name?: string; category?: string } | null
  if (vendor?.category === '商社') {
    return json({ ok: true, skipped: 'trading_company', message: '商社の書類は単価履歴に取り込みません（資材の価格表のため）', inserted: 0 })
  }

  if (!GEMINI_API_KEY) return json({ ok: false, error: 'gemini_key_missing' }, 500)

  // ── PDFを取得して Gemini へ ──
  const bucket = (e.pdf_bucket as string) || 'expense-receipts'
  const { data: file, error: dlErr } = await svc.storage.from(bucket).download(e.pdf_path as string)
  if (dlErr || !file) return json({ ok: false, error: 'pdf_download_failed', detail: dlErr?.message }, 400)
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  const base64Data = btoa(bin)

  let parsed: { is_material_price_list?: boolean; lines?: Line[] } | null = null
  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType: 'application/pdf', data: base64Data } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    })
    if (!res.ok) return json({ ok: false, error: 'gemini_failed', detail: (await res.text()).slice(0, 300) }, 502)
    const j = await res.json()
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    parsed = JSON.parse(text)
  } catch (err) {
    return json({ ok: false, error: 'parse_failed', detail: String(err).slice(0, 200) }, 502)
  }

  if (parsed?.is_material_price_list) {
    return json({ ok: true, skipped: 'material_price_list', message: '資材の価格表と判定したため取り込みませんでした', inserted: 0 })
  }
  const lines = (parsed?.lines ?? []).filter((l) =>
    l && l.item_name && (l.unit_price ?? 0) > 0 && !NON_WORK.test(l.item_name))
  if (!lines.length) return json({ ok: true, inserted: 0, message: '明細を読み取れませんでした' })

  // ── 単価履歴の器（estimate_quote_requests/_lines）へ落とす ──
  //  ★履歴の出所は estimate_price_history ビューで、その土台がこの2表。
  //   見積書1通につき依頼1件を対応させる（プロジェクトは任意）。
  const quotedOn = (e.estimate_date as string) || new Date().toISOString().slice(0, 10)

  // ★受け皿の案件を1つだけ用意する。
  //  estimate_quote_requests.project_id は NOT NULL で、しかも
  //  estimate_price_history ビューが estimate_projects と**内部結合**している。
  //  案件に紐づけないと履歴ビューに出てこない＝単価候補に出ない。
  //  受領した見積書は必ずしも見積案件に紐づかないので、専用の入れ物へ集める。
  const HOLDER = '受領見積の取り込み'
  let projectId: string | null = null
  {
    const { data: p } = await svc.from('estimate_projects')
      .select('id').eq('account_id', accountId).eq('name', HOLDER).maybeSingle()
    projectId = (p as { id?: string } | null)?.id ?? null
    if (!projectId) {
      const { data: np, error: pErr } = await svc.from('estimate_projects')
        .insert({ account_id: accountId, name: HOLDER, status: 'draft',
                  note: '見積書（受領）から自動で読み取った明細の置き場です。手で編集しないでください。' })
        .select('id').single()
      if (pErr) return json({ ok: false, error: 'holder_project_failed', detail: pErr.message }, 500)
      projectId = (np as { id: string }).id
    }
  }

  const { data: req0, error: reqErr } = await svc.from('estimate_quote_requests')
    .insert({
      account_id: accountId,
      project_id: projectId,
      subcontractor_id: e.subcontractor_id,
      trade_name: lines.find((l) => l.trade)?.trade ?? null,
      requested_at: quotedOn, received_at: quotedOn,
      note: `見積書から自動抽出（estimates:${estimateId}）`,
    })
    .select('id').single()
  if (reqErr) return json({ ok: false, error: 'request_insert_failed', detail: reqErr.message }, 500)
  const requestId = (req0 as { id: string }).id

  const rows = lines.map((l) => ({
    account_id: accountId,
    request_id: requestId,
    item_name: String(l.item_name).trim().slice(0, 200),
    spec: l.spec ? String(l.spec).trim().slice(0, 200) : null,
    unit: resolveUnit(l),
    quantity: l.quantity ?? null,
    unit_price: Math.round(Number(l.unit_price)),
    is_selected: false,
  }))
  const { error: linesErr } = await svc.from('estimate_quote_lines').insert(rows)
  if (linesErr) return json({ ok: false, error: 'lines_insert_failed', detail: linesErr.message }, 500)

  return json({
    ok: true, inserted: rows.length, request_id: requestId,
    vendor: vendor?.name ?? null, quoted_on: quotedOn,
    trades: [...new Set(lines.map((l) => l.trade).filter(Boolean))],
  })
})
