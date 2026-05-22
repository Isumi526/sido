// ============================================================
//  submit-report
//  日報受信 → LINE通知
// ============================================================
import { pushLineText } from '../_shared/line.ts'
import { buildReportMessage } from '../_shared/notify.ts'

// NOTIFY_GROUP_IDS は JSON配列 or カンマ区切り文字列どちらでも受け付ける
function parseGroupIds(raw: string | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) as string[] } catch { return [] }
  }
  return trimmed.split(',').map(s => s.trim()).filter(Boolean)
}

const LINE_TOKEN     = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const PROD_GROUP_IDS = parseGroupIds(Deno.env.get('NOTIFY_GROUP_IDS'))
const DEV_GROUP_IDS  = parseGroupIds(Deno.env.get('DEV_NOTIFY_GROUP_IDS'))
const LIFF_URL       = Deno.env.get('LIFF_URL') ?? ''

console.log('[submit-report] init PROD_GROUP_IDS:', PROD_GROUP_IDS, 'DEV_GROUP_IDS:', DEV_GROUP_IDS)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const fnName = new URL(req.url).pathname.split('/').pop() ?? ''
  const isTest = fnName.startsWith('test-')

  try {
    const body = await req.json()
    const { sender = '不明', date, sites = [], note, isWorking, leaveType, _devNotifyGroupId, accountSlug } = body

    if (!date) return json({ error: '日付が指定されていません' }, 400)

    const targets: string[] = _devNotifyGroupId
      ? [_devNotifyGroupId]
      : (isTest ? DEV_GROUP_IDS : PROD_GROUP_IDS)

    console.log(`[submit-report] date=${date} sender=${sender} isTest=${isTest} targets=${JSON.stringify(targets)} leaveType=${leaveType} isWorking=${isWorking}`)

    if (targets.length === 0) {
      console.error('[submit-report] targets is empty! NOTIFY_GROUP_IDS may not be set correctly.')
      return json({ error: 'no targets', debug: { isTest, PROD_GROUP_IDS, DEV_GROUP_IDS } }, 500)
    }

    // 有給
    if (leaveType === 'paid_leave') {
      const text = `📋 ${fmtDate(date)} 日報\n👤 ${sender}\n──────────\n🌴 有給休暇${note ? '\n\n📝 ' + note : ''}`
      await Promise.all(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
      return json({ success: true })
    }

    // 稼働なし
    if (isWorking === false) {
      const text = `📋 ${fmtDate(date)} 日報\n👤 ${sender}\n──────────\n稼働なし${note ? '\n\n📝 ' + note : ''}`
      await Promise.all(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
      return json({ success: true })
    }

    const text = buildReportMessage({ sender, date, sites, note }, LIFF_URL, accountSlug ?? '')
    const results = await Promise.allSettled(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
    console.log('[submit-report] LINE push results:', JSON.stringify(results))

    return json({ success: true })
  } catch (e) {
    console.error('[submit-report] error:', e)
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
