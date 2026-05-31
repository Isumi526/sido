// ============================================================
//  notify-edit
//  日報編集通知 → LINE通知
//  ※ dev/test 用コピー（LIFF dev は test-notify-edit を呼ぶ）。
//    本番 notify-edit と同一ロジック。
// ============================================================
import { pushLineText } from '../_shared/line.ts'
import { buildEditMessage } from '../_shared/notify.ts'
import { resolveGroupIds, isReportNotifyEnabled } from '../_shared/resolveGroupId.ts'

const LINE_TOKEN     = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const PROD_GROUP_IDS = JSON.parse(Deno.env.get('NOTIFY_GROUP_IDS')     ?? '[]') as string[]
const DEV_GROUP_IDS  = JSON.parse(Deno.env.get('DEV_NOTIFY_GROUP_IDS') ?? '[]') as string[]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const fnName = new URL(req.url).pathname.split('/').pop() ?? ''
  const isTest = fnName.startsWith('test-')

  try {
    const body = await req.json()
    const { sender = '不明', date = '', editedAt = '', diffs = [], _devNotifyGroupId, accountSlug } = body

    if (diffs.length === 0) return json({ status: 'no_changes' })

    const resolvedSlug = accountSlug || Deno.env.get('ACCOUNT_SLUG') || null

    // アカウント単位で日報通知が OFF の場合は送信せず終了
    if (!(await isReportNotifyEnabled(resolvedSlug))) {
      console.log(`[notify-edit] 日報通知OFF (account=${resolvedSlug}) → 送信スキップ`)
      return json({ success: true, skipped: 'notify_disabled' })
    }

    const targets: string[] = _devNotifyGroupId
      ? [_devNotifyGroupId]
      : await resolveGroupIds(resolvedSlug, isTest ? DEV_GROUP_IDS : PROD_GROUP_IDS)

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
