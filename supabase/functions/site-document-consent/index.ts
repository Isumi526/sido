// ============================================================
//  site-document-consent
//  送り出し資料の承認（2026-08-19 打合せ・出退勤モデル変更のC）。
//  現場に添付された「承認が必要な資料」を、その現場に参加している作業員が承認し、
//  誰が・いつ・どの資料に同意したかを site_document_consents に残す。
//
//  ★これまでは打刻(attendance_logs.agreed_document_names)に相乗りしていた。
//   打刻を現場から切り離した（1日＝出勤/退勤の2回）ため、資料の確認は現場側の
//   独立したフローに移した。
//
//  ★verify_jwt=false で deploy（LINE作業員はSupabase JWTを持たない）。in-code認可。
//   クライアントが申告した worker_id / account_id は信じない。caller から引き直す。
//
//  POST body:
//   { action: 'list',    siteId }                → その現場の要承認資料＋自分の承認状況
//   { action: 'consent', attachmentId }          → 自分の承認を記録（べき等）
//   { action: 'status',  siteId }                → 現場の承認状況（誰が済/未。現場責任者向け）
//   { action: 'notify',  attachmentId }          → 未承認の参加者へお知らせを積む（管理画面から）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } })
}

/**
 * その現場に参加している作業員（＝資料の承認対象者）の worker_id 一覧。
 * ★定義は useMySiteIds（LIFF）と揃える: site_shares で共有された人＋現場責任者。
 *  ここだけ別定義にすると「現場は見えるのに承認を求められない/その逆」が起きる。
 */
