// ============================================================
//  support-line-webhook
//  GENLINKS の公式 LINE を入れたグループLINE（シードの管理側との修正依頼・やり取り用）の受け口（2026-10-02）。
//  届いたメッセージを受信箱（support_line_messages）にためるだけ。公式アカウントは何も返さない（亥角さん決定）。
//  依頼への切り出しは Claude Code が scripts/line-inbox-to-minutes.mjs → /intake でまとめて行う。
//
//  ★LINE の署名（x-line-signature＝チャネルシークレットでの HMAC-SHA256）を必ず確かめる。
//   CI は全関数を --no-verify-jwt で出すので、確かめなければ誰でも受信箱に書き込める。
//   シークレットが未設定なら 503（設定が終わるまで受け付けない＝fail-closed）。
//  ★LINE は応答が遅い・失敗すると同じイベントを送り直すので、line_event_key（メッセージID）で1件にまとめる。
//  ★画像・ファイルは LINE 側ですぐ消えるので、受け取ったその場で非公開バケット support-line-media に保存する。
//  ★LINE_SUPPORT_GROUP_IDS（カンマ区切り）を設定したら、そのグループ以外（友だち追加した人の1対1など）は保存しない。
//   未設定の間は全部保存する（最初にグループを作った時に group_id を知るため）。
//  ★メッセージの中身は「依頼の材料」。ここでは解釈も実行もしない（誰でも書ける文面をそのまま指示として扱わない）。
//
//  secrets: LINE_SUPPORT_CHANNEL_SECRET / LINE_SUPPORT_CHANNEL_ACCESS_TOKEN / LINE_SUPPORT_GROUP_IDS（任意）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SECRET       = Deno.env.get('LINE_SUPPORT_CHANNEL_SECRET') ?? ''
const TOKEN        = Deno.env.get('LINE_SUPPORT_CHANNEL_ACCESS_TOKEN') ?? ''
const GROUP_IDS    = (Deno.env.get('LINE_SUPPORT_GROUP_IDS') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const BUCKET       = 'support-line-media'
const MEDIA_TYPES  = ['image', 'video', 'audio', 'file']

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

/** x-line-signature の検証（タイミング差の出ない比較） */
async function validSignature(raw: string, signature: string): Promise<boolean> {
  if (!signature) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const expected = btoa(String.fromCharCode(...mac))
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

async function lineGet(url: string): Promise<Response | null> {
  if (!TOKEN) return null
  try { return await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } }) } catch { return null }
}

/**
 * 送った人の表示名（グループ・トークルーム・1対1で取り方が違う）。取れなければ name=null。
 * status は LINE の HTTP ステータス（取れなかった理由を受信箱の raw._diag に残す。401=アクセストークンが違う）
 */
async function displayNameOf(source: any): Promise<{ name: string | null; status: number | string }> {
  const uid = source?.userId
  if (!uid) return { name: null, status: 'no_user' }
  const url = source.type === 'group' ? `https://api.line.me/v2/bot/group/${source.groupId}/member/${uid}`
    : source.type === 'room' ? `https://api.line.me/v2/bot/room/${source.roomId}/member/${uid}`
    : `https://api.line.me/v2/bot/profile/${uid}`
  const res = await lineGet(url)
  if (!res) return { name: null, status: TOKEN ? 'fetch_failed' : 'no_token' }
  if (!res.ok) { console.warn('[support-line-webhook] profile failed:', res.status); return { name: null, status: res.status } }
  const j = await res.json().catch(() => null)
  return { name: (j?.displayName as string) ?? null, status: res.status }
}

/** 本文の代わりに残す一行（テキスト以外） */
function summaryOf(m: any): string | null {
  switch (m?.type) {
    case 'text': return m.text ?? ''
    case 'file': return `[ファイル] ${m.fileName ?? ''}`
    case 'image': return '[画像]'
    case 'video': return '[動画]'
    case 'audio': return '[音声]'
    case 'sticker': return `[スタンプ] ${(m.keywords ?? []).slice(0, 3).join('・')}`.trim()
    case 'location': return `[位置] ${m.title ?? ''} ${m.address ?? ''}`.trim()
    default: return m?.type ? `[${m.type}]` : null
  }
}

