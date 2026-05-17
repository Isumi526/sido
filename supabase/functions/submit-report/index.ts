// ============================================================
//  submit-report
//  日報受信 → LINE通知
// ============================================================
import { pushLineText } from '../_shared/line.ts'
import { buildReportMessage } from '../_shared/notify.ts'

const LINE_TOKEN   = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const GROUP_IDS    = JSON.parse(Deno.env.get('NOTIFY_GROUP_IDS') ?? '[]') as string[]
const ACCOUNT_SLUG = Deno.env.get('ACCOUNT_SLUG') ?? ''
const LIFF_URL     = Deno.env.get('LIFF_URL') ?? ''
const DEV_GROUP_ID = Deno.env.get('DEV_NOTIFY_GROUP_ID') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const { sender = '不明', date, sites = [], note, senderId, isWorking, _devNotifyGroupId } = body

    if (!date) return json({ error: '日付が指定されていません' }, 400)

    const targets: string[] = _devNotifyGroupId
      ? [_devNotifyGroupId]
      : (DEV_GROUP_ID ? [DEV_GROUP_ID] : GROUP_IDS)

    // 稼働なし
    if (isWorking === false) {
      const text = `📋 ${fmtDate(date)} 日報\n👤 ${sender}\n──────────\n稼働なし${note ? '\n\n📝 ' + note : ''}`
      await Promise.all(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
      return json({ success: true })
    }

    const text = buildReportMessage({ sender, date, sites, note }, LIFF_URL, ACCOUNT_SLUG)
    await Promise.all(targets.map(id => pushLineText(id, text, LINE_TOKEN)))

    return json({ success: true })
  } catch (e) {
    console.error('[submit-report]', e)
    return json({ error: String(e) }, 500)
  }
})

function fmtDate(date: string): string {
  const WEEKDAYS = ['日','月','火','水','木','金','土']
  const d = new Date(date + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}

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
