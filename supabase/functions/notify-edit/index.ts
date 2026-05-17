// ============================================================
//  notify-edit
//  日報編集通知 → LINE通知
// ============================================================
import { pushLineText } from '../_shared/line.ts'
import { buildEditMessage } from '../_shared/notify.ts'

const LINE_TOKEN   = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const GROUP_IDS    = JSON.parse(Deno.env.get('NOTIFY_GROUP_IDS') ?? '[]') as string[]
const DEV_GROUP_ID = Deno.env.get('DEV_NOTIFY_GROUP_ID') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    const { sender = '不明', date = '', editedAt = '', diffs = [], _devNotifyGroupId } = body

    if (diffs.length === 0) return json({ status: 'no_changes' })

    const targets: string[] = _devNotifyGroupId
      ? [_devNotifyGroupId]
      : (DEV_GROUP_ID ? [DEV_GROUP_ID] : GROUP_IDS)

    const text = buildEditMessage({ sender, date, editedAt, diffs })
    await Promise.all(targets.map(id => pushLineText(id, text, LINE_TOKEN)))

    return json({ success: true })
  } catch (e) {
    console.error('[notify-edit]', e)
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
