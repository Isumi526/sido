// ============================================================
//  supabase/functions/product-info-lookup
//  品名/品番から商品情報（サイズ展開・仕様・画像・出典）をネット検索で調べる（見積R6）。
//
//  なぜ（2026-07-28 ユーザー通しレビュー・音声）:
//   「品名を選択したときに、商品の詳細画像とか、どんなサイズがあるかとかを
//     ネット検索・AIで調べてぱっとUI上で表示したい。現状の業務フローだと、
//     毎回その品名で Google 検索なり ChatGPT なりで調べて『あー、こんなんね』って認識してる」
//   ＝人が毎回やっている検索作業の置き換え。公式カタログAPIの整備は待たない。
//
//  設計:
//   - Gemini の google_search グラウンディングで調べる
//     （drawing-material-extract の geminiLookupSize と同じ方式）。
//     ※ tools(google_search) と response_mime_type:json は同時指定できないため、
//       プレーンテキストで返させて行単位でパースする。
//   - ★見つからない時は not_found を返す。黙って空を返すと、呼び出し側が
//     「まだ読み込み中」と区別できず、毎回AIを叩き直すことになる。
//   - キャッシュ（estimate_product_info）は呼び出し側（admin）が読み書きする。
//     このEFは「調べるだけ」に徹する。
//
//  認証: 呼び出し元 admin の JWT を検証し app_metadata.account_slug があることのみ確認
//        （Gemini API 呼び出しコストの野良利用防止・drawing-material-extract と同型）。
//  env: SUPABASE_URL / SUPABASE_ANON_KEY / GEMINI_API_KEY
//       任意: PRODUCT_INFO_MODEL（既定 gemini-2.5-flash）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GEMINI_KEY   = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GEMINI_REVIEW_API_KEY') ?? ''
const MODEL        = Deno.env.get('PRODUCT_INFO_MODEL') ?? 'gemini-2.5-flash'

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

type ProductInfo = {
  maker: string | null
  sizes: string | null
  spec: string | null
  image_url: string | null
  source_urls: string[]
  not_found: boolean
}

/** 「見出し: 値」形式の1行を拾う。値が空/「不明」なら null */
function pick(text: string, label: string): string | null {
  const m = text.match(new RegExp(`${label}[:：]\\s*(.+)`))
  const v = m?.[1]?.trim()
  if (!v || /^(不明|なし|不明です)$/.test(v)) return null
  return v
}

async function lookup(name: string, code: string, maker: string): Promise<ProductInfo> {
  const empty: ProductInfo = { maker: null, sizes: null, spec: null, image_url: null, source_urls: [], not_found: true }
  if (!GEMINI_KEY) return empty

  const who = [maker, code, name].filter(Boolean).join(' / ')
  const prompt = `建築内装の資材「${who}」について、Web検索で調べて次の形式で出力してください。
説明文や前置きは不要で、見つかった項目の行だけを出力すること。

メーカー: <メーカー名>
サイズ展開: <入手できるサイズを「/」区切りで。例 910×1820 / 910×2420>
仕様: <材質・厚み・グレード等の要点を1行で>
画像URL: <その商品の画像の直リンク(.jpg/.png等)。無ければ書かない>
出典URL: <参照したページのURL>

どの項目も分からない場合は「不明」とだけ出力してください。`

  let res: Response
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0 },
      }),
    })
  } catch { return empty }
  if (!res.ok) return empty

  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts ?? []
  const text: string = parts.map((p: any) => p?.text ?? '').join('')
  if (!text.trim() || /^不明\s*$/.test(text.trim())) return empty

  // 出典はグラウンディングのメタデータからも拾う（本文に書かれないことがある）
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  const grounded: string[] = chunks.map((c: any) => c?.web?.uri).filter(Boolean)
  const cited = pick(text, '出典URL')
  const sources = [...new Set([...(cited ? [cited] : []), ...grounded])].slice(0, 5)

  const info: ProductInfo = {
    maker: pick(text, 'メーカー'),
    sizes: pick(text, 'サイズ展開'),
    spec:  pick(text, '仕様'),
    image_url: pick(text, '画像URL'),
    source_urls: sources,
    not_found: false,
  }
  // どれも取れていないなら「見つからなかった」と同じ。中途半端に成功扱いしない。
  if (!info.maker && !info.sizes && !info.spec && !info.image_url && !sources.length) return empty
  return info
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const name  = (body?.name ?? '').toString().trim()
  const code  = (body?.product_code ?? '').toString().trim()
  const maker = (body?.maker ?? '').toString().trim()
  if (!name && !code) return json({ error: 'name か product_code が必要です' }, 400)

  // 認証: 呼び出し元 admin の JWT を検証（account_slugを持つ=正規admin）
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return json({ error: 'unauthorized' }, 401)
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: userData } = await cli.auth.getUser()
  const slug = (userData?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
  if (!slug) return json({ error: 'unauthorized' }, 401)

  try {
    return json({ ok: true, info: await lookup(name, code, maker) })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
