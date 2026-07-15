// ============================================================
//  useChatMentionSegments.ts — チャット本文中の @名前 を検出し、色付き表示用に
//  テキストセグメントへ分割する。v-htmlは使わずテキストノード/spanを分けて
//  描画する前提(呼び出し側でVueのテキスト補間{{ }}を使えばXSS対策になる)。
//  apps/admin/src/lib/chatMentionSegments.ts と同型(アプリ間でモジュール共有していないため複製)。
// ============================================================
export type MentionSegment = { text: string; mention: boolean }

export function splitMentionSegments(body: string, knownNames: string[]): MentionSegment[] {
  const names = [...new Set(knownNames.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!body || !names.length) return [{ text: body, mention: false }]

  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`@(?:${escaped.join('|')})(?=\\s|$)`, 'g')

  const segments: MentionSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    if (match.index > lastIndex) segments.push({ text: body.slice(lastIndex, match.index), mention: false })
    segments.push({ text: match[0], mention: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < body.length) segments.push({ text: body.slice(lastIndex), mention: false })
  return segments.length ? segments : [{ text: body, mention: false }]
}
