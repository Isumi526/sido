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

const MAX_TICKETS = 40   // 直近の完了チケットを何件まで見るか（ダイジェストを持つのは一部なので広めに）
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

// 直近の完了チケット（このプロジェクトのみ）をNotionから取り、本文の「📋レビューダイジェスト」を材料にする。
// ★2026-09-20（幻覚対策）: タイトルだけを渡すと Ready の要望や廃止済み機能まで「できます」と断言した
//  （9/7 の 8問中5問）。ダイジェストは実装の要約なのでタイトルより信頼できる。ダイジェストが無い完了チケットは使わない。
//  「完了」＝本番反映済み（本番待ち／進行中はステータスで除外される）。
type SourceTicket = { title: string; digest: string; url: string }
const NOTION_H = () => ({ Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' })
const DIGEST_MAX = 1800

function blockText(b: any): string {
  const v = b?.[b?.type] ?? {}
  const rt = Array.isArray(v.rich_text) ? v.rich_text : []
  return rt.map((t: any) => t?.plain_text ?? '').join('')
}
/** 本文から「📋レビューダイジェスト」以降（次の見出し or 上限まで）を取り出す。無ければ '' */
async function fetchDigest(pageId: string): Promise<string> {
  const lines: string[] = []
  let capturing = false
  async function walk(id: string, depth: number) {
    if (depth > 3) return
    let cursor: string | null = null
    do {
      const url = `https://api.notion.com/v1/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
      const r = await fetch(url, { headers: NOTION_H() })
      if (!r.ok) return
      const j = await r.json()
      for (const b of j.results ?? []) {
        const t = blockText(b).trim()
        const isHeading = /^heading_/.test(String(b.type))
        if (!capturing && /レビューダイジェスト/.test(t)) { capturing = true; lines.push(t); if (b.has_children) await walk(b.id, depth + 1); continue }
        if (capturing) {
          // 次の見出し（🧪人力チェック手順 など）で打ち切る
          if (isHeading && !/レビューダイジェスト/.test(t)) return
          if (t) lines.push(t)
          if (b.has_children) await walk(b.id, depth + 1)
          if (lines.join('\n').length > DIGEST_MAX) return
        } else if (b.has_children) {
          await walk(b.id, depth + 1)
        }
      }
      cursor = j.has_more ? j.next_cursor : null
    } while (cursor)
  }
  await walk(pageId, 0)
  return lines.join('\n').slice(0, DIGEST_MAX)
}

async function fetchRecentCompletedTickets(): Promise<SourceTicket[]> {
  if (!NOTION_TOKEN) return []
  const res = await fetch(`https://api.notion.com/v1/data_sources/${BACKLOG_DATA_SOURCE}/query`, {
    method: 'POST', headers: NOTION_H(),
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
  const out: SourceTicket[] = []
  for (const page of data?.results ?? []) {
    const titleProp = page?.properties?.['タスク名']?.title ?? []
    const title = titleProp.map((t: any) => t.plain_text ?? '').join('').trim()
    if (!title) continue
    const digest = await fetchDigest(page.id)
    if (!digest) continue   // ★ダイジェストが無い完了チケットは材料にしない（実装の要約が無い＝根拠にできない）
    out.push({ title, digest, url: page.url ?? '' })
  }
  return out
}

// ── 既存FAQと同趣旨の質問を除外する（AC4）。文字2-gram の Jaccard ──
function normQ(s: string): string { return s.normalize('NFKC').replace(/[\s　？?。、,.!！「」『』（）()]/g, '').toLowerCase() }
function bigrams(s: string): Set<string> { const n = normQ(s); const out = new Set<string>(); for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2)); return out }
export function questionSimilarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0; for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}
const SIMILAR_THRESHOLD = 0.5

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
          sourceUrl: { type: 'string' },
        },
        required: ['question', 'answer', 'sourceUrl'],
      },
    },
  },
  required: ['candidates'],
}

