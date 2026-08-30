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
//      sites: [{                     // ★1日に複数現場を回る運用があるので配列で返す
//        siteName: string|null,        // sites に近いものがあればその表記、無ければ null
//        workCategoryId: string|null,  // workCategories の中で最も近いもの
//        workCategoryName: string|null,
//        startTime: string|null,       // "HH:MM"
//        endTime: string|null,         // "HH:MM"
//        note: string|null,            // その現場での作業内容
//      }],
//      note: string|null,            // 現場に紐づかない全体の備考
//      raw: string                   // 認識テキストそのまま（確認画面の参考用）
//    }
//  ★現場ごとに時刻を分けるのが肝。1つに畳むと「午前A・午後B」が
//   1現場の 8:00-17:30 になり、人件費の集計が現場をまたいで狂う。
// ============================================================

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = 'gemini-2.5-flash'
// ★v1beta を使う。JSONモード(responseMimeType)は v1 では使えず
//  「JSON mode is not enabled for api version v1」で400になる（2026-08-30 実機で判明）。
//  同じ組み合わせで動いている ai-chat に揃えた。
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

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

# 大事なルール
- 1日に複数の現場を回ることがある。**現場ごとに1件ずつ** sites 配列に分けること。
  「午前はA、午後はB」のような場合、Aの時刻とBの時刻をそれぞれの現場に割り当てる。
  まとめて1件にしない（1現場に全時間が付くと作業時間の集計が狂う）。
- 現場が1つしか出てこない場合は sites を1件だけにする。
- 現場の話が全く出てこない場合は sites を空配列にする。

# 出力JSON
{
  "sites": [
    {
      "siteName": "現場名（上の候補に近ければ必ずその表記。候補に無ければnull）",
      "workCategoryName": "工種（上の候補の name のいずれか。該当なしはnull）",
      "startTime": "その現場の開始時刻 HH:MM 24時間表記（例 08:00。無言及ならnull）",
      "endTime": "その現場の終了時刻 HH:MM 24時間表記（例 17:30。無言及ならnull）",
      "note": "その現場での作業内容（簡潔に。無言及ならnull）"
    }
  ],
  "note": "現場に紐づかない全体の連絡事項（無ければnull）"
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

    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null

    /** 工種名 → id を解決（完全一致→部分一致） */
    const resolveCat = (name: string | null) => {
      if (!name || !cats.length) return { workCategoryId: null, workCategoryName: null }
      const exact = cats.find(c => c.name === name)
      const hit = exact ?? cats.find(c => c.name.includes(name) || name.includes(c.name))
      return hit ? { workCategoryId: hit.id, workCategoryName: hit.name } : { workCategoryId: null, workCategoryName: null }
    }

    // ★現場名は候補にあるものだけ採用する。候補に無い名前を入れても画面のプルダウンに
    //  無く反映できないので、null にして人に選ばせる（勝手に新規現場を作らない）。
    //  ★ただし表記ゆれは吸収する。マスタが「UA　長島」(全角スペース)でも人は
    //   「UA長島」と話すため、素の完全一致だと毎回外れる（打刻の現場検索で実際に
    //   詰まった事例と同じ・2026-08-27）。空白と大小文字を無視して突き合わせる。
    const norm = (s: string) => s.replace(/[\s　]+/g, '').toLowerCase()
    const pickSite = (name: string | null) => {
      if (!name) return null
      const n = norm(name)
      const exact = sites.find(s => norm(s) === n)
      if (exact) return exact
      // 略称で話すことも多い（「スシロー高槻」→「スシロー　高槻センター店」）
      const partial = sites.find(s => norm(s).includes(n) || n.includes(norm(s)))
      return partial ?? null
    }

    const rawSites = Array.isArray(parsed.sites) ? parsed.sites : []
    const outSites = rawSites.map((s: any) => ({
      siteName: pickSite(str(s?.siteName)),
      ...resolveCat(str(s?.workCategoryName)),
      startTime: normTime(s?.startTime),
      endTime: normTime(s?.endTime),
      note: str(s?.note),
    }))

    return json({
      sites: outSites,
      note: str(parsed.note),
      raw: transcript,
    })
  } catch (e) {
    console.error('[report-voice-parse] error', e)
    return json({ error: String(e) }, 500)
  }
})
