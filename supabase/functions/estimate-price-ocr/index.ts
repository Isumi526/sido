// ============================================================
//  supabase/functions/estimate-price-ocr
//  【見積】E4 価格表OCR取込（vision-LLM＝Gemini マルチモーダル）
//   - 単価表の画像(PDF各ページ画像/写真)を Gemini で「表として意味理解」→構造化JSON抽出
//   - 既存 material_prices と差分計算 → estimate_price_revisions(pending) を作成
//   - 反映(material_pricesへ)は admin の人間承認後（このEFは pending を作るだけ＝自動反映しない）
//   認証: 呼び出し元 admin の JWT を検証し app_metadata.account_slug == 指定account のみ許可
//        （reminder系の無認証ベースラインと違い、価格書込の前段なので必ず認証する）
//   env(本番secret): SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / GEMINI_API_KEY
//                    任意: ESTIMATE_OCR_MODEL（既定 gemini-2.0-flash）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GEMINI_KEY   = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GEMINI_REVIEW_API_KEY') ?? ''
const OCR_MODEL    = Deno.env.get('ESTIMATE_OCR_MODEL') ?? 'gemini-2.5-flash'

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

type ExtractedRow = { code?: string | null; name?: string | null; unit?: string | null; unit_price?: number | null; effective_date?: string | null }

const PROMPT = `あなたは建材の単価表を読み取る専門家です。添付画像は商社の単価表（PDFページ画像 or 写真）です。
表として意味を理解し、各「材料の単価行」だけを JSON 配列で出力してください。出力は JSON のみ。
各要素: {"code": 品番(無ければnull), "name": 材料名(規格含む), "unit": 単位, "unit_price": 単価(整数・円), "effective_date": 有効開始日(YYYY-MM-DD・読めればnull可)}
ルール:
- 品番マージ(1品番×複数規格)は、規格ごとの行に品番を伝播する。
- 品番が無い行は code=null とし name に品名+規格を入れる。
- 諸経費(運賃/夜間料金/値引等)や単価が非数値の行は除外する。
- メーカー名と商社名は混同しない（単価はその商社の卸値）。
- 単位は 枚/坪/箱/本/缶/袋/ケース/台/式/山 等そのまま。
- 数量・金額のカンマや「円」は除いて整数の単価にする。`

async function geminiExtract(imageB64: string, mime: string): Promise<ExtractedRow[]> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY 未設定')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent`
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: imageB64 } }] }],
    generationConfig: { temperature: 0, response_mime_type: 'application/json' },
  })
  // 503（高負荷）は数回リトライ
  let res: Response | null = null
  for (let i = 0; i < 4; i++) {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body })
    if (res.status !== 503) break
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
  }
  if (!res || !res.ok) {
    const st = res?.status
    if (st === 429) throw new Error('AI(Gemini)の利用上限に達しました（鍵の月間予算上限）。AI Studioで上限を引き上げるか、時間をおいて再取込してください。')
    if (st === 503) throw new Error('AI(Gemini)が一時的に混雑しています。少し待って再取込してください。')
    throw new Error(`AI(Gemini)エラー(${st}): ${res ? (await res.text()).slice(0, 160) : 'no response'}`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
  let rows: ExtractedRow[]
  try { rows = JSON.parse(text) } catch { throw new Error('Gemini 応答が JSON でない') }
  return Array.isArray(rows) ? rows : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const { account_slug, supplier_id, image_base64, mime, rows: providedRows } = body ?? {}
  if (!account_slug || !supplier_id) return json({ error: 'account_slug と supplier_id は必須' }, 400)

  // ── 認証: 呼び出し元 admin の JWT を検証し、自account のみ許可 ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: '認証が必要です' }, 401)
  const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userErr } = await authClient.auth.getUser(token)
  if (userErr || !userData?.user) return json({ error: 'トークン不正' }, 401)
  const userSlug = (userData.user.app_metadata as any)?.account_slug
  if (!userSlug || userSlug !== account_slug) return json({ error: '権限がありません（account不一致）' }, 403)

  const db = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: acc } = await db.from('accounts').select('id').eq('slug', account_slug).single()
  const accountId = acc?.id
  if (!accountId) return json({ error: 'account が見つかりません' }, 404)

  // ── 抽出（rows 指定があればそれを使う＝手動/テスト経路。無ければ vision-LLM）──
  let extracted: ExtractedRow[]
  try {
    extracted = Array.isArray(providedRows) ? providedRows : await geminiExtract(image_base64, mime || 'image/png')
  } catch (e) {
    return json({ error: String((e as Error).message) }, 502)
  }

  // ── 現在の単価と突き合わせて差分計算 → pending revisions 作成（自動反映はしない）──
  //  ★材料マスタ(estimate_materials)＋エイリアス(estimate_material_aliases)経由の照合をやめた（2026-08-30）。
  //   R28以降そもそも材料マスタに行が増えず、新しい単価行には material_id が入らないため、
  //   照合が当たらず「据置はスキップ」が事実上効いていなかった
  //   （本番実測: 差分490件のうち450件が material_id なし＝毎回「新規」として積まれていた）。
  //   単価表そのものが持つ品番/品名で突き合わせる方が確実で、
  //   「マスタを先に整備させない」方針（2026-07-27 仕様書 #17）とも整合する。
  const { data: prices } = await db.from('estimate_material_prices')
    .select('product_code, item_name, unit_price')
    .eq('account_id', accountId).eq('supplier_id', supplier_id).eq('is_current', true)
  // 揺れ吸収のための正規化: NFKC（全角半角統一）＋小文字＋空白/記号除去
  const norm = (s: unknown) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s　・,，.。()（）\-_/]/g, '')
  const priceByCode = new Map<string, number>()
  const priceByName = new Map<string, number>()
  for (const p of (prices ?? []) as any[]) {
    const v = Number(p.unit_price)
    if (!Number.isFinite(v)) continue
    if (p.product_code) priceByCode.set(norm(p.product_code), v)
    if (p.item_name) priceByName.set(norm(p.item_name), v)
  }
  /** 今の単価（無ければ null）。品番を優先し、無ければ品名で当てる */
  const currentPrice = (r: ExtractedRow): number | null => {
    const code = r.code ? norm(r.code) : ''
    const name = r.name ? norm(r.name) : ''
    if (code && priceByCode.has(code)) return priceByCode.get(code)!
    if (name && priceByName.has(name)) return priceByName.get(name)!
    return null
  }

  const toInsert: any[] = []
  for (const r of extracted) {
    const np = Number(r.unit_price)
    if (!Number.isFinite(np) || np <= 0) continue
    const oldP = currentPrice(r)
    if (oldP != null && oldP === np) continue   // 据置はスキップ
    toInsert.push({
      account_id: accountId, supplier_id,
      code: r.code ?? null, name: r.name ?? null, unit: r.unit ?? null,
      old_price: oldP, new_price: np, effective_date: r.effective_date ?? null, status: 'pending',
    })
  }
  if (toInsert.length) {
    const { error } = await db.from('estimate_price_revisions').insert(toInsert)
    if (error) return json({ error: error.message }, 500)
  }
  return json({ ok: true, extracted: extracted.length, created: toInsert.length })
})
