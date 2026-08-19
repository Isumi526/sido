// ============================================================
//  supabase/functions/drawing-quantity-extract
//  実施図面の「凡例に書かれた確定数量」を抽出する（見積Q7）。
//
//  ★drawing-material-extract との違い（似ているが目的が別）:
//    - drawing-material-extract … 図面内の**メーカー品番**を拾う（何を使うか）
//    - 本EF                      … 凡例の**数量表**を拾う（どれだけ要るか）
//   実施図面を全数解析した結果、床/置床/天井の面積・建具/器具の台数・紙管の本数は
//   **設計者が凡例に明記している**（拾い直す必要がない）ことが分かったため。
//   例) 床 F-01 21.3㎡… 計67.4㎡ / 天井 C-01 6.5㎡… 計71.0㎡ / 紙管 C-05 51本
//
//  ★通り芯寸法も併せて取る: 天井合計 ≒ 通り芯面積 で**抽出値を自動検算**するため
//   （北新宿の実例: 天井71.0㎡ ≒ 10.2m×6.95m=70.9㎡）。検算は呼び出し側の
//   lib/drawingQuantity.ts で行う（純粋な計算なのでテストしやすい場所に置く）。
//
//  ★壁は対象外: 壁面積はどの表にも無い（仕様のみ）。壁は Q8 の計算機で扱う。
//  ★確定はしない: 抽出値は見積明細の**初期値**。人が確認・修正してから採用する。
//
//  認証: 呼び出し元 admin の JWT を検証し app_metadata.account_slug があることのみ確認
//       （Gemini API呼び出しコストの野良利用防止・drawing-material-extract と同型）。
//  env(本番secret): SUPABASE_URL / SUPABASE_ANON_KEY / GEMINI_API_KEY
//                   任意: DRAWING_EXTRACT_MODEL（既定 gemini-2.5-flash）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GEMINI_KEY   = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GEMINI_REVIEW_API_KEY') ?? ''
const MODEL        = Deno.env.get('DRAWING_EXTRACT_MODEL') ?? 'gemini-2.5-flash'

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

const PROMPT = `あなたは建築の実施図面を読み取る専門家です。添付画像は施工図面(PDFページ画像)です。
このページに「凡例」「仕上表」「数量表」があれば、そこに**明記されている数量**だけを転記してください。
★図面から自分で面積を計算してはいけません。書いてある数字だけを拾ってください。書いていなければ空にします。

出力はJSONのみ。形式:
{
  "parts": [
    { "part": "床|置床|天井|建具|器具|その他",
      "rows": [ { "code": "F-01 等の仕上げコード", "maker_code": "SX-FXCS-LED 等のメーカー品番。無ければ空", "spec": "仕様(タイルカーペット等)", "value": 21.3, "unit": "㎡|台|本|箇所", "note": "不確実なら要確認と記載" } ] }
  ],
  "gridSpanX": 通り芯の一方向の全長(m。例 10.2。読めなければ null),
  "gridSpanY": 通り芯のもう一方向の全長(m。例 6.95。読めなければ null),
  "ceilingHeights": ["CH=2400", "CH=2550"]
}

注意:
- ★**符号とメーカー品番は別物**。混ぜずにそれぞれの項目へ入れる。
  - code       … 設計者がこの図面の中だけで使う符号（F-01 / C-01 / AD-1 / WD-2）。図面が変われば意味が変わる
  - maker_code … メーカーが付けている品番（SX-FXCS-LED / DC-42-SIR-N / ModuleX 80 / SLP314）。どの図面でも同じものを指す
  見積では maker_code から定価・掛率を引くので、これを spec の文章に埋め込んだままにしないこと。
  凡例に品番が書かれていなければ maker_code は空にする（推測で書かない）。
- spec には maker_code を除いた仕様だけを入れる（材質・仕上げ・寸法・色など）。
- 面積は㎡、建具・器具は台、紙管など棒状のものは本を unit に入れる。図面の表記をそのまま使う。
- 合計行(「計」「合計」)は行として入れない。個別の行だけを入れる（合計はこちらで足す）。
- **壁の仕上げは対象外**。壁は面積が書かれていないので拾わない。
- 通り芯寸法は mm 表記(8900等)なら m に直して入れる(8.9)。全長が複数スパンに分かれている場合は合計する。
- このページに数量表が無ければ {"parts": [], "gridSpanX": null, "gridSpanY": null, "ceilingHeights": []} を返す。`

type QuantityRow = { code?: string; maker_code?: string | null; spec?: string | null; value?: number; unit?: string; note?: string | null }
type PartGroup = { part?: string; rows?: QuantityRow[] }
type Extracted = { parts?: PartGroup[]; gridSpanX?: number | null; gridSpanY?: number | null; ceilingHeights?: string[] | null }

async function geminiExtract(imageB64: string, mime: string): Promise<Extracted> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 未設定')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
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
    if (st === 429) throw new Error('AI(Gemini)の利用上限に達しました（鍵の月間予算上限）。AI Studioで上限を引き上げるか、時間をおいて再実行してください。')
    if (st === 503) throw new Error('AI(Gemini)が一時的に混雑しています。少し待って再実行してください。')
    throw new Error(`AI(Gemini)エラー(${st}): ${res ? (await res.text()).slice(0, 160) : 'no response'}`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  try { return JSON.parse(text) as Extracted } catch { throw new Error('Gemini 応答が JSON でない') }
}

const ALLOWED_PARTS = new Set(['床', '置床', '天井', '建具', '器具', 'その他'])

/** AI応答を素直に信じず、想定の形に正規化する（部位名の揺れ・数値以外を落とす） */
function normalize(x: Extracted): Extracted {
  const parts = (x.parts ?? [])
    .map((g) => ({
      part: ALLOWED_PARTS.has(String(g.part)) ? String(g.part) : 'その他',
      rows: (g.rows ?? [])
        .filter((r) => Number(r?.value) > 0)
        .map((r) => ({
          code: String(r.code ?? '').trim(),
          // ★空文字は null に寄せる。「無い」を1通りで表せないと、
          //  呼び出し側が '' と null の両方を毎回気にすることになる。
          maker_code: String(r.maker_code ?? '').trim() || null,
          spec: r.spec ? String(r.spec).trim() : null,
          value: Number(r.value),
          unit: String(r.unit ?? '㎡').trim() || '㎡',
          note: r.note ? String(r.note).trim() : null,
        })),
    }))
    .filter((g) => g.rows.length)
  const num = (v: unknown) => (Number(v) > 0 ? Number(v) : null)
  return {
    parts,
    gridSpanX: num(x.gridSpanX),
    gridSpanY: num(x.gridSpanY),
    ceilingHeights: Array.isArray(x.ceilingHeights) ? x.ceilingHeights.map(String).slice(0, 10) : [],
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const { image_base64, mime, page } = body ?? {}
  if (!image_base64 || !mime) return json({ error: 'image_base64 と mime は必須' }, 400)

  // 認証: 呼び出し元 admin の JWT を検証（account_slugを持つ=正規admin）
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return json({ error: 'unauthorized' }, 401)
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData } = await cli.auth.getUser()
  const slug = (userData?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
  if (!slug) return json({ error: 'unauthorized' }, 401)

  try {
    const raw = await geminiExtract(image_base64, mime)
    return json({ ok: true, page: page ?? null, ...normalize(raw) })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
