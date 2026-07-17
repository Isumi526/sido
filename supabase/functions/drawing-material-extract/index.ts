// ============================================================
//  supabase/functions/drawing-material-extract
//  実施図面から材料情報を抽出(vision-LLM＝Gemini マルチモーダル)。
//   - 施工図面(PDF各ページ画像/写真)をGeminiで読み取り、記載されているメーカー品番を
//     全て抽出して構造化JSONで返す(見積/工程表への反映は本EFではしない＝人が確認してから)。
//   - DB永続化はしない(その場で抽出→admin画面で確認・CSV書き出しのみ＝要件化回答A)。
//   - 規格サイズが読み取れなかった品番は、Gemini google_search グラウンディングで
//     Web検索し規格サイズ＋出典URLを自動で埋める(2026-07-16要件化回答A)。
//     ※Gemini APIはtools(google_search)とresponse_mime_type:jsonを同時指定できないため、
//       画像からの構造化抽出とは別のテキストのみの追加呼び出しとして行う。
//   認証: 呼び出し元 admin の JWT を検証し app_metadata.account_slug があることのみ確認
//        (Gemini API呼び出しコストの野良利用防止・estimate-price-ocrと同型)。
//   env(本番secret): SUPABASE_URL / SUPABASE_ANON_KEY / GEMINI_API_KEY
//                    任意: DRAWING_EXTRACT_MODEL（既定 gemini-2.5-flash）
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

type ExtractedRow = {
  part?: string | null; manufacturer?: string | null; code?: string | null
  size?: string | null; spec?: string | null; quantity?: string | null; note?: string | null
  sizeSourceUrl?: string | null
}

const PROMPT = `あなたは建築の実施図面を読み取る専門家です。添付画像は施工図面(PDFページ画像)です。
図面内に記載されているメーカー品番を全て見つけて、JSON配列で出力してください。出力はJSONのみ。
各要素: {"part": 部位, "manufacturer": メーカー名(例: 3M, 東リ, 日塗工),
"code": 品番(例: PW-2323MT, WRW8285), "size": 規格サイズ(例: 190×190×95), "spec": 仕様(例: 艶消し・トップコート仕様・不燃PB等),
"quantity": 数量(図面内の数量欄・集計表・凡例に記載があればその数値と単位をそのまま転記。例: "12枚","25m²","3箇所"),
"note": 備考(読み取れない/不確実な項目があれば"不明"や"要確認"とここに記載)}

part(部位)の判定ルール(最重要・精度が低くなりやすいため厳守):
- 図面内に仕上表・凡例表(部位×仕上げのマトリクス表)がある場合は必ずそれを最優先で参照し、各品番がその表のどの行/列(部位)に属するかで判定する。図中の吹き出しや引き出し線の位置だけで推測しない。
- 部位の表記は図面の見出し・略号にできるだけ合わせて具体的に書く(例: "天井"ではなく図面が"EPS天井"と区別していれば"EPS天井"。"壁"ではなく"腰壁"/"幅木"/"建具枠"等を図面の区分どおりに)。
- 迷ったら一般カテゴリ(壁/床/天井/建具/ガラス/幅木/什器/外構等)に丸めてよいが、その場合はnoteに「仕上表の区分不明のため一般カテゴリで代用」と明記する。

quantity(数量)の判定ルール:
- 数量は図面の集計表・凡例の数量欄にある値のみを転記する(見た目から個数を目算・推測しない)。
- 数量欄が無い/読み取れない場合はquantityを空文字にし、noteに「数量不明」を追記する。

共通ルール:
- 品番が読み取れない・自信が無い項目は空文字ではなくnoteに「不明」「要確認」と明記する(隠さず必ず候補として出す)。
- 図面内に表(凡例・仕上表)がある場合はそこを優先して読む。
- メーカー品番が1件も見つからなければ空配列[]を返す。`

async function geminiExtract(imageB64: string, mime: string): Promise<ExtractedRow[]> {
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
  let rows: ExtractedRow[]
  try { rows = JSON.parse(text) } catch { throw new Error('Gemini 応答が JSON でない') }
  return Array.isArray(rows) ? rows : []
}

// 規格サイズが不明な品番をGemini google_search グラウンディングでWeb検索し、規格サイズ＋出典URLを返す。
// 見つからない/エラー時はnullを返す(呼び出し側で「不明」のまま扱う＝致命的エラーにしない)。
async function geminiLookupSize(manufacturer: string, code: string): Promise<{ size: string; sourceUrl: string } | null> {
  if (!GEMINI_KEY) return null
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
  const prompt = `建材製品「メーカー: ${manufacturer} / 品番: ${code}」の規格サイズ(寸法)をWeb検索で調べてください。
見つかった場合は次の2行のみを出力してください（他の説明文は不要）:
規格サイズ: <サイズ>
出典URL: <URL>
見つからない場合は「不明」とだけ出力してください。`
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0 },
  })
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body })
  } catch { return null }
  if (!res.ok) return null
  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const text: string = parts.map((p: any) => p?.text ?? '').join('')
  const sizeMatch = text.match(/規格サイズ[:：]\s*(.+)/)
  if (!sizeMatch?.[1]?.trim()) return null
  let sourceUrl = text.match(/出典URL[:：]\s*(\S+)/)?.[1] ?? ''
  if (!sourceUrl) {
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    sourceUrl = chunks.find((c: any) => c?.web?.uri)?.web?.uri ?? ''
  }
  return { size: sizeMatch[1].trim(), sourceUrl }
}

// rows中「規格サイズ不明」な品番についてgeminiLookupSizeで補完する(同一メーカー+品番はページ内で1回のみ検索)。
async function fillUnknownSizes(rows: ExtractedRow[]): Promise<void> {
  const cache = new Map<string, { size: string; sourceUrl: string } | null>()
  for (const r of rows) {
    const sizeUnknown = !r.size?.trim() || /不明/.test(r.size)
    if (!sizeUnknown || !r.manufacturer?.trim() || !r.code?.trim()) continue
    const key = `${r.manufacturer.trim()}|${r.code.trim()}`
    if (!cache.has(key)) {
      try { cache.set(key, await geminiLookupSize(r.manufacturer, r.code)) } catch { cache.set(key, null) }
    }
    const found = cache.get(key)
    if (found) {
      r.size = found.size
      r.sizeSourceUrl = found.sourceUrl || null
      r.note = r.note ? `${r.note} / AI Web調査による規格サイズ` : 'AI Web調査による規格サイズ'
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const { image_base64, mime, page } = body ?? {}
  if (!image_base64 || !mime) return json({ error: 'image_base64 と mime は必須' }, 400)

  // 認証: 呼び出し元 admin の JWT を検証（account_slugを持つ=正規admin）。estimate-price-ocrと同型。
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return json({ error: 'unauthorized' }, 401)
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData } = await cli.auth.getUser()
  const slug = (userData?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
  if (!slug) return json({ error: 'unauthorized' }, 401)

  try {
    const rows = await geminiExtract(image_base64, mime)
    await fillUnknownSizes(rows)
    return json({ ok: true, page: page ?? null, rows })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
