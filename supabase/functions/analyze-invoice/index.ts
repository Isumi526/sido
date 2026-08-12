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
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

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

/**
 * 内税(inclusive)か外税(exclusive)かを数値で判定する。
 * ★AIの自己申告(r.tax_mode)は参考にしつつ、明細合計と請求合計の突き合わせを優先する。
 *  - 合計 ≒ 明細合計            → inclusive（明細に税が入っている）
 *  - 合計 ≒ 明細合計×(1+税率)   → exclusive（税は別途）
 *  どちらとも言えなければ従来どおり exclusive に倒す（既存挙動を変えない）。
 */
function decideTaxMode(r: any, items: any[]): 'exclusive' | 'inclusive' {
  const declared = r?.tax_mode === 'inclusive' ? 'inclusive' : r?.tax_mode === 'exclusive' ? 'exclusive' : null
  const total = Number(r?.total_amount)
  const sum = items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0)
  if (!Number.isFinite(total) || total <= 0 || sum <= 0) return declared ?? 'exclusive'

  const rate = (Number(items[0]?.tax_rate) || 10) / 100
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, b * 0.005)  // 端数丸め分の許容
  if (near(total, sum)) return 'inclusive'
  if (near(total, sum * (1 + rate))) return 'exclusive'
  // 消費税行が明示されていて 合計＝小計+消費税 なら外税
  const tax = Number(r?.tax_amount), sub = Number(r?.subtotal_amount)
  if (Number.isFinite(tax) && Number.isFinite(sub) && tax > 0 && near(total, sub + tax)) return 'exclusive'
  return declared ?? 'exclusive'
}

const EMPTY = { vendor_name: null, registration_number: null, title: null, invoice_no: null, invoice_date: null, due_date: null, total_amount: null, subtotal_amount: null, tax_amount: null, tax_mode: 'exclusive', items: [] as unknown[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const { fileBase64, siteNames } = await req.json() as { fileBase64: string; siteNames?: string[] }
    if (!fileBase64) return json({ error: 'fileBase64 is required' }, 400)

    const match = fileBase64.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return json({ error: 'Invalid file format (data URL required)' }, 400)
    const [, mimeType, base64Data] = match

    const siteList = Array.isArray(siteNames) ? siteNames.filter((s) => typeof s === 'string' && s.trim()) : []
    const siteHint = siteList.length
      ? `\n\n■ 現場名の名寄せ（重要）\n現場マスタ候補: ${JSON.stringify(siteList)}\n請求書では現場名が品名・工事内容の中に含まれることが多い。各明細の "site_name" は、品名/工事内容から現場を推定し、上の候補に【表記揺れ・誤字・接頭辞/接尾辞（「改修」「新築」「(ギフト)」等）の違いがあっても】最も近いものがあれば、その候補の表記を【そのまま】入れること。候補に該当が無ければ読み取った現場名をそのまま、現場が判断できなければ null。`
      : ''

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
  "subtotal_amount": 小計（税抜の合計。請求書に「小計」の記載があればその値。無ければnull）,
  "tax_amount": 消費税額（「消費税」行の金額。無ければnull）,
  "tax_mode": "明細のamountが税抜なら exclusive / 明細のamountに消費税が含まれているなら inclusive",
  "items": [
    {
      "date": "明細の日付",
      "site_name": "現場名（なければnull）",
      "description": "工事内容・品番・品名",
      "quantity": 数量,
      "unit": "単位（式・個・人 等）",
      "unit_price": 単価,
      "amount": 金額（数量×単価。税抜か税込かは tax_mode に従う。請求書に書かれている数字をそのまま入れる）,
      "tax_rate": 税率（パーセント数値。不明なら10）,
      "note": "備考（なければnull）"
    }
  ]
}

【消費税の判定（tax_mode）】
- 「消費税」「内税」「税込」等の行や表記から判断する。
- 「小計」「消費税」「合計」が分かれて書かれていて 合計 ≒ 小計 + 消費税 なら exclusive。
- 消費税行が無く、明細の合計 ≒ 請求金額の合計（税込）なら inclusive（明細に税が含まれている）。
- 判断できなければ exclusive にする（従来の扱い）。${siteHint}`

    const body = {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
      // JSON強制＋思考オフ＋十分な出力枠（明細が多い請求書でも途中切れしないように）
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
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
      subtotal_amount: num(r.subtotal_amount),
      tax_amount: num(r.tax_amount),
      // ★AIの申告を数値で検算して上書きする（プロンプトだけに委ねない）。
      //  明細合計と請求金額の合計を突き合わせれば、内税/外税は機械的に判定できる。
      tax_mode: decideTaxMode(r, items),
      items,
    })
  } catch (e) {
    console.error('[analyze-invoice]', e)
    return json({ ...EMPTY, error: String(e) }, 200)
  }
})