function extOf(contentType: string | null, m: any): string {
  const fromName = typeof m?.fileName === 'string' && m.fileName.includes('.') ? m.fileName.split('.').pop() : ''
  if (fromName) return fromName.toLowerCase().slice(0, 8)
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('jpeg')) return 'jpg'
  if (ct.includes('png')) return 'png'
  if (ct.includes('mp4')) return 'mp4'
  if (ct.includes('pdf')) return 'pdf'
  if (ct.includes('m4a') || ct.includes('aac')) return 'm4a'
  return 'bin'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('ok')
  if (!SECRET) return text('not_configured', 503)

  const raw = await req.text()
  if (!await validSignature(raw, req.headers.get('x-line-signature') ?? '')) return text('bad_signature', 401)

  let body: any = {}
  try { body = JSON.parse(raw) } catch { return text('bad_json', 400) }
  const events: any[] = Array.isArray(body?.events) ? body.events : []
  // Webhook の「検証」ボタンは events が空で届く → 200 を返すだけ
  if (!events.length) return text('ok')

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  for (const ev of events) {
    try {
      const source = ev?.source ?? {}
      const groupId = source.groupId ?? source.roomId ?? null
      if (GROUP_IDS.length && !(groupId && GROUP_IDS.includes(groupId))) continue

      const m = ev?.type === 'message' ? ev.message : null
      const key = m?.id ? `message:${m.id}` : `event:${ev?.webhookEventId ?? `${ev?.type}:${ev?.timestamp}`}`
      // 再送は保存し直さない（画像を二重に取りに行かない）
      const { data: dup } = await svc.from('support_line_messages').select('id').eq('line_event_key', key).maybeSingle()
      if (dup) continue

      let mediaPath: string | null = null
      let mediaType: string | null = null
      let mediaStatus: number | string | null = null
      if (m && MEDIA_TYPES.includes(m.type) && (m.contentProvider?.type ?? 'line') === 'line') {
        const res = await lineGet(`https://api-data.line.me/v2/bot/message/${m.id}/content`)
        mediaStatus = res ? res.status : (TOKEN ? 'fetch_failed' : 'no_token')
        if (res?.ok) {
          mediaType = res.headers.get('content-type')
          const path = `${new Date(ev.timestamp ?? Date.now()).toISOString().slice(0, 10)}/${m.id}.${extOf(mediaType, m)}`
          const { error } = await svc.storage.from(BUCKET).upload(path, new Uint8Array(await res.arrayBuffer()), { contentType: mediaType ?? 'application/octet-stream', upsert: true })
          if (!error) mediaPath = path
          else console.error('[support-line-webhook] media upload failed:', error.message)
        } else {
          console.warn('[support-line-webhook] media fetch failed:', res?.status ?? 'no_token')
        }
      }

      const profile = await displayNameOf(source)
      const { error } = await svc.from('support_line_messages').insert({
        line_event_key: key,
        event_type: ev?.type ?? 'unknown',
        message_type: m?.type ?? null,
        source_type: source.type ?? null,
        group_id: groupId,
        line_user_id: source.userId ?? null,
        display_name: profile.name,
        text: m ? summaryOf(m) : null,
        media_path: mediaPath,
        media_type: mediaType,
        sent_at: new Date(typeof ev?.timestamp === 'number' ? ev.timestamp : Date.now()).toISOString(),
        // _diag: 名前・添付を取りに行った時の LINE の答え（鍵の値は入れない）
        raw: { ...ev, _diag: { profile: profile.status, media: mediaStatus } },
      })
      // 同時に届いた再送が先に入っていた時の一意制約違反は無視してよい
      if (error && !String(error.message ?? '').includes('duplicate')) console.error('[support-line-webhook] insert failed:', error.message)
    } catch (e) {
      console.error('[support-line-webhook] event failed:', e)
    }
  }
  // LINE には常に 200（失敗を返すと再送が積み上がる。保存できなかったものはログに残る）
  return text('ok')
})
