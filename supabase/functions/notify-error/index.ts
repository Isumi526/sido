// ============================================================
//  notify-error
//  エラー通知 → LINE通知
// ============================================================
import { pushLineText } from '../_shared/line.ts'
import { buildErrorMessage } from '../_shared/notify.ts'

const LINE_TOKEN     = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const PROD_GROUP_IDS = JSON.parse(Deno.env.get('NOTIFY_GROUP_IDS') ?? '[]') as string[]
const DEV_GROUP_IDS  = JSON.parse(Deno.env.get('DEV_NOTIFY_GROUP_IDS') ?? '[]') as string[]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const fnName = new URL(req.url).pathname.split('/').pop() ?? ''
  const isTest = fnName.startsWith('test-')

  try {
    const body = await req.json()
    const { sender = '不明', date, actionName, error = '不明なエラー', _devNotifyGroupId } = body

    const targets: string[] = _devNotifyGroupId
      ? [_devNotifyGroupId]
      : (isTest ? DEV_GROUP_IDS : PROD_GROUP_IDS)

    const text = buildErrorMessage({ sender, date, actionName, error })
    await Promise.all(targets.map(id => pushLineText(id, text, LINE_TOKEN)))

    return json({ success: true })
  } catch (e) {
    console.error('[notify-error]', e)
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
