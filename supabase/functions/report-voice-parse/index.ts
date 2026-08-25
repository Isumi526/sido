// ============================================================
//  report-voice-parse
//  日報の音声入力（8/19会議）。作業員が話した内容（テキスト）を Gemini で
//  解釈し、日報フォームに展開できる構造化JSONを返す。
//  ★このEFは解析だけ。フォームへの反映は必ずクライアント側の確認画面を
//    経由する（会議合意「この内容で反映していいですか」）。DBには書かない。
//
//  POST body:
//    {
//      transcript: string,                       // 音声認識の結果テキスト（必須）
//      sites?: string[],                         // 選択肢の現場名（近い名前に寄せる用）
//      workCategories?: { id: string; name: string }[]  // 工種の選択肢
//    }
//
//  Response:
//    {
//      siteName: string|null,        // sites に近いものがあればその表記、無ければ聞き取り原文
//      workCategoryId: string|null,  // workCategories の中で最も近いもの
//      workCategoryName: string|null,
//      startTime: string|null,       // "HH:MM"
//      endTime: string|null,         // "HH:MM"
//      note: string|null,            // 作業内容の要約（自由記述）
//      raw: string                   // 認識テキストそのまま（確認画面の参考用）
//    }
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

// "HH:MM" 妥当性（0-23:0-59）。それ以外は null に落とす
function normTime(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json() as {
      transcript?: string
      sites?: string[]
      workCategories?: { id: string; name: string }[]
    }
    const transcript = (body.transcript ?? '').trim()
    if (!transcript) return json({ error: 'transcript is required' }, 400)
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY not configured' }, 500)

    const sites = Array.isArray(body.sites) ? body.sites.filter(s => typeof s === 'string') : []
    const cats = Array.isArray(body.workCategories) ? body.workCategories.filter(c => c && c.name) : []

    const prompt = `あなたは内装施工会社の日報入力アシスタントです。
作業員が話した内容（音声認識テキスト）から、日報フォームに入れる項目を抽出してください。
必ずJSON形式のみで返し、説明文は付けないでください。読み取れない項目は null にしてください。

# 現場名の候補（この中に近いものがあれば必ずその表記に寄せる。無ければ聞き取ったまま）
${sites.length ? sites.map(s => `- ${s}`).join('\n') : '(候補なし)'}

# 工種の候補（この中から最も近いものの name を1つ選ぶ。無ければ null）
${cats.length ? cats.map(c => `- ${c.name}`).join('\n') : '(候補なし)'}

# 出力JSON
{
  "siteName": "現場名（上の候補に近ければその表記。なければ聞き取り原文。無言及ならnull）",
  "workCategoryName": "工種（上の候補の name のいずれか。該当なしはnull）",
  "startTime": "開始時刻 HH:MM 24時間表記（例 08:00。無言及ならnull）",
  "endTime": "終了時刻 HH:MM 24時間表記（例 17:30。無言及ならnull）",
  "note": "作業内容の要約（自由記述。話した作業内容を簡潔に。無言及ならnull）"
}

# 音声認識テキスト
${transcript}`

    const gres = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    })
    if (!gres.ok) {
      const t = await gres.text()
      console.error('[report-voice-parse] gemini error', gres.status, t.slice(0, 300))
      return json({ error: 'Gemini API error' }, 502)
    }
    const gjson = await gres.json()
    const text = gjson?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())
    } catch {
      console.error('[report-voice-parse] JSON parse failed:', text.slice(0, 200))
      return json({ error: 'parse failed' }, 502)
    }

    const siteName = typeof parsed.siteName === 'string' && parsed.siteName.trim() ? parsed.siteName.trim() : null
    const wcName = typeof parsed.workCategoryName === 'string' && parsed.workCategoryName.trim() ? parsed.workCategoryName.trim() : null
    // 工種名 → id を解決（完全一致→部分一致）
    let workCategoryId: string | null = null
    let workCategoryName: string | null = null
    if (wcName && cats.length) {
      const exact = cats.find(c => c.name === wcName)
      const partial = exact ?? cats.find(c => c.name.includes(wcName) || wcName.includes(c.name))
      if (partial) { workCategoryId = partial.id; workCategoryName = partial.name }
    }

    return json({
      siteName,
      workCategoryId,
      workCategoryName,
      startTime: normTime(parsed.startTime),
      endTime: normTime(parsed.endTime),
      note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim() : null,
      raw: transcript,
    })
  } catch (e) {
    console.error('[report-voice-parse] error', e)
    return json({ error: String(e) }, 500)
  }
})
