// ============================================================
//  subcontractor-portal
//  下請け業者向け トークン認証ポータルのサーバ入口（#2 AC3 基盤 ＋ 注文書承諾）
//  - 業者はログイン不要。メールのトークンURL(/p/<token>)からこの関数を叩く。
//  - 平文トークンを受け取り SHA-256 ハッシュ化 → document_access_tokens を引く。
//  - account/業者/文書 に厳密スコープして、その文書の表示用データだけ返す。
//  - 無効/期限切れ/失効は { ok:false } を返す（不存在と区別しない＝列挙対策）。
//  actions:
//    - resolve         : トークンを検証し、業者＋（注文書なら）注文書の表示用データを返す
//    - accept          : 注文書を承諾（署名＋同意ボタン）。証跡（日時/IP/UA/署名画像/PDFハッシュ）を保存
//    - invoice_resolve : 請求フォーム用。注文書＋承諾状態＋残額（注文書金額−既請求）を返す（purpose=invoice_submit）
//    - invoice_submit  : 業者が請求金額（全額/出来高）を送信。承諾済＆残額内のみ受理し請求データを起票（AC3/AC4）
//  ※ verify_jwt=false（業者はJWTを持たない）。service role でDBアクセス。
//  ※ 平文トークンはログに出さない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
// service role があれば使う。無ければ anon（ローカル等）にフォールバック
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const BUCKET = 'expense-receipts'

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

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// data URL（"data:image/png;base64,xxxx"）or 素の base64 から Uint8Array を作る
function decodeImageDataUrl(input: string): Uint8Array | null {
  try {
    const comma = input.indexOf(',')
    const b64 = comma >= 0 ? input.slice(comma + 1) : input
    const bin = atob(b64)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return buf
  } catch { return null }
}

// 見積書番号の連番を n 件分発行：EST-<年>-<4桁連番>（accountごと・年ごと／admin estimates.vue と同形式）
async function nextEstimateNumbers(accountId: string, n: number): Promise<string[]> {
  const year = new Date().getFullYear()
  const prefix = `EST-${year}-`
  const { data } = await supabase.from('estimates')
    .select('estimate_number').eq('account_id', accountId)
    .like('estimate_number', `${prefix}%`).order('estimate_number', { ascending: false }).limit(1)
  const last = data?.[0]?.estimate_number as string | undefined
  let seq = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0
  return Array.from({ length: n }, () => `${prefix}${String(++seq).padStart(4, '0')}`)
}

