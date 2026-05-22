// ============================================================
//  line-webhook
//  LINE Messaging API webhook 受信
//
//  対応イベント:
//    memberJoined → グループにLIFF URLを送信
// ============================================================

const LINE_TOKEN    = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const LIFF_URL      = 'https://liff.line.me/2009891277-sfUt1LJ9'
const WELCOME_MSG   = `日報入力はこちらから(グループノートにも掲載しています)\n${LIFF_URL}`

function ok() {
  return new Response('ok', { status: 200 })
}

async function pushMessage(to: string, text: string) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok()

  try {
    const body = await req.json() as { events?: any[] }
    const events = body.events ?? []

    for (const event of events) {
      if (event.type === 'memberJoined' && event.source?.groupId) {
        await pushMessage(event.source.groupId, WELCOME_MSG)
      }
    }
  } catch (e) {
    console.error('[line-webhook]', e)
  }

  return ok()
})
