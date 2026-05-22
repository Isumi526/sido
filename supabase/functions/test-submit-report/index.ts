// ============================================================
//  submit-report
//  日報受信 → LINE通知
// ============================================================
import { pushLineText } from '../_shared/line.ts'
import { buildReportMessage } from '../_shared/notify.ts'
import { resolveGroupIds } from '../_shared/resolveGroupId.ts'

const LINE_TOKEN     = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const PROD_GROUP_IDS = JSON.parse(Deno.env.get('NOTIFY_GROUP_IDS')     ?? '[]') as string[]
const DEV_GROUP_IDS  = JSON.parse(Deno.env.get('DEV_NOTIFY_GROUP_IDS') ?? '[]') as string[]
const LIFF_URL       = Deno.env.get('LIFF_URL') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // URL から関数名を取得し、test- で始まる場合は dev グループを使用
  const fnName = new URL(req.url).pathname.split('/').pop() ?? ''
  const isTest = fnName.startsWith('test-')

  try {
    const body = await req.json()
    const { sender = '不明', date, sites = [], note, isWorking, leaveType, _devNotifyGroupId, accountSlug } = body

    if (!date) return json({ error: '日付が指定されていません' }, 400)

    // accountSlug はLIFF側から送られるが、未対応の場合は環境変数のACCOUNT_SLUGを使用
    const resolvedSlug = accountSlug || Deno.env.get('ACCOUNT_SLUG') || null
    const targets: string[] = _devNotifyGroupId
      ? [_devNotifyGroupId]
      : await resolveGroupIds(resolvedSlug, isTest ? DEV_GROUP_IDS : PROD_GROUP_IDS)

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
