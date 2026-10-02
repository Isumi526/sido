// ============================================================
//  site-address-suggest
//  現場名から住所の候補を出す（2026-10-02 設計「入力の手間を減らす」I-4・要望14）。
//  管理画面「住所の無い現場」で使う。事務の方が候補を確かめて確定する（自動では入れない）。
//
//  actions:
//   status            → { configured }  鍵が入っているか（画面が「候補を探す」を出すかどうかに使う）
//   search { query }  → { candidates: [{ name, address, lat, lng }] }（最大5件・日本国内）
//
//  ★Google Places API（Text Search）。鍵は EF の secret（GOOGLE_MAPS_API_KEY）でブラウザに出さない。
//   鍵が無い間は 503 not_configured（画面は候補なしで一覧と手入力だけ出す＝確認事項6=A の前提）。
//  ★認可: 管理画面にログインした承認者（owner/admin/office/site_manager）だけ。検索語は現場名なので
//   個人情報は送らない（Google は同意文の提供先の範囲）。
//  ※ --no-verify-jwt でデプロイ。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveApprover, APPROVER_ROLES } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }) }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const approver = await resolveApprover(svc, req.headers.get('Authorization') ?? '')
  if (!approver || !APPROVER_ROLES.includes(approver.role)) return json({ ok: false, error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  // ★鍵は呼ばれるたびに読む（入れ直した鍵がすぐ効くように）
  const key = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? ''

  if (!body.action || body.action === 'status') return json({ ok: true, configured: !!key })

  if (body.action === 'search') {
    if (!key) return json({ ok: false, error: 'not_configured' }, 503)
    const query = String(body.query ?? '').trim().slice(0, 100)
    if (!query) return json({ ok: false, error: 'empty' }, 400)
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
        },
        body: JSON.stringify({ textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: 5 }),
      })
      if (!res.ok) { console.error('[site-address-suggest] places', res.status, (await res.text()).slice(0, 200)); return json({ ok: false, error: 'search_failed' }, 502) }
      const j = await res.json()
      const candidates = ((j.places ?? []) as any[]).slice(0, 5).map((p) => ({
        name: p.displayName?.text ?? '',
        // 「日本、〒…」の頭を落として住所欄に入れやすくする
        address: String(p.formattedAddress ?? '').replace(/^日本、\s*/, ''),
        lat: typeof p.location?.latitude === 'number' ? p.location.latitude : null,
        lng: typeof p.location?.longitude === 'number' ? p.location.longitude : null,
      }))
      return json({ ok: true, candidates })
    } catch (e) {
      console.error('[site-address-suggest]', e)
      return json({ ok: false, error: 'search_failed' }, 502)
    }
  }
  return json({ ok: false, error: 'unknown_action' }, 400)
})