async function participantWorkerIds(svc: any, accountId: string, siteId: string): Promise<string[]> {
  const ids = new Set<string>()
  const [{ data: shares }, { data: site }] = await Promise.all([
    svc.from('site_shares').select('user_id').eq('account_id', accountId).eq('site_id', siteId),
    svc.from('sites').select('responsible_worker_id').eq('account_id', accountId).eq('id', siteId).maybeSingle(),
  ])
  const userIds = ((shares ?? []) as { user_id: string }[]).map(r => r.user_id)
  if (userIds.length) {
    const { data: us } = await svc.from('users').select('worker_id').in('id', userIds)
    for (const u of (us ?? []) as { worker_id: string | null }[]) if (u.worker_id) ids.add(u.worker_id)
  }
  if (site?.responsible_worker_id) ids.add(site.responsible_worker_id as string)
  return [...ids]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }

  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)

  const accountId = caller.accountId
  const workerId  = caller.workerId
  // ★workerId が要るのは「自分の承認」を扱う list / consent だけ。
  //  status（誰が済/未か）は管理者が見るもので、作業員として登録されていない
  //  純粋な管理アカウントからも見られる必要がある。
  const needsWorker = body.action === 'list' || body.action === 'consent'
  if (needsWorker && !workerId) return json({ ok: false, error: 'worker_not_registered' }, 409)

  // ── その現場の要承認資料と、自分の承認状況 ──
  if (body.action === 'list') {
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    if (!siteId) return json({ ok: false, error: 'site_required' }, 400)

    const { data: docs } = await svc.from('site_attachments')
      .select('id, name, created_at')
      .eq('account_id', accountId).eq('site_id', siteId)
      .eq('kind', 'document').eq('require_consent', true)
      .order('created_at')

    const { data: mine } = await svc.from('site_document_consents')
      .select('attachment_id, consented_at')
      .eq('account_id', accountId).eq('site_id', siteId).eq('worker_id', workerId)
    const consented = new Map(((mine ?? []) as any[]).map(r => [r.attachment_id, r.consented_at]))

    return json({
      ok: true,
      documents: ((docs ?? []) as any[]).map(d => ({
        id: d.id, name: d.name,
        consentedAt: consented.get(d.id) ?? null,
      })),
    })
  }

  // ── 自分の承認を記録する（べき等・二重に積まない）──
  if (body.action === 'consent') {
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : ''
    if (!attachmentId) return json({ ok: false, error: 'attachment_required' }, 400)

    // ★資料は必ずサーバ側で引き直す。クライアントの申告した site/account は信じない。
    const { data: att } = await svc.from('site_attachments')
      .select('id, account_id, site_id, name, kind, require_consent')
      .eq('id', attachmentId).maybeSingle()
    if (!att) return json({ ok: false, error: 'attachment_not_found' }, 404)
    if (att.account_id !== accountId) return json({ ok: false, error: 'forbidden' }, 403)
    if (att.kind !== 'document' || !att.require_consent) {
      return json({ ok: false, error: 'not_consent_target' }, 400)
    }

    // ★その現場に参加している人だけが承認できる（無関係な人の承認は記録に意味が無い）
    const participants = await participantWorkerIds(svc, accountId, att.site_id as string)
    if (!participants.includes(workerId)) return json({ ok: false, error: 'not_participant' }, 403)

    const { error } = await svc.from('site_document_consents').upsert({
      account_id: accountId,
      site_id: att.site_id,
      attachment_id: attachmentId,
      worker_id: workerId,
      document_name: att.name ?? null,   // 名前は同意時点のスナップショット
    }, { onConflict: 'attachment_id,worker_id', ignoreDuplicates: true })
    if (error) {
      console.error('[site-document-consent] upsert failed:', error)
      return json({ ok: false, error: 'insert_failed' }, 500)
    }
    return json({ ok: true })
  }

  // ── 現場の承認状況（誰が済んで誰が未か）──
  if (body.action === 'status') {
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    if (!siteId) return json({ ok: false, error: 'site_required' }, 400)

    const participants = await participantWorkerIds(svc, accountId, siteId)
    const [{ data: docs }, { data: consents }, { data: workers }] = await Promise.all([
      svc.from('site_attachments').select('id, name')
        .eq('account_id', accountId).eq('site_id', siteId)
        .eq('kind', 'document').eq('require_consent', true).order('created_at'),
      svc.from('site_document_consents').select('attachment_id, worker_id, consented_at')
        .eq('account_id', accountId).eq('site_id', siteId),
      participants.length
        ? svc.from('workers').select('id, name').in('id', participants)
        : Promise.resolve({ data: [] }),
    ])

    const nameOf = new Map(((workers ?? []) as any[]).map(w => [w.id, w.name]))
    const byDoc = new Map<string, Map<string, string>>()
    for (const c of (consents ?? []) as any[]) {
      if (!byDoc.has(c.attachment_id)) byDoc.set(c.attachment_id, new Map())
      byDoc.get(c.attachment_id)!.set(c.worker_id, c.consented_at)
    }

    return json({
      ok: true,
      documents: ((docs ?? []) as any[]).map(d => {
        const done = byDoc.get(d.id) ?? new Map()
        return {
          id: d.id,
          name: d.name,
          consented: participants.filter(w => done.has(w)).map(w => ({
            workerId: w, name: nameOf.get(w) ?? '—', consentedAt: done.get(w),
          })),
          pending: participants.filter(w => !done.has(w)).map(w => ({
            workerId: w, name: nameOf.get(w) ?? '—',
          })),
        }
      }),
    })
  }

  // ── 「確認が必要な資料」が増えたことを参加作業員に知らせる ──
  //  ★資料を置いただけでは誰も気づかない（現場詳細を自分から開く人はいない）。
  //   既存のお知らせ基盤(schedule_notifications)に積み、ホーム/ベル/一覧のバッジで気づかせる。
  //   タップで現場詳細へ飛ばす（link_path）。
  //  ★まだ承認していない人にだけ積む。承認済みの人に「確認してください」は出さない。
  if (body.action === 'notify') {
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : ''
    if (!attachmentId) return json({ ok: false, error: 'attachment_required' }, 400)

    const { data: att } = await svc.from('site_attachments')
      .select('id, account_id, site_id, name, kind, require_consent')
      .eq('id', attachmentId).maybeSingle()
    if (!att) return json({ ok: false, error: 'attachment_not_found' }, 404)
    if (att.account_id !== accountId) return json({ ok: false, error: 'forbidden' }, 403)
    if (att.kind !== 'document' || !att.require_consent) {
      return json({ ok: false, error: 'not_consent_target' }, 400)
    }

    const [participants, { data: site }, { data: done }] = await Promise.all([
      participantWorkerIds(svc, accountId, att.site_id as string),
      svc.from('sites').select('name').eq('id', att.site_id).maybeSingle(),
      svc.from('site_document_consents').select('worker_id').eq('attachment_id', attachmentId),
    ])
    const consented = new Set(((done ?? []) as any[]).map(r => r.worker_id))
    const targets = participants.filter(w => !consented.has(w))
    if (!targets.length) return json({ ok: true, notified: 0 })

    const siteName = (site as any)?.name ?? '現場'
    // ★schedule_notifications に site_id 列は無い。どの現場かは body と link_path で伝える。
    const rows = targets.map(w => ({
      account_id: accountId,
      worker_id: w,
      kind: 'site_document',
      title: '確認が必要な資料が追加されました',
      body: `${siteName}：${att.name ?? '資料'}`,
      link_path: `/sites/${att.site_id}`,
    }))
    const { error } = await svc.from('schedule_notifications').insert(rows)
    if (error) {
      console.error('[site-document-consent] notify insert failed:', error)
      return json({ ok: false, error: 'notify_failed' }, 500)
    }
    return json({ ok: true, notified: rows.length })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
