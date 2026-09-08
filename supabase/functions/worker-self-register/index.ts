// ============================================================
//  worker-self-register
//  LINE から来た「まだ登録していない人」の自己登録を service_role で行う。
//
//  ★なぜ EF が要るか（2026-09-08 本番障害の恒久対応）
//   登録は元々 LIFF から anon で `workers` を upsert していたが、2026-08-01 の
//   anon ロックダウン（作業員が自力でオーナーに昇格できる P0 の封鎖）で
//   `workers` が列単位付与に絞られた。PostgREST の upsert
//   （Prefer: resolution=merge-duplicates）は衝突の有無に関わらず
//   テーブル単位の SELECT/UPDATE を要求するため、以後 **全件 401** になっていた。
//   実測: users.line_user_id が付いた行は 2026-06-25 を最後に 0 件
//   （＝1ヶ月以上、LINE からの新規登録が誰も通っていなかった）。
//
//   anon の権限を戻すと昇格 P0 が再び開くので、**権限は一切広げず**
//   登録経路だけを service_role の EF に寄せる。
//
//  ★もう一つの壊れ（一覧が空）
//   register.vue の作業員一覧は master-data EF から取っていたが、
//   その `resolveCaller()` は users を line_user_id で引くため
//   「まだ登録していない人」は解決できず 401 になる。
//   ＝ 登録画面なのに登録済みでないと使えない鶏と卵。
//   本 EF の action='options' がその一覧を返して解消する。
//
//  ★身元の担保
//   LINE ID token を verifyLineIdToken() で検証する（audience=自社チャネル）。
//   ＝ 自社の LINE 公式アカウントを使っている人だけが到達できる。
//   これはロックダウン前と同じ信頼水準で、広げていない。
//
//  action:
//   options  { account_slug }                     → 選択用の作業員一覧（id/name/name_kana/role のみ）
//   register { account_slug, worker_id? , name?, role? } → 作業員の確保＋users への LINE 紐付け
//
//  ※ verify_jwt=false で deploy すること（LINE作業員は Supabase JWT を持たない）。
//    関数内で LINE ID token を検証している。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyLineIdToken, IS_LOCAL } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  // ── ① LINE の身元。ここが唯一の入場ゲート ──────────────
  const idToken = typeof body.line_id_token === 'string' ? body.line_id_token : ''
  let lineUserId = idToken ? await verifyLineIdToken(idToken) : null
  // ローカル検証用の抜け道。本番では絶対に開かない（daily-reports-read 等と同じ作法）。
  if (!lineUserId && IS_LOCAL && typeof body.dev_line_user_id === 'string' && body.dev_line_user_id) {
    lineUserId = body.dev_line_user_id
  }
  if (!lineUserId) return json({ ok: false, error: 'unauthorized' }, 401)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ── ② テナント。未登録なので users からは引けない＝スラッグで解決する ──
  const slug = typeof body.account_slug === 'string' ? body.account_slug.trim() : ''
  if (!slug) return json({ ok: false, error: 'account_slug_required' }, 400)
  const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
  const accountId = acct?.id
  if (!accountId) return json({ ok: false, error: 'account_not_found' }, 404)

  const action = typeof body.action === 'string' ? body.action : 'options'

  // ── ③ 一覧（登録画面の「一覧から選ぶ」）───────────────
  //  返すのは選択に要る最小限だけ。単価・賃金・連絡先などは絶対に返さない。
  if (action === 'options') {
    const { data: workers, error } = await svc.from('workers')
      .select('id, name, name_kana, role')
      .eq('account_id', accountId).eq('active', true)
      .order('name_kana', { nullsFirst: false }).order('name')
    if (error) return json({ ok: false, error: 'query_failed' }, 500)
    return json({ ok: true, workers: workers ?? [] })
  }

  if (action !== 'register') return json({ ok: false, error: 'unknown_action' }, 400)

  // ── ④ 登録 ────────────────────────────────
  const rawName = typeof body.name === 'string' ? body.name.trim() : ''
  const role: 'factory' | 'site' = body.role === 'factory' ? 'factory' : 'site'
  let workerId: string | null = typeof body.worker_id === 'string' && body.worker_id ? body.worker_id : null

  if (workerId) {
    // 既存から選んだ場合。★他テナントの worker_id を渡されても通さない
    const { data: w } = await svc.from('workers')
      .select('id, name').eq('id', workerId).eq('account_id', accountId).maybeSingle()
    if (!w) return json({ ok: false, error: 'worker_not_found' }, 404)
  } else {
    if (!rawName) return json({ ok: false, error: 'name_required' }, 400)
    // 同名が既に居れば再利用する（元の upsert(onConflict: name,account_id) と同じ意図）。
    // ★ここで作るのは名前・所属・単価0だけ。permission_role 等は触らない
    //  （触れると自己登録から権限を持てる＝2026-08-01 に塞いだ穴が別経路で開く）。
    const { data: exist } = await svc.from('workers')
      .select('id').eq('account_id', accountId).eq('name', rawName).maybeSingle()
    if (exist?.id) {
      workerId = exist.id
    } else {
      const { data: created, error: insErr } = await svc.from('workers')
        .insert({ account_id: accountId, name: rawName, role, unit_price: 0, active: true })
        .select('id').single()
      if (insErr || !created) return json({ ok: false, error: 'worker_create_failed' }, 500)
      workerId = created.id
    }
  }

  // ★乗っ取り防止: その作業員が既に「別の」LINE アカウントに紐づいているなら拒否する。
  //  「1ログイン=1作業員」と同じ趣旨（他人になりすまして日報を出せてしまう）。
  const { data: boundRows } = await svc.from('users')
    .select('id, line_user_id').eq('account_id', accountId).eq('worker_id', workerId)
  const bound = (boundRows ?? []) as { id: string; line_user_id: string | null }[]
  if (bound.some((b) => b.line_user_id && b.line_user_id !== lineUserId)) {
    return json({ ok: false, error: 'worker_already_linked' }, 409)
  }

  const name = rawName || (await svc.from('workers').select('name').eq('id', workerId).maybeSingle()).data?.name || ''
  const patch = {
    line_user_id: lineUserId,
    worker_id:    workerId,
    real_name:    name,
    worker_role:  role,
    account_id:   accountId,
    updated_at:   new Date().toISOString(),
  }

  // ★users 行を二重に作らない（重複すると日報が履歴に出なくなる・2026-07 の実害）。
  //  upsert(onConflict:'line_user_id') 一本にすると、
  //  「管理画面でログインを発行済み＝users 行はあるが line_user_id は NULL」の人で
  //  NULL は衝突しないため **新しい行が増える**。今回の新入社員がまさにこの状態だった。
  //  そこで ①自分のLINEの行 → ②その作業員の未紐付けの行 → ③新規作成 の順に倒す。
  const { data: mine } = await svc.from('users')
    .select('id').eq('line_user_id', lineUserId).maybeSingle()
  const targetId = mine?.id ?? bound.find((b) => !b.line_user_id)?.id ?? null

  const q = targetId
    ? svc.from('users').update(patch).eq('id', targetId).select().single()
    : svc.from('users').insert(patch).select().single()
  const { data: urow, error: upErr } = await q
  if (upErr || !urow) return json({ ok: false, error: 'user_upsert_failed' }, 500)

  return json({ ok: true, user: urow })
})
