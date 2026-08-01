// ============================================================
//  analyze-receipt
//  領収書画像を Gemini で解析して JSON を返す
//
//  POST body:
//    { imageBase64: "data:image/jpeg;base64,...", category?: string }
//
//  Response:
//    { label: string|null, yen: number|null, invoiceNumber: string|null, liters: number|null }
// ============================================================

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = 'gemini-2.5-flash'
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
  "storeName": "支払い先＝発行元の店名・会社名・施設名（領収書を発行した事業者名。例: 東日本旅客鉄道株式会社、東日本高速道路、タイムズ24、〇〇損保。なければnull）",
  "label": "内容・品名・サービス名（電車・鉄道・乗車券なら乗車区間を『A〜B』の形式で／駐車なら『駐車料金』等の内容。発行元名ではなく“何の代金か”。なければnull）",
  "yen": 合計金額（数値、税込、円、不明ならnull）,
  "invoiceNumber": "インボイス登録番号（T+13桁の数字形式、なければnull）",
  "liters": 給油量（ガソリン/軽油の領収書の場合のみ数値でリットル数。給油以外の領収書、または記載が無い/読み取れない場合はnull）,
  "account": "勘定科目。次の7つのいずれか厳密に1つだけを返す: 旅費交通費 / 車両費 / 消耗品費 / 材料費 / 接待交際費 / 会議費 / 雑費。判断できない場合は必ずnull（勝手に別の名称を作らない）。目安: 飲食店・居酒屋・料亭=接待交際費、カフェ・喫茶・貸会議室=会議費、ホームセンター・工具・建築資材=材料費、文具・日用品=消耗品費、鉄道・バス・タクシー・駐車・高速・宿泊=旅費交通費、給油・洗車・車検=車両費"
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
    if (!jsonMatch) return json({ label: null, yen: null, invoiceNumber: null, liters: null })

    const result = JSON.parse(jsonMatch[0]) as {
      storeName: string | null
      label: string | null
      yen: number | null
      invoiceNumber: string | null
      liters: number | null
      account: string | null
    }

    // 勘定科目は7つの固定値以外を通さない（表記揺れが入ると科目でフィルタ/集計できなくなる）。
    //  一覧の正本は shared/expense-flatten.ts の EXPENSE_ACCOUNT_OPTIONS。
    //  ※EFはDenoで shared/ を import しないため、ここだけは値を写している（増減時は両方直す）。
    const ACCOUNTS = ['旅費交通費', '車両費', '消耗品費', '材料費', '接待交際費', '会議費', '雑費']
    const account = typeof result.account === 'string' && ACCOUNTS.includes(result.account.trim())
      ? result.account.trim()
      : null

    return json({
      storeName:     result.storeName ?? null,
      label:         result.label ?? null,
      yen:           result.yen != null ? Number(result.yen) : null,
      invoiceNumber: result.invoiceNumber ?? null,
      liters:        result.liters != null ? Number(result.liters) : null,
      account,
    })
  } catch (e) {
    console.error('[analyze-receipt]', e)
    return json({ error: String(e) }, 500)
  }
})