// 注文書の表示用フィールド（業者に見せてよい範囲のみ。内部キーは返さない）
function orderView(o: any) {
  return {
    order_number:          o.order_number,
    order_date:            o.order_date,
    total_amount:          o.total_amount,
    site_name:             o.site_name,
    construction_location: o.construction_location,
    period_start:          o.period_start,
    period_end:            o.period_end,
    manager_name:          o.manager_name,
    vendor_name:           o.vendor_name,
    vendor_contact_name:   o.vendor_contact_name,
    payment_terms:         o.payment_terms,
    bank_info:             o.bank_info,
    inspection_terms:      o.inspection_terms,
    change_rule:           o.change_rule,
    special_notes:         o.special_notes,
    status:                o.status,
    accepted_at:           o.accepted_at,
    has_pdf:               !!o.pdf_path,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false }, 405)

  let token = ''
  let action = 'resolve'
  let signature = ''
  let signerName = ''
  let invoiceMode = 'full'   // 'full'=全額 / 'partial'=出来高
  let invoiceAmount = 0
  let regFields: Record<string, unknown> = {}
  let pdf = ''               // 見積書アップロード（inline data URL）
  let paths: string[] = []   // 見積書アップロード（直アップロード済みのstorage path群）
  try {
    const body = await req.json()
    token       = (body.token ?? '').toString()
    action      = (body.action ?? 'resolve').toString()
    signature   = (body.signature ?? '').toString()
    signerName  = (body.signer_name ?? '').toString().slice(0, 100)
    invoiceMode = (body.invoice_mode ?? 'full').toString()
    invoiceAmount = Math.round(Number(body.invoice_amount ?? 0)) || 0
    regFields   = (body.fields && typeof body.fields === 'object') ? body.fields : {}
    pdf         = (body.pdf ?? '').toString()
    paths       = Array.isArray(body.paths) ? body.paths.map((p: unknown) => String(p)) : []
  } catch { /* 空/不正body */ }

  if (!token) return json({ ok: false })

  try {
    const tokenHash = await sha256Hex(token)
    const nowIso = new Date().toISOString()

    // トークン検証：ハッシュ一致＋未失効＋未期限切れ
    const { data: tok } = await supabase
      .from('document_access_tokens')
      .select('id, account_id, subcontractor_id, purpose, document_type, document_id, expires_at, revoked_at, used_at')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle()

    if (!tok) return json({ ok: false })
    if (tok.expires_at && tok.expires_at < nowIso) return json({ ok: false })

    const KNOWN_ACTIONS = ['resolve', 'accept', 'invoice_resolve', 'invoice_submit', 'change_accept', 'register_resolve', 'register_submit', 'estimate_resolve', 'estimate_sign', 'estimate_upload']
    if (!KNOWN_ACTIONS.includes(action)) return json({ ok: false, error: 'unsupported_action' }, 400)

    // 受注者（業者）を account/業者ID の二重スコープで取得
    const { data: sub } = await supabase
      .from('subcontractors')
      .select('id, name')
      .eq('id', tok.subcontractor_id)
      .eq('account_id', tok.account_id)
      .maybeSingle()

    if (!sub) return json({ ok: false })

    // 対象注文書を account/文書ID の二重スコープで取得（注文書を扱う purpose のみ）
    let order: any = null
    if ((tok.purpose === 'order_accept' || tok.purpose === 'invoice_submit')
        && tok.document_type === 'purchase_order' && tok.document_id) {
      const { data: po } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('id', tok.document_id)
        .eq('account_id', tok.account_id)
        .eq('subcontractor_id', tok.subcontractor_id)  // 越境防止：このトークンの業者の注文書のみ
        .eq('is_deleted', false)
        .maybeSingle()
      order = po ?? null
      if (!order) return json({ ok: false })  // 文書が無い/別業者 → 列挙対策で ok:false
    }

    // 変更注文書（purpose=change_accept）を二重スコープで取得し、親注文書も読む
    let change: any = null
    if (tok.purpose === 'change_accept' && tok.document_type === 'purchase_order_change' && tok.document_id) {
      const { data: ch } = await supabase
        .from('purchase_order_changes')
        .select('*')
        .eq('id', tok.document_id)
        .eq('account_id', tok.account_id)
        .eq('subcontractor_id', tok.subcontractor_id)   // 越境防止：このトークンの業者の変更のみ
        .maybeSingle()
      change = ch ?? null
      if (!change) return json({ ok: false })
      const { data: po } = await supabase
        .from('purchase_orders').select('*')
        .eq('id', change.purchase_order_id).eq('account_id', tok.account_id).maybeSingle()
      order = po ?? null   // 表示・金額更新の対象
    }

    // 請求フォーム系（purpose=invoice_submit）の共通計算：承諾状態＋残額
    //  - accepted: 注文書が業者承諾済み（status='accepted' or 承諾証跡あり）＝請求の前提（AC4）
    //  - billed  : この注文書に紐づく既存請求の合計（出来高の複数回請求に備える）
    //  - residual: 注文書金額 − 既請求 ＝ 今回請求できる上限（AC3）
    async function invoiceContext(o: any) {
      const { data: acc } = await supabase
        .from('purchase_order_acceptances')
        .select('accepted_at').eq('purchase_order_id', o.id).maybeSingle()
      const accepted = o.status === 'accepted' || !!acc
      const { data: invs } = await supabase
        .from('subcontractor_invoices')
        .select('total_amount').eq('account_id', o.account_id).eq('purchase_order_id', o.id)
      const billed = (invs ?? []).reduce((s: number, r: any) => s + (Number(r.total_amount) || 0), 0)
      const total = Number(o.total_amount) || 0
      return { accepted, billed, total, residual: Math.max(0, total - billed) }
    }

    // ─────────────────────────────────────────────────────
    //  invoice_resolve : 請求フォーム用の表示データ（注文書＋承諾状態＋残額）
    // ─────────────────────────────────────────────────────
    if (action === 'invoice_resolve') {
      if (tok.purpose !== 'invoice_submit' || !order) return json({ ok: false, error: 'not_invoiceable' }, 400)
      await supabase.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('id', tok.id).then(() => {}, () => {})
      const ctx = await invoiceContext(order)
      return json({
        ok: true,
        purpose: tok.purpose,
        subcontractor: { id: sub.id, name: sub.name },
        order: orderView(order),
        accepted: ctx.accepted,
        billed:   ctx.billed,
        residual: ctx.residual,
        already_submitted: !!tok.used_at,
      })
    }

    // ─────────────────────────────────────────────────────
    //  invoice_submit : 業者が請求金額（全額/出来高）を送信 → 照合して請求起票
    // ─────────────────────────────────────────────────────
    if (action === 'invoice_submit') {
      if (tok.purpose !== 'invoice_submit' || !order) return json({ ok: false, error: 'not_invoiceable' }, 400)
      // 単回請求トークン：使用済みなら即弾く（早期の体感エラー）
      if (tok.used_at) return json({ ok: false, error: 'already_submitted' }, 409)

      const ctx = await invoiceContext(order)
      if (!ctx.accepted) return json({ ok: false, error: 'not_accepted' }, 400)   // AC4: 未承諾だと請求不可

      // 金額決定：全額=残額そのまま / 出来高=入力値（>0）
      const amount = invoiceMode === 'full' ? ctx.residual : invoiceAmount
      if (!amount || amount <= 0) return json({ ok: false, error: 'invalid_amount' }, 400)
      if (amount > ctx.residual) {                                                // AC3: 残額（=注文書金額−既請求）超過は弾く
        return json({ ok: false, error: 'over_residual', residual: ctx.residual }, 400)
      }

      // 二重請求防止：トークンを「used_at IS NULL の時だけ」原子的に使用済みへ更新。
      // 同時送信は1つだけが claim に成功し、残りは 409（金額検証を通った後に claim＝検証エラーでは消費しない）。
      const { data: claimed } = await supabase.from('document_access_tokens')
        .update({ used_at: nowIso }).eq('id', tok.id).is('used_at', null).select('id')
      if (!claimed || claimed.length === 0) return json({ ok: false, error: 'already_submitted' }, 409)

      // 請求ヘッダを起票（注文書に紐付け・出所=portal）
      const { data: inv, error: invErr } = await supabase.from('subcontractor_invoices').insert({
        account_id:        order.account_id,
        subcontractor_id:  order.subcontractor_id,
        vendor_name:       sub.name,
        purchase_order_id: order.id,
        total_amount:      amount,
        invoice_date:      nowIso.slice(0, 10),
        source:            'portal',
        note:              invoiceMode === 'full' ? '全額請求（業者ポータル）' : '出来高請求（業者ポータル）',
      }).select('id').single()
      if (invErr || !inv) return json({ ok: false, error: 'invoice_insert_failed' }, 500)

      // 明細1行（現場別集計に載るよう site_name/item_date を付与）
      await supabase.from('subcontractor_invoice_items').insert({
        invoice_id:  inv.id,
        account_id:  order.account_id,
        item_date:   nowIso.slice(0, 10),
        site_id:     order.site_id ?? null,
        site_name:   order.site_name ?? null,
        description: invoiceMode === 'full' ? '全額請求' : '出来高請求',
        quantity:    1,
        unit_price:  amount,
        amount,
        tax_rate:    10,
      })

      return json({ ok: true, submitted: true, invoice_id: inv.id, amount })
    }

    // ─────────────────────────────────────────────────────
    //  change_accept : 変更注文書の再承諾（署名＋証跡）→ 注文書金額を変更後金額へ更新
    // ─────────────────────────────────────────────────────
    // 新規業者 登録フォームの初期表示（招待時の名称/メールを prefill）
    if (action === 'register_resolve') {
      if (tok.purpose !== 'vendor_register') return json({ ok: false, error: 'not_registerable' }, 400)
      const { data: stub } = await supabase
        .from('subcontractors')
        .select('id, name, category, representative_name, mobile_phone, office_phone, email, address, registration_status')
        .eq('id', tok.subcontractor_id).eq('account_id', tok.account_id).maybeSingle()
      if (!stub) return json({ ok: false })
      await supabase.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('id', tok.id).then(() => {}, () => {})
      return json({
        ok: true, purpose: tok.purpose, vendor: stub,
        already_submitted: !!tok.used_at || stub.registration_status !== 'pending',
      })
    }

    // 業者がフォーム記入 → 業者マスタを更新（承認待ちのまま）＋担当者を起票
    if (action === 'register_submit') {
      if (tok.purpose !== 'vendor_register') return json({ ok: false, error: 'not_registerable' }, 400)
      if (tok.used_at) return json({ ok: false, error: 'already_submitted' }, 409)

      // 外部入力を許可フィールドだけに絞る（任意列更新を防ぐサニタイズ）
      const s = (v: unknown, max = 200) => (v == null ? null : String(v).slice(0, max))
      const name = s((regFields as any).name, 100)
      if (!name) return json({ ok: false, error: 'name_required' }, 400)
      const update: Record<string, unknown> = {
        name,
        category:            s((regFields as any).category, 20) ?? '業者',
        representative_name: s((regFields as any).representative_name, 100),
        mobile_phone:        s((regFields as any).mobile_phone, 30),
        office_phone:        s((regFields as any).office_phone, 30),
        email:               s((regFields as any).email, 200),
        address:             s((regFields as any).address, 300),
        bank_name:           s((regFields as any).bank_name, 100),
        bank_branch:         s((regFields as any).bank_branch, 100),
        bank_account_type:   s((regFields as any).bank_account_type, 20),
        bank_account_number: s((regFields as any).bank_account_number, 30),
        bank_account_holder: s((regFields as any).bank_account_holder, 100),
        registration_submitted_at: nowIso,
        // registration_status は 'pending' のまま（管理者承認で 'approved'）
      }

      // 単回トークンを原子的に消費（二重送信防止）
      const { data: claimed } = await supabase.from('document_access_tokens')
        .update({ used_at: nowIso }).eq('id', tok.id).is('used_at', null).select('id')
      if (!claimed || claimed.length === 0) return json({ ok: false, error: 'already_submitted' }, 409)

      const { error: updErr } = await supabase.from('subcontractors')
        .update(update).eq('id', tok.subcontractor_id).eq('account_id', tok.account_id).eq('registration_status', 'pending')
      if (updErr) return json({ ok: false, error: 'register_update_failed' }, 500)

      if (update.email || update.representative_name) {
        await supabase.from('subcontractor_contacts').insert({
          account_id: tok.account_id, subcontractor_id: tok.subcontractor_id,
          name: update.representative_name ?? name, email: update.email ?? null,
          phone: update.mobile_phone ?? update.office_phone ?? null,
        })
      }
      return json({ ok: true, submitted: true })
    }

    if (action === 'change_accept') {
      if (!change) return json({ ok: false, error: 'not_acceptable' }, 400)
      // 既に再承諾済みなら冪等に返す
      if (change.status === 'accepted' && change.accepted_at) {
        return json({ ok: true, already_accepted: true, accepted_at: change.accepted_at })
      }
      const sigBytes = decodeImageDataUrl(signature)
      if (!sigBytes || sigBytes.length === 0) return json({ ok: false, error: 'signature_required' }, 400)

      const sigPath = `purchase-orders/${change.account_id}/${change.purchase_order_id}/change-${change.id}-signature.png`
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(sigPath, sigBytes, { upsert: true, contentType: 'image/png' })
      if (upErr) return json({ ok: false, error: 'signature_upload_failed' }, 500)

      // 親注文書PDFのハッシュ（証跡・任意）
      let pdfHash: string | null = null
      if (order?.pdf_path) {
        const { data: file } = await supabase.storage.from(BUCKET).download(order.pdf_path)
        if (file) pdfHash = await sha256Hex(new Uint8Array(await file.arrayBuffer()))
      }
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || null
      const ua = req.headers.get('user-agent') || null

      // 変更注文書を再承諾済みに（status='issued' の時だけ＝原子的に二重承諾を防ぐ）
      const { data: upd, error: updErr } = await supabase.from('purchase_order_changes')
        .update({
          status: 'accepted', accepted_at: nowIso, accepted_ip: ip, user_agent: ua,
          signer_name: signerName || null, signature_path: sigPath, pdf_hash: pdfHash, updated_at: nowIso,
        })
        .eq('id', change.id).eq('account_id', change.account_id).eq('status', 'issued')
        .select('id')
      if (updErr) return json({ ok: false, error: 'change_accept_failed' }, 500)
      if (!upd || upd.length === 0) {
        // 既に他で承諾済み → 冪等
        const { data: ex } = await supabase.from('purchase_order_changes').select('accepted_at').eq('id', change.id).maybeSingle()
        return json({ ok: true, already_accepted: true, accepted_at: ex?.accepted_at ?? nowIso })
      }

      // 最新の承諾済金額を注文書に反映（AC3：請求照合＝①の残額計算の基準になる）
      await supabase.from('purchase_orders')
        .update({ total_amount: change.new_amount, status: 'accepted', accepted_at: nowIso, updated_at: nowIso })
        .eq('id', change.purchase_order_id).eq('account_id', change.account_id)

      await supabase.from('document_access_tokens').update({ used_at: nowIso }).eq('id', tok.id)
      return json({ ok: true, accepted: true, accepted_at: nowIso, new_amount: change.new_amount })
    }

    // ─────────────────────────────────────────────────────
    //  estimate_resolve : 業者見積アップロード用。業者＋「その業者に紐づく現場一覧」を返す
    //  （purpose=estimate_upload・業者ごと再利用リンク。document_type='subcontractor'）
    // ─────────────────────────────────────────────────────
    if (action === 'estimate_resolve') {
      if (tok.purpose !== 'estimate_upload') return json({ ok: false, error: 'not_uploadable' }, 400)
      const { data: links } = await supabase.from('site_subcontractors')
        .select('site_id').eq('account_id', tok.account_id).eq('subcontractor_id', sub.id)
      const siteIds = (links ?? []).map((l: any) => l.site_id)
      let sites: any[] = []
      if (siteIds.length) {
        const { data: ss } = await supabase.from('sites')
          .select('id, name').eq('account_id', tok.account_id).in('id', siteIds).eq('active', true).order('name')
        sites = ss ?? []
      }
      await supabase.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('id', tok.id).then(() => {}, () => {})
      return json({ ok: true, purpose: tok.purpose, subcontractor: { id: sub.id, name: sub.name }, sites })
    }

    // ─────────────────────────────────────────────────────
    //  estimate_sign : 直アップロード用の署名付きアップロードURLを count 件発行
    //  （path は estimate-uploads/<業者ID>/ 配下に固定＝越境/不正パス防止）
    // ─────────────────────────────────────────────────────
    if (action === 'estimate_sign') {
      if (tok.purpose !== 'estimate_upload') return json({ ok: false, error: 'not_uploadable' }, 400)
      const count = Math.min(Math.max(1, Math.round(Number((regFields as any).count) || 1)), 20)
      const uploads: any[] = []
      for (let i = 0; i < count; i++) {
        const path = `estimate-uploads/${sub.id}/${crypto.randomUUID()}.pdf`
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
        if (error || !data) return json({ ok: false, error: 'sign_failed' }, 500)
        uploads.push({ path, token: data.token, signedUrl: data.signedUrl })
      }
      return json({ ok: true, uploads })
    }

    // ─────────────────────────────────────────────────────
    //  estimate_upload : 業者が現場を選び見積書PDFをアップ → estimates に新規起票
    //  （uploaded_via_portal=true・同リンクで複数現場/複数回=再利用可）
    //   - inline pdf（data URL）モード ／ paths[]（直アップロード済み）モード の両対応
    //   - 越境防止：紐付いていない現場/不正pathは拒否
    // ─────────────────────────────────────────────────────
    if (action === 'estimate_upload') {
      if (tok.purpose !== 'estimate_upload') return json({ ok: false, error: 'not_uploadable' }, 400)
      const siteId = (regFields as any).site_id ? String((regFields as any).site_id) : ''
      if (!siteId) return json({ ok: false, error: 'site_required' }, 400)
      // 越境防止：このトークンの業者に紐づく現場のみ受理
      const { data: link } = await supabase.from('site_subcontractors')
        .select('site_id').eq('account_id', tok.account_id).eq('subcontractor_id', sub.id).eq('site_id', siteId).maybeSingle()
      if (!link) return json({ ok: false, error: 'site_not_linked' }, 400)

      const todayIso = nowIso.slice(0, 10)
      const prefixPath = `estimate-uploads/${sub.id}/`

      // モードB：直アップロード済みの paths[] を起票
      if (paths.length) {
        for (const p of paths) {
          if (!p.startsWith(prefixPath)) return json({ ok: false, error: 'bad_path' }, 400)  // 越境/不正パス防止
        }
        const numbers = await nextEstimateNumbers(tok.account_id, paths.length)
        const rows = paths.map((p, i) => ({
          account_id: tok.account_id, subcontractor_id: sub.id, site_id: siteId,
          estimate_number: numbers[i], estimate_date: todayIso, pdf_path: p, uploaded_via_portal: true,
        }))
        const { error: insErr } = await supabase.from('estimates').insert(rows)
        if (insErr) return json({ ok: false, error: 'estimate_insert_failed' }, 500)
        await supabase.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('id', tok.id).then(() => {}, () => {})
        return json({ ok: true, uploaded: true, count: paths.length, estimate_numbers: numbers })
      }

      // モードA：inline pdf（data URL）を保存して1件起票
      if (!pdf) return json({ ok: false, error: 'pdf_required' }, 400)
      const bytes = decodeImageDataUrl(pdf)
      if (!bytes || bytes.length === 0) return json({ ok: false, error: 'pdf_required' }, 400)
      const path = `${prefixPath}${crypto.randomUUID()}.pdf`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { upsert: false, contentType: 'application/pdf' })
      if (upErr) return json({ ok: false, error: 'pdf_upload_failed' }, 500)
      const [number] = await nextEstimateNumbers(tok.account_id, 1)
      const { error: insErr } = await supabase.from('estimates').insert({
        account_id: tok.account_id, subcontractor_id: sub.id, site_id: siteId,
        estimate_number: number, estimate_date: todayIso, pdf_path: path, uploaded_via_portal: true,
      })
      if (insErr) return json({ ok: false, error: 'estimate_insert_failed' }, 500)
      await supabase.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('id', tok.id).then(() => {}, () => {})
      return json({ ok: true, uploaded: true, estimate_number: number })
    }

    // ─────────────────────────────────────────────────────
    //  accept : 注文書承諾（署名＋証跡保存）
    // ─────────────────────────────────────────────────────
    if (action === 'accept') {
      if (!order) return json({ ok: false, error: 'not_acceptable' }, 400)

      // 既に承諾済みなら冪等に返す（再送・二度押し対策）
      const { data: existing } = await supabase
        .from('purchase_order_acceptances')
        .select('accepted_at')
        .eq('purchase_order_id', order.id)
        .maybeSingle()
      if (existing) {
        return json({ ok: true, already_accepted: true, accepted_at: existing.accepted_at })
      }

      const sigBytes = decodeImageDataUrl(signature)
      if (!sigBytes || sigBytes.length === 0) return json({ ok: false, error: 'signature_required' }, 400)

      // 署名画像を Storage に保存（注文書PDFと同じ expense-receipts バケット）
      const sigPath = `purchase-orders/${order.account_id}/${order.id}/signature.png`
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(sigPath, sigBytes, { upsert: true, contentType: 'image/png' })
      if (upErr) return json({ ok: false, error: `signature_upload_failed` }, 500)

      // 対象注文書PDFのSHA-256（証跡：承諾時点のPDFを特定）。PDF未生成なら null。
      let pdfHash: string | null = null
      if (order.pdf_path) {
        const { data: file } = await supabase.storage.from(BUCKET).download(order.pdf_path)
        if (file) pdfHash = await sha256Hex(new Uint8Array(await file.arrayBuffer()))
      }

      // 同意者の IP / UA（証跡）。プロキシ経由のため x-forwarded-for 先頭を採用。
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
        || req.headers.get('x-real-ip') || null
      const ua = req.headers.get('user-agent') || null

      const { error: insErr } = await supabase.from('purchase_order_acceptances').insert({
        account_id:        order.account_id,
        purchase_order_id: order.id,
        subcontractor_id:  order.subcontractor_id,
        token_id:          tok.id,
        accepted_at:       nowIso,
        accepted_ip:       ip,
        user_agent:        ua,
        signer_name:       signerName || null,
        signature_path:    sigPath,
        pdf_hash:          pdfHash,
      })
      // unique制約(poa_order_unique)違反＝同時承諾。冪等に成功扱い。
      if (insErr) {
        if ((insErr as any).code === '23505') {
          const { data: ex2 } = await supabase
            .from('purchase_order_acceptances')
            .select('accepted_at').eq('purchase_order_id', order.id).maybeSingle()
          return json({ ok: true, already_accepted: true, accepted_at: ex2?.accepted_at ?? nowIso })
        }
        return json({ ok: false, error: 'accept_insert_failed' }, 500)
      }

      // 注文書を「承諾済」に更新＋承諾日時を刻む。
      // service_role は RLS バイパスのため、PK だけでなく account_id でも明示スコープ（多層防御）。
      await supabase.from('purchase_orders')
        .update({ status: 'accepted', accepted_at: nowIso, updated_at: nowIso })
        .eq('id', order.id)
        .eq('account_id', order.account_id)

      // トークンを使用済みにマーク（best-effort）。※承諾の単回性は poa_order_unique 制約で担保
      // されており、used_at の更新失敗があっても再承諾は already_accepted で冪等に弾かれる。
      const { error: tokUpdErr } = await supabase
        .from('document_access_tokens').update({ used_at: nowIso }).eq('id', tok.id)
      if (tokUpdErr) console.warn('[subcontractor-portal] token used_at update failed (non-fatal):', tokUpdErr.message)

      return json({ ok: true, accepted: true, accepted_at: nowIso })
    }

    // ─────────────────────────────────────────────────────
    //  resolve : 表示用データを返す
    // ─────────────────────────────────────────────────────
    // アクセス記録（best-effort）
    await supabase.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('id', tok.id).then(() => {}, () => {})

    // 注文書PDFの公開URL（添付確認用・任意）
    let pdfUrl: string | null = null
    if (order?.pdf_path) {
      pdfUrl = supabase.storage.from(BUCKET).getPublicUrl(order.pdf_path).data.publicUrl ?? null
    }

    // 変更注文書の表示用（業者に見せてよい範囲のみ）
    const changeView = change ? {
      id: change.id, seq: change.seq, old_amount: change.old_amount, new_amount: change.new_amount,
      reason: change.reason, status: change.status, accepted_at: change.accepted_at,
    } : null

    return json({
      ok: true,
      purpose:       tok.purpose,
      document_type: tok.document_type,
      document_id:   tok.document_id,
      subcontractor: { id: sub.id, name: sub.name },
      order:         order ? orderView(order) : null,
      change:        changeView,
      pdf_url:       pdfUrl,
    })
  } catch (e) {
    console.error('[subcontractor-portal] error:', e instanceof Error ? e.message : String(e))
    return json({ ok: false }, 500)
  }
})
