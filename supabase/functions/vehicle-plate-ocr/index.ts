// ============================================================
//  supabase/functions/vehicle-plate-ocr
//  車両画像からナンバープレートを AI(Gemini vision) で解析して返す（#9）。
//   - 入力: { account_slug, image_base64, mime }（画像はbase64直渡し・保存不要）
//   - 出力: { ok, plate_number }（読めなければ plate_number=null）
//   - 解析結果は返すだけ＝自動でDBには書かない。admin 画面が入力欄へ prefill し、
//     人が確認・手動修正してから保存する（誤読対策）。
//   認証: 呼び出し元 admin の JWT を検証し app_metadata.account_slug == 指定account のみ許可。
//   env(本番secret): SUPABASE_URL / SUPABASE_ANON_KEY / GEMINI_API_KEY
//                    任意: VEHICLE_OCR_MODEL（既定 gemini-2.5-flash）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GEMINI_KEY   = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GEMINI_REVIEW_API_KEY') ?? ''
const OCR_MODEL    = Deno.env.get('VEHICLE_OCR_MODEL') ?? 'gemini-2.5-flash'

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

const PROMPT = `添付画像は日本の自動車のナンバープレートが写った写真です。
プレートの文字を読み取り、JSON のみで出力してください。
出力形式: {"plate_number": "地域名 分類番号 ひらがな 一連指定番号"}（例: {"plate_number": "品川 500 あ 12-34"}）
ルール:
- 4桁の一連指定番号はハイフン区切り（例 12-34、1桁なら ・1、末尾寄せ）で、読めた通りに。
- 地域名・分類番号・ひらがな・一連番号の間は半角スペース1つで区切る。
- プレートが写っていない/判読不能なら {"plate_number": null} を返す。
- 憶測で埋めない。確実に読めた部分だけを出す（読めない部分は空でよいが、全く読めなければ null）。`

async function geminiPlate(imageB64: string, mime: string): Promise<string | null> {
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
    if (st === 429) throw new Error('AI(Gemini)の利用上限に達しました。時間をおいて再試行してください。')
    if (st === 503) throw new Error('AI(Gemini)が一時的に混雑しています。少し待って再試行してください。')
    throw new Error(`AI(Gemini)エラー(${st})`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
  try {
    const obj = JSON.parse(text)
    const plate = (obj?.plate_number ?? '').toString().trim()
    return plate || null
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const { account_slug, image_base64, mime } = body ?? {}
  if (!account_slug) return json({ error: 'account_slug は必須' }, 400)
  if (!image_base64) return json({ error: '画像がありません' }, 400)

  // ── 認証: 呼び出し元 admin の JWT を検証し、自account のみ許可 ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: '認証が必要です' }, 401)
  const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userErr } = await authClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'トークン不正' }, 401)
  const userSlug = (userData.user.app_metadata as any)?.account_slug
  if (!userSlug || userSlug !== account_slug) return json({ error: '権限がありません（account不一致）' }, 403)

  try {
    const plate = await geminiPlate(image_base64, mime || 'image/jpeg')
    return json({ ok: true, plate_number: plate })
  } catch (e) {
    return json({ error: String((e as Error).message) }, 502)
  }
})
