// ============================================================
//  process-excel-import
//  工程表(process_tasks)の既存Excelファイルを Gemini で解析し、
//  工程(タスク)候補をJSON配列で返す。DBへは書き込まない(=ステートレス。
//  実際の保存はクライアント側の既存 process.vue 一括エディタ/saveEditor が
//  認証済みSupabaseクライアント経由で行う＝RLSがそのまま効く)。
//  認証: 呼び出し元の Supabase JWT を検証する（未認証呼び出しでGemini課金が
//  発生する穴を塞ぐ＝Gemini独立レビュー指摘・2026-07-11）。CIは全関数を
//  --no-verify-jwt でデプロイするためgateway側のverify_jwtに頼らずin-codeで検証。
//
//  POST body:
//    { text: string, siteName?: string }   // text = Excelシートをクライアント側でCSV化したもの
//
//  Response:
//    { ok: true, tasks: [{ name, assignee, site_manager, work_type, contract_amount, start_date, end_date, memo }] }
//  失敗時は { ok: false, tasks: [], error }（best-effort・analyze-invoiceと同じ200返し）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

// Geminiへ送るテキスト量の上限（トークン超過/課金膨張防止・大きい表でも先頭部分で十分抽出できる想定）
const MAX_TEXT_LEN = 60000

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

const WORK_TYPES = ['日中', '夜間', '家具']
const EMPTY_RESULT = { ok: true as const, tasks: [] as unknown[] }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // ── 認証: 呼び出し元の JWT を検証（未認証での高額Gemini呼び出しを防ぐ） ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: '認証が必要です' }, 401)
  const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userErr } = await authClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'トークン不正' }, 401)

    const { text, siteName, multiSite } = await req.json() as { text?: string; siteName?: string; multiSite?: boolean }
    if (!text || !text.trim()) return json({ error: 'text is required' }, 400)

    const truncated = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text
    // 複数現場モード: 1ファイルに複数現場が混在する工程表。各タスクの現場名(site_name)も抽出する。
    // 単一現場モード(従来): siteName ヒントを与え、その現場の工程表として読む。
    const siteHint = multiSite
      ? '\nこのファイルには複数の現場が混在しています。各タスクがどの現場のものか(シート名・現場列・見出し等から判断)を site_name に必ず入れてください。'
      : (siteName ? `\n現場名: ${siteName}（この現場の工程表として読み取る）` : '')
    const siteField = multiSite
      ? '      "site_name": "この工程が属する現場名（複数現場混在のため必須。判別できなければnull）",\n'
      : ''
    // AC4: 色塗りガントチャート形式(日付が列見出し・工程の稼働日はセルの色塗りで表現)の場合、
    // クライアント側(excelToImportText)がexceljsで塗り色を検出し「■」マーカー版のテキストを追記する。
    // 通常のCSVには開始日/終了日の値が無いため、マーカー版が付いている時だけ解釈方法を追加指示する。
    const colorGanttHint = truncated.includes('の色塗り期間')
      ? '\n\n「■ シート「〜」の色塗り期間」という追加情報がある場合、それは元のExcelで日付列がセルの色塗りで表現されていた工程(ガントチャート形式)について、行ラベルごとに開始日・終了日を計算済みのヒントです。「行「工程名」: 開始日=YYYY-MM-DD, 終了日=YYYY-MM-DD」の形式で、行ラベルが一致するタスクのstart_date/end_dateにそのままこの値を使ってください（自分で列を数え直す必要はありません）。'
      : ''

    const prompt = `これは工程表(スケジュール表)のExcelをCSV化したテキストです。内容から工程(タスク)の一覧をJSONのみで返してください（説明文・コードフェンス不要）。${siteHint}${colorGanttHint}

各行を以下の形式のオブジェクトにしてください。読み取れない項目はnull。日付は"YYYY-MM-DD"。
実際の工程行ではない行（見出し・空行・凡例・合計行など）は含めないこと。工程名(name)が読み取れない行は除外すること。

{
  "tasks": [
    {
      "name": "工程名（必須。例：内装ボード工事）",
${siteField}      "assignee": "担当者名（なければnull）",
      "site_manager": "現場管理者名（なければnull）",
      "work_type": "日中" | "夜間" | "家具" | null,
      "contract_amount": 請負金額（数値。カンマ・円記号は除く。なければnull）,
      "start_date": "開始日（YYYY-MM-DD。なければnull）",
      "end_date": "終了日（YYYY-MM-DD。なければnull）",
      "memo": "備考（なければnull）"
    }
  ]
}

■ CSVテキスト
${truncated}`

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
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
      await new Promise((r) => setTimeout(r, attempt * 1000))
    }
    if (!res!.ok) {
      console.error('[process-excel-import] Gemini error', res!.status, await res!.text())
      return json({ ok: false, tasks: [], error: 'Gemini API error' }, 502)
    }

    const data = await res!.json() as any
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return json(EMPTY_RESULT)

    const r = JSON.parse(jsonMatch[0]) as any
    const num = (v: unknown) => (v == null || v === '') ? null : Number(v)
    const dateOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null
    const tasks = Array.isArray(r.tasks)
      ? r.tasks
          .filter((t: any) => typeof t?.name === 'string' && t.name.trim())
          .map((t: any) => ({
            name: String(t.name).trim(),
            ...(multiSite ? { site_name: (typeof t.site_name === 'string' && t.site_name.trim()) ? t.site_name.trim() : null } : {}),
            assignee: t.assignee || null,
            site_manager: t.site_manager || null,
            work_type: WORK_TYPES.includes(t.work_type) ? t.work_type : null,
            contract_amount: num(t.contract_amount),
            start_date: dateOrNull(t.start_date),
            end_date: dateOrNull(t.end_date),
            memo: t.memo || null,
          }))
      : []

    return json({ ok: true, tasks })
  } catch (e) {
    console.error('[process-excel-import]', e)
    return json({ ok: false, tasks: [], error: String(e) }, 200)
  }
})
