// ============================================================
//  inventory
//  作業員アプリ（LIFF）からの在庫の読み書き（在庫①・2026-09-14）。
//
//  出所: 2026-09-10 SEED 会議・大塚「納品書で百本あっても…15本残ってましたよ…知らずに永遠と置いてある」
//   目的は「何がどれくらい残っているか」。作業員の最低限入力＝写真。
//   亥角「入荷／現場に持っていく／現場から引き戻ってくるタイミングで写真を撮って増減を登録する一手間」
//
//  ★なぜ EF 経由か: inventory_* は RLS 有効・authenticated 限定で、LINE 作業員（anon）は
//   直接読めない・書けない。身元をサーバで検証してから service_role で読み書きする
//   （他の LIFF 書き込みと同じ形）。account_id / 登録者はクライアントから受け取らない。
//
//  action:
//   items                                  → 有効な品目（id, name, unit, current_qty）
//   move { itemId, qty, kind, siteId?, photoUrls?, note?, reportDate?, clientRequestId? }
//        kind: 'return'(引上げ +qty・1番目) / 'out'(持出 −qty) / 'in'(入荷 +qty)
//        clientRequestId = 再送のべき等キー（同じ値は二重に登録しない・2026-09-20）
//        → inventory_move(...)（履歴＋現在庫を1トランザクションで）
//   recent { limit? }                      → 自分の直近の登録（画面の履歴表示用）
//  在庫②（2026-09-18）:
//   categories                             → 区分の一覧（品目に付いている区分 ∪ 既定セット）
//   item-create { name, category?, unit? } → 現場からその場で品目を新規登録（即時・承認なし・AC4）。同名があればそれを返す
//   suggest { imageBase64 }                → 写真から Gemini で品目候補（自社マスタ＋自社の訂正履歴だけを渡す・AC3/AC5）
//   correction { itemId, aiGuess?, aiCategory?, matched?, photoUrl? }
//                                          → 人が確定した結果を訂正履歴に残す（次回の候補提示に使う）
//  在庫③（2026-09-20）:
//   config                                 → { confirmRole: 'self' | 'office' }（settings.inventory_confirm_role・未設定＝self）
//   move（confirmRole=office の時）         → 品目が未確定のまま inventory_pending_moves に「確認待ち」で保存（残数には触れない）。
//                                            事務側が admin の未確認一覧で確定すると inventory_confirm_pending → inventory_move
//   pending-mine                           → 自分の確認待ち（pending/confirmed/rejected の直近）
//  ※ --no-verify-jwt でデプロイ。関数内で身元検証。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { FEATURE_SETTING_KEYS, resolveFeatureFlags } from '../_shared/features-registry.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const KINDS = ['in', 'out', 'return'] as const