type Candidate = { question: string; answer: string; category: string; sourceUrl: string }
async function generateCandidates(tickets: SourceTicket[], existingQuestions: string[]): Promise<Candidate[]> {
  if (!GEMINI_API_KEY || tickets.length === 0) return []
  const system = `あなたは建設業向けSaaS「GENLINKS」の、顧客企業の担当者向けFAQを作成するアシスタントです。
以下は本番に反映済みの開発チケットのタイトルと「レビューダイジェスト（実装内容の要約）」です。この中から、GENLINKSを実際に使う
顧客企業の担当者が疑問に思いそうな「使い方・仕様」に関する質問と回答だけを抽出してFAQ候補を作ってください。

★厳守（幻覚対策）:
- **根拠（ダイジェスト）に書かれていない機能・画面・動作は絶対に書かない**。ダイジェストに無いことは「できます」と言わない
- 「改善しました」「追加されました」「新しくなりました」のようなリリースノート文体は使わない。**今の使い方**として現在形で書く
- 各候補には根拠にしたチケットの URL を sourceUrl に**そのまま**入れる（一覧に無い URL は不可）
- ダイジェストが社内の実装・調査・不具合修正だけで顧客の操作に関係しない場合は候補にしない

★顧客向けFAQに絶対に含めないこと:
- 社内の実装方法・コード・データベース・テーブル名の話
- 契約・法務・訴訟・価格交渉など社内の商談事情
- 特定の個人名・社内の経営判断

★回答は簡潔・断定的に（根拠の範囲内で）。該当が無い場合は candidates を空配列にしてよい（無理に絞り出さない）。
★既に登録済みの質問と重複する内容は作らない。`
  const existingBlock = existingQuestions.length ? `\n\n【既に登録済みの質問（重複させない）】\n${existingQuestions.slice(0, 200).map((q, i) => `${i + 1}. ${q}`).join('\n')}` : ''
  const ticketsBlock = tickets.map((t, i) => `### ${i + 1}. ${t.title}\nURL: ${t.url}\n${t.digest}`).join('\n\n')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system + existingBlock }] },
      contents: [{ role: 'user', parts: [{ text: `本番反映済みチケット（タイトル・URL・レビューダイジェスト）:\n\n${ticketsBlock}` }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: FAQ_SCHEMA },
    }),
  })
  if (!res.ok) { console.error('[faq-generate] gemini failed', res.status, await res.text()); return [] }
  const j = await res.json()
  const raw = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed?.candidates) ? parsed.candidates : []
    const urls = new Set(tickets.map(t => t.url))
    const out: Candidate[] = []
    for (const c of list) {
      if (!c?.question || !c?.answer) continue
      // ★根拠URLが一覧に無い候補は捨てる（根拠の無い断言を通さない）
      if (!urls.has(String(c.sourceUrl ?? ''))) continue
      // ★リリースノート文体は捨てる（「〜しました」「〜されました」で終わる断言）
      if (/(改善|追加|変更|新しく|対応|修正)(し|され)ました/.test(String(c.answer))) continue
      const q = String(c.question).slice(0, 300)
      // ★既存FAQ・今回の他候補と同趣旨なら捨てる
      if (existingQuestions.some(e => questionSimilarity(e, q) >= SIMILAR_THRESHOLD)) continue
      if (out.some(o => questionSimilarity(o.question, q) >= SIMILAR_THRESHOLD)) continue
      out.push({ question: q, answer: String(c.answer).slice(0, 2000), category: String(c.category ?? '').slice(0, 60), sourceUrl: String(c.sourceUrl) })
      if (out.length >= MAX_CANDIDATES) break
    }
    return out
  } catch (e) {
    console.error('[faq-generate] gemini response not JSON', e instanceof Error ? e.message : String(e))
    return []
  }
}

