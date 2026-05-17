// ============================================================
//  get-master
//  マスタデータ取得（現場・作業員・下請け・車両）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ACCOUNT_SLUG      = Deno.env.get('ACCOUNT_SLUG') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    // account_id を slug から取得
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('slug', ACCOUNT_SLUG)
      .single()

    if (!accounts) return json({ error: `account not found: ${ACCOUNT_SLUG}` }, 404)
    const accountId = accounts.id

    const [sites, workers, subcontractors, vehicles] = await Promise.all([
      supabase.from('sites').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('workers').select('name,role,unit_price').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('subcontractors').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('vehicles').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
    ])

    return json({
      sites:          (sites.data ?? []).map(r => r.name),
      workers:        (workers.data ?? []).map(r => ({ name: r.name, role: r.role, unitPrice: r.unit_price })),
      subcontractors: (subcontractors.data ?? []).map(r => r.name),
      vehicles:       (vehicles.data ?? []).map(r => r.name),
    })
  } catch (e) {
    console.error('[get-master]', e)
    return json({ error: String(e) }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}