// ── 在庫②: 区分の既定セット（推測で用意・レビューで調整）。会社が付けた区分と合わせて返す ──
const DEFAULT_CATEGORIES = ['ボード', '下地材', '床材', '天井材', '接着剤・副資材', 'ビス・金物', '塗料・シーリング', '養生・消耗品', 'その他']
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
/** 名寄せ用の緩い正規化（全角→半角・空白除去・小文字）。④の alias が入るまでの暫定 */
function norm(s: string): string {
  return String(s ?? '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　]/g, '').toLowerCase()
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const caller = await resolveCaller(
    svc, req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller || typeof caller !== 'object') return json({ ok: false, error: 'unauthorized' }, 401)
  const accountId = caller.accountId

  // ── 在庫はベータ（「使う機能」feature.inventory・既定OFF・2026-09-19 レビュー決定）。
  //  画面の導線を隠すだけだと URL 直打ち・古いバンドルから通るため、tools と同じく EF でも閉じる（fail-closed）。
  {
    const { data: rows } = await svc.from('settings').select('key, value').eq('account_id', accountId).in('key', FEATURE_SETTING_KEYS)
    if (!resolveFeatureFlags((rows ?? []) as { key: string; value: string | null }[]).inventory) {
      return json({ ok: false, error: 'feature_disabled' }, 403)
    }
  }

  // ── 在庫③: 確認役（self=申請者本人がその場で確定 / office=事務側が後で確定）。未設定・不正値は self ──
  async function confirmRole(): Promise<'self' | 'office'> {
    const { data } = await svc.from('settings').select('value').eq('account_id', accountId).eq('key', 'inventory_confirm_role').maybeSingle()
    return (data as any)?.value === 'office' ? 'office' : 'self'
  }

  if (body.action === 'config') {
    return json({ ok: true, confirmRole: await confirmRole() })
  }

  if (body.action === 'pending-mine') {
    let q = svc.from('inventory_pending_moves')
      .select('id, kind, qty, site_id, photo_urls, note, status, ai_guess_name, suggested_item_id, item_id, reject_reason, decided_at, created_at, report_date, sites(name), inventory_items!inventory_pending_moves_item_id_fkey(name, unit)')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(20)
    if (caller.workerId) q = q.eq('created_by_worker_id', caller.workerId)
    const { data, error } = await q
    if (error) { console.error('[inventory] pending-mine failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, pending: data ?? [] })
  }

  if (body.action === 'items') {
    const { data, error } = await svc.from('inventory_items')
      .select('id, name, unit, code, current_qty, category')
      .eq('account_id', accountId).eq('active', true).order('category').order('name')
    if (error) { console.error('[inventory] items failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, items: data ?? [] })
  }

  if (body.action === 'categories') {
    const { data } = await svc.from('inventory_items').select('category').eq('account_id', accountId).eq('active', true).not('category', 'is', null)
    const used = [...new Set((data ?? []).map((r: any) => String(r.category)).filter(Boolean))]
    return json({ ok: true, categories: [...used, ...DEFAULT_CATEGORIES.filter(c => !used.includes(c))] })
  }

  // 現場からその場で品目を新規登録（AC4: 即時・承認は挟まない）。同名（正規化一致）があればそれを返す＝重複を作らない
  if (body.action === 'item-create') {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
    if (!name) return json({ ok: false, error: 'name_required' }, 400)
    const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim().slice(0, 100) : null
    const unit = typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim().slice(0, 20) : null
    const { data: all } = await svc.from('inventory_items').select('id, name, unit, code, current_qty, category').eq('account_id', accountId).eq('active', true)
    const same = (all ?? []).find((it: any) => norm(it.name) === norm(name))
    if (same) return json({ ok: true, item: same, existed: true })
    const { data: created, error } = await svc.from('inventory_items')
      .insert({ account_id: accountId, name, category, unit, current_qty: 0 })
      .select('id, name, unit, code, current_qty, category').maybeSingle()
    if (error) { console.error('[inventory] item-create failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true, item: created, existed: false })
  }

  // 写真 → Gemini で品目候補。★自社の品目マスタと自社の訂正履歴だけをプロンプトに載せる（他社のデータは混ぜない）
  if (body.action === 'suggest') {
    const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
    const m = imageBase64.match(/^data:([^;]+);base64,(.+)$/)
    if (!m) return json({ ok: false, error: 'image_required' }, 400)
    if (!GEMINI_API_KEY) return json({ ok: false, error: 'ai_not_configured' }, 503)
    const [, mimeType, base64Data] = m
    const [{ data: items }, { data: corrections }] = await Promise.all([
      svc.from('inventory_items').select('id, name, unit, category').eq('account_id', accountId).eq('active', true).order('name').limit(500),
      svc.from('inventory_item_corrections').select('ai_guess, ai_category, item_id, matched, created_at')
        .eq('account_id', accountId).order('created_at', { ascending: false }).limit(40),
    ])
    const itemList = (items ?? []) as { id: string; name: string; unit: string | null; category: string | null }[]
    const byId = new Map(itemList.map(it => [it.id, it]))
    // 訂正履歴＝「この会社では AI が X と読んだ写真は Y だった」。訂正があった行だけを few-shot にする（一致は候補の並びに効かせる）
    const fewShot = ((corrections ?? []) as any[])
      .filter(c => c.ai_guess && byId.has(c.item_id) && !c.matched)
      .slice(0, 15)
      .map(c => `- AIの読み「${c.ai_guess}」→ 正しくは「${byId.get(c.item_id)!.name}」`)
    const usedCats = [...new Set(itemList.map(i => i.category).filter(Boolean) as string[])]
    const cats = [...usedCats, ...DEFAULT_CATEGORIES.filter(c => !usedCats.includes(c))]

    const prompt = `この写真は内装工事の資材・在庫品です。何の品目かを読み取り、下の「登録済み品目」から近いものを最大3件選んでください。
必ずJSON形式のみで返し、説明文は付けないでください。

# 登録済み品目（id｜品名｜区分）※この中に合うものがあれば必ずその id を使う
${itemList.length ? itemList.map(i => `${i.id}｜${i.name}｜${i.category ?? ''}`).join('\n') : '(まだ登録がありません)'}

# 区分の候補（新規の品目に付ける区分はこの中から選ぶ。合うものが無ければ null）
${cats.join(' / ')}
${fewShot.length ? `\n# この会社での過去の訂正（同じ読み方をしたら訂正後に寄せる）\n${fewShot.join('\n')}` : ''}

# 返す形
{
  "guessName": "写真から読み取った品名（型番・厚み・サイズがあれば含める。例: 石膏ボード 12.5mm 3×6）。読めなければ null",
  "guessCategory": "区分の候補のいずれか。無ければ null",
  "candidates": [ { "id": "登録済み品目の id", "confidence": 0〜1 } ]   // 近い順に最大3件。合うものが無ければ空配列
}`
    const gBody = {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Data } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' },
    }
    let res: Response | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      res = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gBody) })
      if (res.ok || res.status !== 503) break
      await new Promise(r => setTimeout(r, attempt * 1000))
    }
    if (!res || !res.ok) { console.error('[inventory] gemini failed:', res?.status, await res?.text().catch(() => '')); return json({ ok: false, error: 'ai_failed' }, 502) }
    const data = await res.json() as any
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const jm = text.match(/\{[\s\S]*\}/)
    let parsed: any = {}
    try { parsed = jm ? JSON.parse(jm[0]) : {} } catch { parsed = {} }
    const guessName = typeof parsed.guessName === 'string' && parsed.guessName.trim() ? parsed.guessName.trim().slice(0, 200) : null
    const guessCategory = typeof parsed.guessCategory === 'string' && cats.includes(parsed.guessCategory.trim()) ? parsed.guessCategory.trim() : null
    const seen = new Set<string>()
    const candidates: { id: string; name: string; unit: string | null; category: string | null; confidence: number }[] = []
    for (const c of (Array.isArray(parsed.candidates) ? parsed.candidates : [])) {
      const it = byId.get(String(c?.id ?? ''))
      if (!it || seen.has(it.id)) continue
      seen.add(it.id)
      candidates.push({ ...it, confidence: Math.max(0, Math.min(1, Number(c?.confidence) || 0)) })
      if (candidates.length >= 3) break
    }
    // AI が id を返さなくても、読んだ品名が登録済み品目と正規化一致すれば候補に入れる（保険）
    if (guessName) {
      const hit = itemList.find(i => norm(i.name) === norm(guessName))
      if (hit && !seen.has(hit.id)) candidates.unshift({ ...hit, confidence: 0.9 })
    }
    return json({ ok: true, guessName, guessCategory, candidates: candidates.slice(0, 3) })
  }

  // 人が確定した結果を訂正履歴に残す（AC5）。失敗しても在庫の登録は成立しているので best-effort
  if (body.action === 'correction') {
    const itemId = typeof body.itemId === 'string' ? body.itemId : ''
    if (!itemId) return json({ ok: false, error: 'item_required' }, 400)
    const { data: item } = await svc.from('inventory_items').select('id').eq('id', itemId).eq('account_id', accountId).maybeSingle()
    if (!item) return json({ ok: false, error: 'item_not_found' }, 404)
    // ★べき等（Gemini 指摘）: 同じ写真×同じ品目の履歴が既にあれば増やさない（再送で二重に学習しない）
    const photoUrl = typeof body.photoUrl === 'string' && body.photoUrl ? body.photoUrl.slice(0, 2000) : null
    if (photoUrl) {
      const { data: dup } = await svc.from('inventory_item_corrections').select('id')
        .eq('account_id', accountId).eq('item_id', itemId).eq('photo_url', photoUrl).limit(1)
      if (dup?.length) return json({ ok: true, deduped: true })
    }
    const { error } = await svc.from('inventory_item_corrections').insert({
      account_id: accountId, item_id: itemId,
      ai_guess: typeof body.aiGuess === 'string' ? body.aiGuess.slice(0, 200) : null,
      ai_category: typeof body.aiCategory === 'string' ? body.aiCategory.slice(0, 100) : null,
      matched: body.matched === true,
      photo_url: photoUrl,
      worker_id: caller.workerId,
    })
    if (error) { console.error('[inventory] correction failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true })
  }

  if (body.action === 'recent') {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100)
    let q = svc.from('inventory_movements')
      .select('id, item_id, delta, kind, site_id, photo_urls, note, created_by_name, created_at, report_date, inventory_items(name, unit), sites(name)')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(limit)
    if (caller.workerId) q = q.eq('created_by_worker_id', caller.workerId)
    const { data, error } = await q
    if (error) { console.error('[inventory] recent failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, movements: data ?? [] })
  }

  if (body.action === 'move') {
    const itemId = typeof body.itemId === 'string' ? body.itemId : ''
    const kind = KINDS.includes(body.kind) ? body.kind as typeof KINDS[number] : ''
    const qty = Number(body.qty)
    const role = await confirmRole()
    // 事務モード（在庫③）: 品目は無くてよい＝写真＋数量で「確認待ち」。本人モードは従来どおり品目必須
    if (!kind || (role === 'self' && !itemId)) return json({ ok: false, error: 'item_and_kind_required' }, 400)
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000 || Math.round(qty) !== qty) return json({ ok: false, error: 'bad_qty' }, 400)
    const siteId = typeof body.siteId === 'string' && body.siteId ? body.siteId : null
    // 持出・引上げは現場が要る（どこに持って行った／どこから戻したか）
    if ((kind === 'out' || kind === 'return') && !siteId) return json({ ok: false, error: 'site_required' }, 400)
    const photoUrls = Array.isArray(body.photoUrls) ? body.photoUrls.filter((u: unknown) => typeof u === 'string' && u).slice(0, 10) : []
    // ★作業員の最低限入力＝写真（亥角「持ち出した時と引き上げの最低限、写真を残すのはマスト」）
    if (!photoUrls.length) return json({ ok: false, error: 'photo_required' }, 400)
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
    const reportDate = typeof body.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.reportDate) ? body.reportDate : null
    // ★べき等キー（2026-09-19 Gemini 指摘）: 画面が1回の入力ごとに付ける UUID。同じキーの再送は inventory_move が登録せず現在庫を返す
    const clientRequestId = typeof body.clientRequestId === 'string' && /^[0-9a-f-]{36}$/i.test(body.clientRequestId) ? body.clientRequestId : null

    // 品目・現場は自テナントのものだけ（関数内でも確認するが、分かりやすいエラーを返すためここでも）
    if (itemId) {
      const { data: item } = await svc.from('inventory_items').select('id').eq('id', itemId).eq('account_id', accountId).eq('active', true).maybeSingle()
      if (!item) return json({ ok: false, error: 'item_not_found' }, 404)
    }
    if (siteId) {
      const { data: site } = await svc.from('sites').select('id').eq('id', siteId).eq('account_id', accountId).maybeSingle()
      if (!site) return json({ ok: false, error: 'site_not_found' }, 404)
    }

    // ── 在庫③ 事務モード: 残数には触れず「確認待ち」に置く。事務側が admin で品目を確定した時に inventory_move が走る ──
    if (role === 'office') {
      if (clientRequestId) {
        const { data: dup } = await svc.from('inventory_pending_moves').select('id, status').eq('account_id', accountId).eq('client_request_id', clientRequestId).maybeSingle()
        if (dup) return json({ ok: true, pending: true, pendingId: (dup as any).id, deduped: true })
      }
      const cands = Array.isArray(body.aiCandidates) ? body.aiCandidates.slice(0, 3).map((c: any) => ({
        id: String(c?.id ?? ''), name: String(c?.name ?? '').slice(0, 200), unit: c?.unit ?? null, category: c?.category ?? null,
        confidence: Math.max(0, Math.min(1, Number(c?.confidence) || 0)),
      })).filter((c: any) => c.id) : []
      const { data: pend, error } = await svc.from('inventory_pending_moves').insert({
        account_id: accountId, kind, qty, site_id: siteId, photo_urls: photoUrls, note: note || null, report_date: reportDate,
        ai_guess_name: typeof body.aiGuess === 'string' ? body.aiGuess.slice(0, 200) : null,
        ai_guess_category: typeof body.aiCategory === 'string' ? body.aiCategory.slice(0, 100) : null,
        ai_candidates: cands, suggested_item_id: itemId || null,
        created_by_worker_id: caller.workerId, created_by_name: caller.name, client_request_id: clientRequestId,
      }).select('id').maybeSingle()
      if (error) { console.error('[inventory] pending insert failed:', error); return json({ ok: false, error: 'save_failed', detail: error.message }, 500) }
      return json({ ok: true, pending: true, pendingId: (pend as any)?.id ?? null })
    }

    const delta = kind === 'out' ? -qty : qty
    const { data, error } = await svc.rpc('inventory_move', {
      p_item_id: itemId, p_delta: delta, p_note: note || null, p_kind: kind, p_site_id: siteId,
      p_photo_urls: photoUrls, p_created_by_worker_id: caller.workerId, p_created_by_name: caller.name,
      p_report_date: reportDate, p_client_request_id: clientRequestId,
    })
    if (error) { console.error('[inventory] move failed:', error); return json({ ok: false, error: 'move_failed', detail: error.message }, 500) }
    return json({ ok: true, item: data })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