async function fileReviewTicket(accountNames: string[], candidates: Candidate[]): Promise<string> {
  if (!NOTION_TOKEN) return ''
  const body = candidates.map((c, i) => [
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `${i + 1}. Q: ${c.question}` } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `   A: ${c.answer}` } }] } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: '   根拠: ' } }, { type: 'text', text: { content: c.sourceUrl, link: { url: c.sourceUrl } } }] } },
  ]).flat()
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST', headers: NOTION_H(),
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: BACKLOG_DATA_SOURCE },
      properties: {
        // ★1バッチ1件（テナントごとに作らない）。同じ製品FAQをテナント数分レビューさせない（2026-09-19）
        'タスク名': { title: [{ type: 'text', text: { content: `[AI生成FAQレビュー] FAQ候補 ${candidates.length}件（${accountNames.length}テナント共通）` } }] },
        'ステータス': { status: { name: 'レビュー待ち' } },
        '案件名': { relation: [{ id: BACKLOG_PROJECT_ID }] },
        'リスク': { select: { name: '🟢低' } },
      },
      children: [
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `faq-generate が自動生成したFAQ下書きです（対象テナント: ${accountNames.join('、')}）。下書きは全テナントに同じ内容で入っています。FAQ画面（/faq）で内容を確認し、問題なければ「有効」にしてください。誤りがあれば編集または削除してください。各Q&Aの「根拠」は本番反映済みチケットのレビューダイジェストです。` } }] } },
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

  let dryRun = false
  try { const b = await req.json(); dryRun = b?.dry_run === true } catch { /* 本文なし */ }

  const tickets = await fetchRecentCompletedTickets()
  if (tickets.length === 0) return json({ ok: true, accounts: 0, generated: 0, note: 'no_recent_tickets_with_digest' })

  const { data: accounts } = await svc.from('accounts').select('id, name')
  const all = (accounts ?? []) as { id: string; name: string }[]

  // ★生成は1回（製品FAQはテナント共通）。既存の質問は全テナントの分を合わせて重複除外に使う（AC4）
  const { data: existing } = await svc.from('faq_entries').select('question')
  const existingQuestions = [...new Set(((existing ?? []) as { question: string }[]).map(r => r.question))]
  const candidates = await generateCandidates(tickets, existingQuestions)
  if (dryRun) return json({ ok: true, dryRun: true, sources: tickets.map(t => ({ title: t.title, url: t.url, digestChars: t.digest.length })), candidates })
  if (candidates.length === 0) return json({ ok: true, accounts: all.length, generated: 0, note: 'no_candidates' })

  // 未レビューの下書きが既に残っているテナントには入れない（レビュー待ちが積み上がるのを防ぐ）
  const targets: { id: string; name: string }[] = []
  const skipped: string[] = []
  for (const acct of all) {
    const { data: pending } = await svc.from('faq_entries')
      .select('id').eq('account_id', acct.id).eq('source', 'ai-fable').eq('is_active', false).limit(1)
    if (pending && pending.length > 0) skipped.push(acct.name); else targets.push(acct)
  }
  if (targets.length === 0) return json({ ok: true, accounts: all.length, generated: 0, note: 'all_accounts_have_pending_drafts', skipped })

  // ★レビュー起票は1バッチ1件（AC3）
  const ticketUrl = await fileReviewTicket(targets.map(t => t.name), candidates)
  let totalGenerated = 0
  const results: { account: string; generated: number }[] = []
  for (const acct of targets) {
    const { error } = await svc.from('faq_entries').insert(candidates.map(c => ({
      account_id: acct.id, question: c.question, answer: c.answer, category: c.category || null,
      is_active: false, source: 'ai-fable', notion_ticket_url: ticketUrl || null,
    })))
    if (error) { console.error('[faq-generate] insert failed', acct.id, error); continue }
    totalGenerated += candidates.length
    results.push({ account: acct.name, generated: candidates.length })
  }
  return json({ ok: true, accounts: all.length, generated: totalGenerated, ticketUrl, results, skipped })
})
