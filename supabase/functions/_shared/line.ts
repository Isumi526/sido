// ============================================================
//  _shared/line.ts
//  LINE Messaging API ヘルパー
// ============================================================

const LINE_API = 'https://api.line.me/v2/bot/message/push'

export async function pushLineMessages(
  to: string,
  messages: { type: string; text: string }[],
  token: string,
): Promise<void> {
  const res = await fetch(LINE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages }),
  })
  const resBody = await res.text()
  if (!res.ok) {
    console.error(`[LINE] push failed to=${to} status=${res.status} body=${resBody}`)
  } else {
    console.log(`[LINE] push ok to=${to} status=${res.status}`)
  }
}

export async function pushLineText(
  to: string,
  text: string,
  token: string,
): Promise<void> {
  await pushLineMessages(to, [{ type: 'text', text }], token)
}
