// ============================================================
//  recurring-invoices
//  協力会社請求の「毎月定額」: 登録日を過ぎていて今月分がまだのひな形から、今月分の請求を1件ずつ作る（2026-09-27）。
//
//  出所（尾崎さん・SEED 2026-09-25/27）: 「ボタンを押さずに毎月自動で登録される仕様希望。
//   金額や内容に変更がある場合のみ、登録後にその場で修正できると嬉しい」
//
//  起動: pg_cron が毎日 JST 06:10 に呼ぶ（x-reminder-secret）。承認者の JWT なら自社分だけ手動実行できる。
//   body: { dry_run?: boolean }  … dry_run は作らず・記録せず、作る予定だけ返す
//
//  ★作るかどうかの判定は shared/recurring-invoice.ts dueToday（画面の「次回登録日」と同じ規則）。
//  ★順番: 請求を作る → 明細を入れる → ひな形の last_generated_period を進める。
//   - 途中で落ちても、次の実行で作り直すか、(recurring_template_id, recurring_period) の一意制約で二重を弾く
//   - 明細が入らなかったら請求ごと消す（明細の無い請求を集計に残さない）→ 次の実行でやり直す
//  ★作った請求は通常の請求と同じ表（source='recurring'・未払い）。集計・一覧・支払いは従来の規則のまま。
//  ★認可は reminder-auth（cron＝全社／承認者 JWT＝自社だけ／シークレット未設定でも通さない）。
//  ※ --no-verify-jwt でデプロイ。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeReminderTrigger } from '../_shared/reminder-auth.ts'
import { dueToday, addDays } from '../_shared/recurring-invoice.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reminder-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
/** JST の今日 'YYYY-MM-DD' */
function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

type Tpl = {
  id: string; account_id: string; vendor_kind: string; subcontractor_id: string | null; vendor_name: string
  registration_number: string | null; title: string | null; total_amount: number | null; note: string | null
  tax_mode: string; tax_override: number | null; items: any[]; day_of_month: number; due_offset_days: number | null
  start_period: string; end_period: string | null; last_generated_period: string | null; active: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const authz = await authorizeReminderTrigger(req, svc)
  if (!authz.ok) return json({ ok: false, error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  const dryRun = body.dry_run === true
  const today = jstToday()

  let q = svc.from('subcontractor_invoice_templates').select('*')
  if (authz.scopeAccountId) q = q.eq('account_id', authz.scopeAccountId)   // ★手動実行は自分の会社だけ
  const { data: tpls, error: tErr } = await q
  if (tErr) return json({ ok: false, error: 'templates_failed' }, 500)

  const results: any[] = []
  for (const t of (tpls ?? []) as Tpl[]) {
    const d = dueToday(t, today)
    if (!d.due) { results.push({ template_id: t.id, skipped: d.reason, period: d.period }); continue }
    if (dryRun) { results.push({ template_id: t.id, dry_run: true, period: d.period, invoice_date: d.invoiceDate }); continue }

    const header = {
      account_id: t.account_id,
      vendor_kind: t.vendor_kind,
      subcontractor_id: t.subcontractor_id,
      vendor_name: t.vendor_name,
      registration_number: t.registration_number,
      title: t.title,
      invoice_no: null,
      invoice_date: d.invoiceDate,
      due_date: typeof t.due_offset_days === 'number' ? addDays(d.invoiceDate, t.due_offset_days) : null,
      transfer_date: null,
      paid: false,
      total_amount: t.total_amount,
      note: t.note,
      tax_mode: t.tax_mode,
      tax_override: t.tax_override,
      source: 'recurring',
      recurring_template_id: t.id,
      recurring_period: d.period,
      updated_at: new Date().toISOString(),
    }
    const { data: inv, error: insErr } = await svc.from('subcontractor_invoices').insert(header).select('id').single()
    let created = false
    if (insErr) {
      // 一意制約＝その月はもう作られている（同時実行・前回の途中失敗）。月を進めるだけにする
      if ((insErr as any).code !== '23505') {
        console.error('[recurring-invoices] insert failed:', insErr)
        results.push({ template_id: t.id, error: 'insert_failed', period: d.period })
        continue
      }
    } else {
      const rows = (Array.isArray(t.items) ? t.items : []).map((it: any, i: number) => ({
        invoice_id: inv!.id, account_id: t.account_id, item_date: d.invoiceDate,
        site_id: it.site_id ?? null, site_name: it.site_name ?? null, description: it.description ?? null,
        quantity: it.quantity ?? null, unit: it.unit ?? null, unit_price: it.unit_price ?? null,
        amount: it.amount ?? Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)),
        tax_rate: it.tax_rate ?? 10, note: it.note ?? null, sort_order: i,
      }))
      if (rows.length) {
        const { error: itemErr } = await svc.from('subcontractor_invoice_items').insert(rows)
        if (itemErr) {
          // ★明細の無い請求を集計に残さない。消して次の実行でやり直す（月は進めない）
          console.error('[recurring-invoices] items insert failed:', itemErr)
          await svc.from('subcontractor_invoices').delete().eq('id', inv!.id)
          results.push({ template_id: t.id, error: 'items_failed', period: d.period })
          continue
        }
      }
      created = true
    }
    // その月を作ったことをひな形に残す（請求を後で削除しても、この月は作り直さない）
    await svc.from('subcontractor_invoice_templates')
      .update({ last_generated_period: d.period, updated_at: new Date().toISOString() }).eq('id', t.id)
    results.push({ template_id: t.id, period: d.period, invoice_date: d.invoiceDate, created, invoice_id: inv?.id ?? null })
  }
  return json({ ok: true, today, results })
})
