// ============================================================
//  _shared/line.ts
//  LINE Messaging API ヘルパー
// ============================================================

const LINE_API = 'https://api.line.me/v2/bot/message/push'

export type LinePushResult = { ok: boolean; status: number; body: string }

// 詳細版: status/body を返す（呼び出し側でエラー内容を握り潰さず扱える）
export async function pushLineMessagesResult(
  to: string,
  messages: { type: string; text: string }[],
  token: string,
): Promise<LinePushResult> {
  const res = await fetch(LINE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ to, messages }),
  })
  const body = await res.text()
  if (!res.ok) {
    console.error(`[LINE] push failed to=${to} status=${res.status} body=${body}`)
    return { ok: false, status: res.status, body }
  }
  return { ok: true, status: res.status, body }
}

// boolean 互換版（既存呼び出し元が `=== true` で判定しているため維持）
export async function pushLineMessages(
  to: string,
  messages: { type: string; text: string }[],
  token: string,
): Promise<boolean> {
  return (await pushLineMessagesResult(to, messages, token)).ok
}

export async function pushLineText(
  to: string,
  text: string,
  token: string,
): Promise<boolean> {
  return pushLineMessages(to, [{ type: 'text', text }], token)
}
