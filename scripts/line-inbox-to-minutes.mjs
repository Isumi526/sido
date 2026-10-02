#!/usr/bin/env node
// ============================================================
//  scripts/line-inbox-to-minutes.mjs
//  グループLINE（GENLINKS の公式 LINE を入れたシードの管理側とのグループ）の受信箱 support_line_messages の
//  未処理分を、議事録DB（種別＝LINE・処理状態＝未処理）の1行にまとめて移す（2026-10-02）。
//  そのあとは /intake が議事録DBの未処理を transcript-digest の手順で依頼に切り出す（会議の文字起こしと同じ流れ）。
//
//  ★メッセージは誰でも書ける「依頼の材料」。ここでは要約も解釈もせず、原文を時刻・送った人つきでそのまま写す。
//  ★移した行には processed_at / minutes_page_id を付ける（2回取り込まない）。Notion への作成に失敗したら付けない。
//
//  使い方（リポのルートで）:
//    node --env-file=.env scripts/line-inbox-to-minutes.mjs            … 本番の受信箱 → 議事録DB
//    node --env-file=.env scripts/line-inbox-to-minutes.mjs --dry-run  … 写す内容を表示するだけ（何も書かない）
//    … --media <dir>   画像・ファイルも <dir> に保存する（/intake で中身を見るため）
//  env: NOTION_TOKEN, SUPABASE_PROD_SERVICE_ROLE_KEY（本番）。
//       SUPPORT_LINE_SUPABASE_URL / SUPPORT_LINE_SERVICE_KEY を渡すとそちらを読む（ローカルの試験用）
//  終了コード: 0=取り込んだ／未処理なし, 1=失敗
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const mediaIdx = args.indexOf('--media')
const MEDIA_DIR = mediaIdx >= 0 ? args[mediaIdx + 1] : null

const PROD_URL = 'https://nrzzesbtvswoiouhldvi.supabase.co'
const SB_URL = process.env.SUPPORT_LINE_SUPABASE_URL || PROD_URL
const SB_KEY = process.env.SUPPORT_LINE_SERVICE_KEY || process.env.SUPABASE_PROD_SERVICE_ROLE_KEY || ''
const NOTION_TOKEN = process.env.NOTION_TOKEN || ''
const MINUTES_DS = process.env.MINUTES_DS_ID || 'b5a34ae0-d5cd-4448-87a4-6a5035358e91'
const PROJECT_PAGE = '3540ff81-c56b-802e-871d-ca995e01718f'   // 案件管理マスタの GENLINKS 行
const BUCKET = 'support-line-media'

if (!SB_KEY) { console.error('Supabase の service key がありません（.env の SUPABASE_PROD_SERVICE_ROLE_KEY）'); process.exit(1) }
if (!DRY && !NOTION_TOKEN) { console.error('NOTION_TOKEN がありません（リポのルートで --env-file=.env を付けて実行）'); process.exit(1) }

const sb = (p, init = {}) => fetch(`${SB_URL}${p}`, {
  ...init,
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
})

const res = await sb('/rest/v1/support_line_messages?processed_at=is.null&order=sent_at.asc&select=id,event_type,message_type,source_type,group_id,display_name,line_user_id,text,media_path,sent_at')
if (!res.ok) { console.error('受信箱を読めません:', res.status, await res.text()); process.exit(1) }
const rows = await res.json()
if (!rows.length) { console.log('未処理のメッセージはありません'); process.exit(0) }

const jst = (iso, opt) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...opt }).format(new Date(iso))
const ymd = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
const EVENT_LABEL = { join: '（公式アカウントがグループに参加）', leave: '（公式アカウントがグループから退出）', memberJoined: '（メンバーが参加）', memberLeft: '（メンバーが退出）' }

// 原文を「[10/02 09:15] 名前: 本文」の形でそのまま並べる
const lines = rows.map(r => {
  const when = jst(r.sent_at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const who = r.display_name || (r.line_user_id ? `不明(${String(r.line_user_id).slice(-6)})` : '—')
  const body = r.event_type === 'message' ? (r.text ?? '') : (EVENT_LABEL[r.event_type] ?? `（${r.event_type}）`)
  const media = r.media_path ? `　＜添付: ${BUCKET}/${r.media_path}＞` : ''
  return `[${when}] ${who}: ${body}${media}`
})
const people = [...new Set(rows.map(r => r.display_name).filter(Boolean))]
const from = ymd(rows[0].sent_at)
const to = ymd(rows[rows.length - 1].sent_at)
const title = `${from === to ? from : `${from}〜${to.slice(5)}`} グループLINE（${rows.filter(r => r.event_type === 'message').length}件）`

if (DRY) {
  console.log(`# ${title}\n出席者: ${people.join('・') || '—'}\n`)
  console.log(lines.join('\n'))
  process.exit(0)
}

// 添付も手元に（/intake で中身を見る時に使う）
if (MEDIA_DIR) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
  for (const r of rows.filter(x => x.media_path)) {
    const m = await sb(`/storage/v1/object/${BUCKET}/${r.media_path}`)
    if (m.ok) fs.writeFileSync(path.join(MEDIA_DIR, r.media_path.replace(/\//g, '_')), Buffer.from(await m.arrayBuffer()))
    else console.warn('添付を取れませんでした:', r.media_path, m.status)
  }
}

// Notion の段落は1つ2000字まで。行の切れ目で詰める
const chunks = []
let cur = ''
for (const l of lines) {
  if ((cur + '\n' + l).length > 1900) { if (cur) chunks.push(cur); cur = l.slice(0, 1900) } else cur = cur ? `${cur}\n${l}` : l
}
if (cur) chunks.push(cur)
const rt = (s) => [{ type: 'text', text: { content: s } }]
const H = { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' }
const page = await fetch('https://api.notion.com/v1/pages', {
  method: 'POST', headers: H,
  body: JSON.stringify({
    parent: { type: 'data_source_id', data_source_id: MINUTES_DS },
    properties: {
      'タイトル': { title: rt(title) },
      '日付': { date: { start: to } },
      '種別': { select: { name: 'LINE' } },
      '処理状態': { select: { name: '未処理' } },
      '案件': { relation: [{ id: PROJECT_PAGE }] },
      '出席者': { rich_text: rt(people.join('・').slice(0, 1900)) },
      '本文': { rich_text: rt(lines.join('\n').slice(0, 1900)) },
      'メモ': { rich_text: rt('案件＝GENLINKS／相手＝シードの管理側（グループLINE・scripts/line-inbox-to-minutes.mjs が受信箱から作成）') },
    },
    children: [
      { object: 'block', type: 'paragraph', paragraph: { rich_text: rt('グループLINEの原文（時刻は日本時間）。依頼の切り出しは /intake（transcript-digest）で行う。') } },
      ...chunks.map(c => ({ object: 'block', type: 'code', code: { language: 'plain text', rich_text: rt(c) } })),
    ],
  }),
})
const pj = await page.json().catch(() => ({}))
if (!page.ok || !pj.id) { console.error('議事録DBに作れませんでした:', page.status, JSON.stringify(pj).slice(0, 300)); process.exit(1) }

const ids = rows.map(r => r.id)
const done = await sb(`/rest/v1/support_line_messages?id=in.(${ids.join(',')})`, {
  method: 'PATCH', headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ processed_at: new Date().toISOString(), minutes_page_id: pj.id }),
})
if (!done.ok) { console.error('取り込み済みの印を付けられませんでした（議事録DBの行は作成済み）:', done.status, pj.url); process.exit(1) }
console.log(`取り込みました: ${title}\n${pj.url}`)
