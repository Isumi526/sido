// ============================================================
//  supabase/functions/estimate-quote-ocr
//  【見積R44】下請から受領した「見積書」PDFを読み取って受領明細の下書きにする
//
//  ★estimate-price-ocr（商社の価格表OCR）との違い（似ているが対象文書が別）:
//    - estimate-price-ocr … 商社の**価格表**を読み、material_prices の差分(pending)を作る
//    - 本EF              … 下請の**見積書**を読み、相見積の**受領明細の下書き**を返す
//   R5で見積書は添付保存できるようになったが、単価は今も手打ちだった。
//   取り込み先が違う（価格表→単価マスタ / 見積書→受領明細）ので価格表OCRでは代替できない。
//
//  ★DBには一切書かない。返すのは下書きだけで、確定は人が画面で承認してから
//   既存の「保存（単価履歴に記録）」を通す（価格表OCRと同じ「承認した分だけ反映」の原則）。
//
//  ★単価の区分(price_kind)も読む: 材工共/労務のみ/材料のみ は業者ごとに意味が違い、
//   揃えずに横並びすると誤選定する。読めなければ null にして人に選ばせる。
//
//  認証: 呼び出し元 admin の JWT を検証し app_metadata.account_slug があることのみ確認
//       （Gemini APIコストの野良利用防止・drawing-material-extract と同型）。
//  env(本番secret): SUPABASE_URL / SUPABASE_ANON_KEY / GEMINI_API_KEY
//                   任意: ESTIMATE_OCR_MODEL（既定 gemini-2.5-flash）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GEMINI_KEY   = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GEMINI_REVIEW_API_KEY') ?? ''
const OCR_MODEL    = Deno.env.get('ESTIMATE_OCR_MODEL') ?? 'gemini-2.5-flash'

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

const PROMPT = `あなたは建設業の見積書を読み取る専門家です。添付画像は下請業者から受領した見積書です。
明細行を全て抜き出して JSON で返してください。出力はJSONのみ。

形式:
{"lines":[{"item_name":"項目名","spec":"形状・詳細（あれば）","unit":"単位(㎡/m/式/箇所など)",
"quantity":数量(数値・無ければnull),"unit_price":単価(数値・円。無ければnull),
"price_kind":"material_labor|labor|material|null","note":"不確実なら要確認"}]}

注意:
- **単価は「単価」列の値**。合計金額や小計を単価として入れない。
- 「一式」「式」の行も拾う（数量1・単位「式」として扱う）。
- **合計・小計・値引き・消費税・諸経費の行は明細に含めない**（項目ではないため）。
- price_kind は見積書の表記から判断する: 「材工共」「材工とも」→material_labor /
  「労務」「手間のみ」→labor / 「材料のみ」「材工分離の材料」→material。
  判断できなければ null（人が選ぶ）。**勝手に決めない**。
- 数量・単価が読めない行も item_name だけで返す（人が埋める）。値は null にする。
- 明細が1行も無ければ {"lines":[]} を返す。`

type Line = {
  item_name?: string; spec?: string | null; unit?: string | null
  quantity?: number | null; unit_price?: number | null
  price_kind?: string | null; note?: string | null
}

const KINDS = new Set(['material_labor', 'labor', 'material'])

async function geminiRead(imageB64: string, mime: string): Promise<Line[]> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 未設定')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent`
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: imageB64 } }] }],
    generationConfig: { temperature: 0, response_mime_type: 'application/json' },
  })
  let res: Response | null = null
  for (let i = 0; i < 4; i++) {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body })
    if (res.status !== 503) break
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
  }
  if (!res || !res.ok) {
    const st = res?.status
    if (st === 429) throw new Error('AI(Gemini)の利用上限に達しました。時間をおいて再実行してください。')
    if (st === 503) throw new Error('AI(Gemini)が一時的に混雑しています。少し待って再実行してください。')
    throw new Error(`AI(Gemini)エラー(${st}): ${res ? (await res.text()).slice(0, 160) : 'no response'}`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"lines":[]}'
  let parsed: { lines?: Line[] }
  try { parsed = JSON.parse(text) } catch { throw new Error('Gemini 応答が JSON でない') }
  return Array.isArray(parsed?.lines) ? parsed.lines : []
}

/** AI応答を素直に信じず、受領明細に入れられる形へ正規化する */
function normalize(lines: Line[]): Line[] {
  const num = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))
  return lines
    .map((l) => ({
      item_name: String(l.item_name ?? '').trim(),
      spec: l.spec ? String(l.spec).trim() : null,
      unit: l.unit ? String(l.unit).trim() : null,
      quantity: num(l.quantity),
      unit_price: num(l.unit_price),
      // 区分は決め打ちしない。想定外の値が来たら null にして人に選ばせる
      price_kind: KINDS.has(String(l.price_kind)) ? String(l.price_kind) : null,
      note: l.note ? String(l.note).trim() : null,
    }))
    .filter((l) => l.item_name)   // 項目名が無い行は使えない
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const { image_base64, mime, page } = body ?? {}
  if (!image_base64 || !mime) return json({ error: 'image_base64 と mime は必須' }, 400)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return json({ error: 'unauthorized' }, 401)
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData } = await cli.auth.getUser()
  const slug = (userData?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
  if (!slug) return json({ error: 'unauthorized' }, 401)

  try {
    return json({ ok: true, page: page ?? null, lines: normalize(await geminiRead(image_base64, mime)) })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
