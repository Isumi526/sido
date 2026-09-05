// ============================================================
//  faq-generate
//  AIヘルプのナレッジ(FAQ)をFableに定期生成させる（2026-08-30運用者判断）。
//
//  ★元ネタは今回「Notionバックログの完了チケットのみ」に絞った。
//   決定事項は「Notionだけ（仕様書・議事録・バックログ）」だったが、議事録データ
//   ソースはこのEFが使うNotion連携（integration "cc-pipeline"）に共有されておらず
//   （2026-09-03 実測: /v1/data_sources/<議事録DS>/query が 404 object_not_found）、
//   現状アクセスできない。バックログ(完了チケット)は連携済みで取得できるため、
//   まずここだけで着手した。議事録も対象に広げるには、運用者に議事録データベースを
//   integration "cc-pipeline" に共有してもらう必要がある（継続タスク）。
//
//  ★生成物は必ず is_active=false（下書き）で作る。自動で全社員に配られる回答には
//   絶対に使われない。人がFAQ画面（apps/admin/src/pages/faq.vue）でレビューして
//   有効化するまで無効のまま（2026-08-15 運用者回答＝Q2=A）。
//
//  ★プロンプトで明示的に除外している内容（顧客向けFAQに漏らしてはいけないもの）:
//   内部の実装詳細・法務/契約/訴訟の話・価格交渉の内部事情・個人名・経営判断。
//   AIヘルプは「テナントの担当者」に見せるものなので、社内の開発チケットの生の文言を
//   そのまま出さない（あくまでそこから「顧客が使う機能の使い方」を抽出させる）。
//
//  ★生成のたびに、対象アカウントごとに1件Notionへレビュー依頼チケットを起票する
//   （2026-08-15 運用者回答＝Q2追記「人レビューが発生するたびにNotionでチケット化」）。
//   同じ完了チケット群からの重複起票を防ぐため、直近のNotionチケットURLを
//   faq_entries.notion_ticket_url に記録し、既にそのURLを持つ下書きが残っている間は
//   再起票しない。
//
//  トリガー: 週1（pg_cron・月曜9:00 JST）。認可は _shared/reminder-auth.ts と同じ
//   共有シークレット方式を流用（x-reminder-secret ヘッダ）。管理画面からの手動実行は
//   認証済みユーザーJWTでも可。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeReminderTrigger } from '../_shared/reminder-auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ANON_KEY

const NOTION_TOKEN = Deno.env.get('NOTION_TOKEN') ?? ''
const BACKLOG_DATA_SOURCE = Deno.env.get('BACKLOG_DATA_SOURCE') ?? 'a7f5a28f-22af-4bc1-a512-4d427a934f31'
const BACKLOG_PROJECT_ID = Deno.env.get('BACKLOG_PROJECT_ID') ?? '3540ff81c56b802e871dca995e01718f'

const GEMINI_API_KEY = Deno.env.get('GEMINI_REVIEW_API_KEY') ?? ''
const GEMINI_MODEL = Deno.env.get('GEMINI_REVIEW_MODEL') ?? 'gemini-3.5-flash'

const MAX_TICKETS = 20   // 直近の完了チケットを何件まで見るか
const MAX_CANDIDATES = 8 // 1回の生成で作る下書きFAQの上限（大量生成して質が下がるのを防ぐ）

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reminder-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } })
}

// 直近の完了チケット（このプロジェクトのみ）をNotionから取る。タイトルと本文冒頭だけ使う
// （長文全部を渡すとプロンプトが肥大し、社内の込み入った経緯まで混ざりやすくなる）。
async function fetchRecentCompletedTickets(): Promise<{ title: string; excerpt: string; url: string }[]> {
  if (!NOTION_TOKEN) return []
  const res = await fetch(`https://api.notion.com/v1/data_sources/${BACKLOG_DATA_SOURCE}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'ステータス', status: { equals: '完了' } },
          { property: '案件名', relation: { contains: BACKLOG_PROJECT_ID } },
        ],
      },
      sorts: [{ property: '完了日', direction: 'descending' }],
      page_size: MAX_TICKETS,
    }),
  })
  if (!res.ok) { console.error('[faq-generate] notion query failed', res.status, await res.text()); return [] }
  const data = await res.json()
  const out: { title: string; excerpt: string; url: string }[] = []
  for (const page of data?.results ?? []) {
    const titleProp = page?.properties?.['タスク名']?.title ?? []
    const title = titleProp.map((t: any) => t.plain_text ?? '').join('').trim()
    if (!title) continue
    out.push({ title, excerpt: '', url: page.url ?? '' })
  }
  return out
}

const FAQ_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['question', 'answer'],
      },
    },
  },
  required: ['candidates'],
}

async function generateCandidates(tickets: { title: string }[], existingQuestions: string[]): Promise<{ question: string; answer: string; category: string }[]> {
  if (!GEMINI_API_KEY || tickets.length === 0) return []
  const system = `あなたは建設業向けSaaS「GENLINKS」の、顧客企業の担当者向けFAQを作成するアシスタントです。
以下は直近で開発チームが対応した社内の開発チケットのタイトル一覧です。この中から、GENLINKSを実際に使う
顧客企業の担当者が疑問に思いそうな「使い方・仕様」に関する質問と回答だけを抽出してFAQ候補を作ってください。

★厳守（顧客向けFAQに絶対に含めないこと）:
- 社内の実装方法・コード・データベースの話
- 契約・法務・訴訟・価格交渉など社内の商談事情
- 特定の個人名・社内の経営判断
- チケットのタイトルが社内向けの不具合修正や調査のみで、顧客の操作方法に関係しないもの（それは無視してよい）

★回答は簡潔・断定的に。分からない/該当が無い場合は candidates を空配列にしてよい（無理に絞り出さない）。
★既に登録済みの質問と重複する内容は作らない。`
  const existingBlock = existingQuestions.length ? `\n\n【既に登録済みの質問（重複させない）】\n${existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : ''
  const ticketsBlock = tickets.map((t, i) => `${i + 1}. ${t.title}`).join('\n')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system + existingBlock }] },
      contents: [{ role: 'user', parts: [{ text: `直近の完了チケット一覧:\n${ticketsBlock}` }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: FAQ_SCHEMA },
    }),
  })
  if (!res.ok) { console.error('[faq-generate] gemini failed', res.status, await res.text()); return [] }
  const j = await res.json()
  const raw = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed?.candidates) ? parsed.candidates : []
    return list
      .filter((c: any) => c?.question && c?.answer)
      .slice(0, MAX_CANDIDATES)
      .map((c: any) => ({ question: String(c.question).slice(0, 300), answer: String(c.answer).slice(0, 2000), category: String(c.category ?? '').slice(0, 60) }))
  } catch (e) {
    console.error('[faq-generate] gemini response not JSON', e instanceof Error ? e.message : String(e))
    return []
  }
}

