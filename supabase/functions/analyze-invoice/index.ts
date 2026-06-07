// ============================================================
//  analyze-invoice
//  下請け業者の請求書(PDF/画像)を Gemini で解析し、ヘッダ＋明細を JSON で返す。
//
//  POST body:
//    { fileBase64: "data:application/pdf;base64,..." }   // 画像data URLも可
//
//  Response:
//    { vendor_name, title, invoice_no, invoice_date, due_date, total_amount,
//      items: [{ date, site_name, description, quantity, unit, unit_price, amount, tax_rate, note }] }
//  失敗時は { items: [] }（best-effort）
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
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders() } })
}

const EMPTY = { vendor_name: null, registration_number: null, title: null, invoice_no: null, invoice_date: null, due_date: null, total_amount: null, items: [] as unknown[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { fileBase64 } = await req.json() as { fileBase64: string }
    if (!fileBase64) return json({ error: 'fileBase64 is required' }, 400)

    const match = fileBase64.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return json({ error: 'Invalid file format (data URL required)' }, 400)
    const [, mimeType, base64Data] = match

    const prompt = `これは下請け業者の請求書です。内容から以下をJSONのみで返してください（説明文・コードフェンス不要）。
読み取れない項目は null。日付は "YYYY-MM-DD"。金額・数量は数値（カンマや円記号は除く）。

{
  "vendor_name": "請求元の業者名",
  "registration_number": "インボイス登録番号（T+13桁。なければnull）",
  "title": "件名（なければnull）",
  "invoice_no": "請求番号（なければnull）",
  "invoice_date": "請求日",
  "due_date": "支払い期限",
  "total_amount": 請求金額の合計（税込、数値）,
  "items": [
    {
      "date": "明細の日付",
      "site_name": "現場名（なければnull）",
      "description": "工事内容・品番・品名",
      "quantity": 数量,
      "unit": "単位（式・個・人 等）",
      "unit_price": 単価,
      "amount": 金額（税抜＝数量×単価）,
      "tax_rate": 税率（パーセント数値。不明なら10）,
      "note": "備考（なければnull）"
    }
  ]
}`

    const body = {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }

    let res: Response | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok || res.status !== 503) break
      await new Promise(r => setTimeout(r, attempt * 1000))
    }
    if (!res!.ok) {
      console.error('[analyze-invoice] Gemini error', res!.status, await res!.text())
      return json({ error: 'Gemini API error' }, 502)
    }

    const data = await res!.json() as any
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return json(EMPTY)

    const r = JSON.parse(jsonMatch[0]) as any
    const num = (v: unknown) => (v == null || v === '') ? null : Number(v)
    const items = Array.isArray(r.items) ? r.items.map((it: any) => ({
      date: it.date ?? null,
      site_name: it.site_name ?? null,
      description: it.description ?? null,
      quantity: num(it.quantity),
      unit: it.unit ?? null,
      unit_price: num(it.unit_price),
      amount: num(it.amount),
      tax_rate: it.tax_rate != null ? Number(it.tax_rate) : 10,
      note: it.note ?? null,
    })) : []

    return json({
      vendor_name: r.vendor_name ?? null,
      registration_number: r.registration_number ?? null,
      title: r.title ?? null,
      invoice_no: r.invoice_no ?? null,
      invoice_date: r.invoice_date ?? null,
      due_date: r.due_date ?? null,
      total_amount: num(r.total_amount),
      items,
    })
  } catch (e) {
    console.error('[analyze-invoice]', e)
    return json({ ...EMPTY, error: String(e) }, 200)
  }
})
