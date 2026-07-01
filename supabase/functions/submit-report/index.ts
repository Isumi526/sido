// ============================================================
//  submit-report
//  日報受信 → LINE通知
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pushLineText } from '../_shared/line.ts'
import { buildReportMessage } from '../_shared/notify.ts'
import { isReportNotifyEnabled, resolveGroupIds } from '../_shared/resolveGroupId.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

// グループID環境変数（DEV_NOTIFY_GROUP_IDS 等）は JSON配列 or カンマ区切り文字列どちらでも受け付ける
function parseGroupIds(raw: string | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) as string[] } catch { return [] }
  }
  return trimmed.split(',').map(s => s.trim()).filter(Boolean)
}

const LINE_TOKEN     = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
// ⚠️ 本番の送信先は「テナントごとの settings.notify_group_id」だけを使う（resolveGroupIds）。
//   グローバル env NOTIFY_GROUP_IDS へのフォールバックはクロステナント漏洩の原因だったため撤廃。
//   未設定テナントは送らない（下の targets.length===0 で graceful skip）。
const DEV_GROUP_IDS  = parseGroupIds(Deno.env.get('DEV_NOTIFY_GROUP_IDS'))
const LIFF_URL       = Deno.env.get('LIFF_URL') ?? ''

console.log('[submit-report] init DEV_GROUP_IDS:', DEV_GROUP_IDS)

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
    const { sender = '不明', date, sites = [], note, isWorking, leaveType, _devNotifyGroupId, accountSlug, senderId } = body

    if (!date) return json({ error: '日付が指定されていません' }, 400)

    // アカウント単位で日報通知が OFF の場合は送信せず終了
    if (!(await isReportNotifyEnabled(accountSlug))) {
      console.log(`[submit-report] 日報通知OFF (account=${accountSlug}) → 送信スキップ`)
      return json({ success: true, skipped: 'notify_disabled' })
    }

    // 本番の送信先は「そのテナント(accountSlug)の settings.notify_group_id」だけ（未設定なら空=送らない）。
    //   グローバルフォールバックは撤廃済み＝他テナントのグループへ流れる余地は無い。
    const targets: string[] = _devNotifyGroupId
      ? [_devNotifyGroupId]
      : (isTest ? DEV_GROUP_IDS : await resolveGroupIds(accountSlug, []))

    console.log(`[submit-report] date=${date} sender=${sender} account=${accountSlug} isTest=${isTest} targets=${JSON.stringify(targets)} leaveType=${leaveType} isWorking=${isWorking}`)

    // 送信先グループが未設定のテナントは通知しない（エラーではなく正常スキップ＝クロステナント防止の既定動作）。
    if (targets.length === 0) {
      console.log(`[submit-report] 送信先グループ未設定 (account=${accountSlug}) → 送信スキップ`)
      return json({ success: true, skipped: 'no_group_configured' })
    }

    // 有給
    if (leaveType === 'paid_leave') {
      const text = `📋 ${fmtDate(date)} 日報\n👤 ${sender}\n──────────\n🌴 有給休暇${note ? '\n\n📝 ' + note : ''}`
      const results = await Promise.allSettled(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
      if (results.some(r => r.status === 'fulfilled' && r.value === true)) {
        markNotified(senderId, date, accountSlug).catch(e =>
          console.error('[submit-report] line_notified_at update failed:', e)
        )
      }
      return json({ success: true })
    }

    // 稼働なし
    if (isWorking === false) {
      const text = `📋 ${fmtDate(date)} 日報\n👤 ${sender}\n──────────\n稼働なし${note ? '\n\n📝 ' + note : ''}`
      const results = await Promise.allSettled(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
      if (results.some(r => r.status === 'fulfilled' && r.value === true)) {
        markNotified(senderId, date, accountSlug).catch(e =>
          console.error('[submit-report] line_notified_at update failed:', e)
        )
      }
      return json({ success: true })
    }

    const text = buildReportMessage({ sender, date, sites, note }, LIFF_URL, accountSlug ?? '')
    const results = await Promise.allSettled(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
    console.log('[submit-report] LINE push results:', JSON.stringify(results))

    if (results.some(r => r.status === 'fulfilled' && r.value === true)) {
      markNotified(senderId, date, accountSlug).catch(e =>
        console.error('[submit-report] line_notified_at update failed:', e)
      )
    }

    return json({ success: true })
  } catch (e) {
    console.error('[submit-report] error:', e)
    return json({ error: String(e) }, 500)
  }
})

async function markNotified(lineUserId: string | undefined, date: string, accountSlug: string | undefined) {
  if (!lineUserId || !date || !accountSlug) return
  const [{ data: account }, { data: user }] = await Promise.all([
    supabase.from('accounts').select('id').eq('slug', accountSlug).maybeSingle(),
    supabase.from('users').select('id').eq('line_user_id', lineUserId).maybeSingle(),
  ])
  if (!account || !user) return
  await supabase
    .from('daily_reports')
    .update({ line_notified_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('date', date)
    .eq('account_id', account.id)
}

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