async function fileReviewTicket(accountName: string, candidates: { question: string; answer: string }[]): Promise<string> {
  if (!NOTION_TOKEN) return ''
  const body = candidates.map((c, i) => [
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `${i + 1}. Q: ${c.question}` } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `   A: ${c.answer}` } }] } },
  ]).flat()
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: BACKLOG_DATA_SOURCE },
      properties: {
        'タスク名': { title: [{ type: 'text', text: { content: `[AI生成FAQレビュー] ${accountName} 向けFAQ候補 ${candidates.length}件` } }] },
        'ステータス': { status: { name: 'レビュー待ち' } },
        '案件名': { relation: [{ id: BACKLOG_PROJECT_ID }] },
        'リスク': { select: { name: '🟢低' } },
      },
      children: [
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'faq-generate が自動生成したFAQ下書きです。FAQ画面（/faq）で内容を確認し、問題なければ「有効」にしてください。誤りがあれば編集または削除してください。' } }] } },
        ...body,
      ],
    }),
  })
  if (!res.ok) { console.error('[faq-generate] ticket create failed', res.status, await res.text()); return '' }
  const page = await res.json()
  return page?.url ?? ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const authClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  if (!(await authorizeReminderTrigger(req, authClient))) return json({ ok: false, error: 'unauthorized' }, 401)
  if (!NOTION_TOKEN) return json({ ok: false, error: 'notion_unconfigured' }, 503)
  if (!GEMINI_API_KEY) return json({ ok: false, error: 'gemini_unconfigured' }, 503)

  const tickets = await fetchRecentCompletedTickets()
  if (tickets.length === 0) return json({ ok: true, accounts: 0, generated: 0, note: 'no_recent_tickets' })

  const { data: accounts } = await svc.from('accounts').select('id, name')
  let totalGenerated = 0
  const results: { account: string; generated: number; ticketUrl: string }[] = []

  for (const acct of (accounts ?? []) as { id: string; name: string }[]) {
    // 未レビューの下書きが既に残っている間は追加生成しない（レビュー待ちが積み上がるのを防ぐ）
    const { data: pending } = await svc.from('faq_entries')
      .select('id').eq('account_id', acct.id).eq('source', 'ai-fable').eq('is_active', false).limit(1)
    if (pending && pending.length > 0) { results.push({ account: acct.name, generated: 0, ticketUrl: '(未レビューの下書きが残っているためスキップ)' }); continue }

    const { data: existing } = await svc.from('faq_entries').select('question').eq('account_id', acct.id)
    const existingQuestions = ((existing ?? []) as { question: string }[]).map(r => r.question)

    const candidates = await generateCandidates(tickets, existingQuestions)
    if (candidates.length === 0) { results.push({ account: acct.name, generated: 0, ticketUrl: '' }); continue }

    const ticketUrl = await fileReviewTicket(acct.name, candidates)
    const { error } = await svc.from('faq_entries').insert(candidates.map(c => ({
      account_id: acct.id, question: c.question, answer: c.answer, category: c.category || null,
      is_active: false, source: 'ai-fable', notion_ticket_url: ticketUrl || null,
    })))
    if (error) { console.error('[faq-generate] insert failed', acct.id, error); continue }
    totalGenerated += candidates.length
    results.push({ account: acct.name, generated: candidates.length, ticketUrl })
  }

  return json({ ok: true, accounts: (accounts ?? []).length, generated: totalGenerated, results })
})
