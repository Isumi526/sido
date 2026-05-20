// ============================================================
//  analyze-receipt
//  領収書画像を Gemini で解析して JSON を返す
//
//  POST body:
//    { imageBase64: "data:image/jpeg;base64,...", category?: string }
//
//  Response:
//    { label: string|null, yen: number|null, invoiceNumber: string|null }
// ============================================================

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    console.log('[analyze-receipt] start')
    const { imageBase64 } = await req.json() as { imageBase64: string }
    if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400)

    // data:image/jpeg;base64,xxx → mimeType + data を分離
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return json({ error: 'Invalid image format' }, 400)
    const [, mimeType, base64Data] = match

    const prompt = `この領収書・レシート・請求書の画像から以下の情報を抽出してください。
必ずJSON形式のみで返してください。説明文は不要です。

{
  "label": "店名・施設名・商品名・サービス名（なければnull）",
  "yen": 合計金額（数値、税込、円、不明ならnull）,
  "invoiceNumber": "インボイス登録番号（T+13桁の数字形式、なければnull）"
}`

    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Data } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
      },
    }

    // 503 時は最大3回リトライ
    let res: Response | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok || res.status !== 503) break
      console.warn(`[Gemini] 503 attempt ${attempt}/3, retrying...`)
      await new Promise(r => setTimeout(r, attempt * 1000))
    }

    if (!res!.ok) {
      const err = await res!.text()
      console.error('[Gemini] error status:', res!.status, 'body:', err)
      return json({ error: 'Gemini API error', detail: err }, 502)
    }

    const data = await res!.json() as any
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    console.log('[Gemini] raw text:', text.slice(0, 200))

    // JSON部分を抽出（```json ... ``` が含まれる場合にも対応）
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return json({ label: null, yen: null, invoiceNumber: null })

    const result = JSON.parse(jsonMatch[0]) as {
      label: string | null
      yen: number | null
      invoiceNumber: string | null
    }

    return json({
      label:         result.label ?? null,
      yen:           result.yen != null ? Number(result.yen) : null,
      invoiceNumber: result.invoiceNumber ?? null,
    })
  } catch (e) {
    console.error('[analyze-receipt]', e)
    return json({ error: String(e) }, 500)
  }
})
