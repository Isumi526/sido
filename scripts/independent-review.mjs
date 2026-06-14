// ============================================================
//  scripts/independent-review.mjs
//  Claude製コードを「独立した別AI(Gemini)」でレビューする専用スクリプト。
//   - レビュー専用キー GEMINI_REVIEW_API_KEY（アプリの解析キーとは別）。
//   - .kody/rules/*.md（ルール）＋ /run から渡される ticket要件 を Gemini に与え、
//     diff をレビューさせ JSON で受ける。コードは一切書き換えない（レビュー専用）。
//   - critical/🔴 があれば対象Notionチケットに「要人間verdict」を立てる（--ticket-id 指定時）。
//  使い方:
//    node scripts/independent-review.mjs [<diff範囲>] [--json] [--dry-run]
//        [--ticket-id <NotionページID>] [--ticket-file <要件mdパス>]   (要件は stdin でも可)
//    既定 diff範囲 = origin/main...HEAD
//  env(.env): GEMINI_REVIEW_API_KEY(必須), GEMINI_REVIEW_MODEL(任意), NOTION_TOKEN(Notion更新時)
// ============================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv(p) { const o = {}; try { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {} return o }
const env = loadEnv(resolve(ROOT, '.env'))

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const DRY = has('--dry-run'); const JSON_ONLY = has('--json')
const TICKET_ID = val('--ticket-id'); const TICKET_FILE = val('--ticket-file')
const RANGE = argv.find((a) => !a.startsWith('--') && a !== TICKET_ID && a !== TICKET_FILE) || 'origin/main...HEAD'

const API_KEY = process.env.GEMINI_REVIEW_API_KEY || env.GEMINI_REVIEW_API_KEY
const MODEL = process.env.GEMINI_REVIEW_MODEL || env.GEMINI_REVIEW_MODEL || 'gemini-3.5-flash'   // docs現行。env上書き可
if (!API_KEY) { console.error('✗ GEMINI_REVIEW_API_KEY が未設定（root .env）。レビューを中止。'); process.exit(2) }

// ルール読み込み
const RULES_DIR = resolve(ROOT, '.kody/rules')
const rules = existsSync(RULES_DIR)
  ? readdirSync(RULES_DIR).filter((f) => f.endsWith('.md')).map((f) => `# rule: ${f}\n${readFileSync(resolve(RULES_DIR, f), 'utf8')}`).join('\n\n')
  : ''
// diff
let diff = ''
try { diff = execSync(`git diff ${RANGE}`, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }).toString() }
catch (e) { console.error(`✗ git diff ${RANGE} 失敗: ${e.message}`); process.exit(2) }
if (!diff.trim()) { console.error(`（diff が空: ${RANGE}）レビュー対象なし。`); process.exit(0) }
// ticket要件（intent照合②）
let ticket = ''
if (TICKET_FILE && existsSync(TICKET_FILE)) ticket = readFileSync(TICKET_FILE, 'utf8')
else { try { ticket = readFileSync(0, 'utf8') } catch {} }   // stdin
const intentNote = ticket.trim() ? '' : '※ticket要件が未指定のため、意図照合(②)はスキップ。ルール照合(①)のみ実施。'

const SYSTEM = [
  'あなたは独立したコードレビュアー（Claude以外）。下記のレビュールールと（あれば）チケット要件に照らして diff をレビューする。',
  'コードは一切書き換えず、指摘のみを返す。曖昧な憶測指摘より、ルール・要件に明確に反するものを優先。',
  '出力は必ず次の形の JSON のみ（値は実際の内容で埋める）: {"findings":[{"severity":"critical|high|medium|low","file":"path","line":0,"rule":"ルール名","message":"指摘内容"}],"accessRuleEnforced":"外部/anon導線のトークン照合が diff 内でどう担保されているかを1行で（該当なければ その旨）","verdictSuggestion":"block|warn|pass"}',
].join('\n')
const USER = `# レビュールール\n${rules || '(なし)'}\n\n# チケット要件(意図照合用)\n${ticket.trim() || '(未指定)'}\n${intentNote}\n\n# 対象 diff (${RANGE})\n\`\`\`diff\n${diff.slice(0, 600000)}\n\`\`\``

async function callGemini() {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: USER }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json()
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
  try { return JSON.parse(text) } catch { throw new Error(`Gemini 応答が JSON でない: ${text.slice(0, 200)}`) }
}

async function flagNotion(crit, summary) {
  if (!TICKET_ID) { console.log(`  [TODO] critical検知だが --ticket-id 未指定 → 対象チケットに手動で「要人間verdict」を立ててください。`); return }
  const TOKEN = process.env.NOTION_TOKEN || env.NOTION_TOKEN
  if (!TOKEN) { console.log('  [TODO] NOTION_TOKEN 未設定 → Notion更新スキップ'); return }
  const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }
  const body = `🔴 独立レビュー(Gemini ${MODEL}): critical ${crit.length}件 — 要人間verdict\n` + crit.map((f) => `・${f.file}:${f.line} [${f.rule}] ${f.message}`).join('\n')
  const callout = { object: 'block', type: 'callout', callout: { rich_text: [{ type: 'text', text: { content: body.slice(0, 1900) } }], icon: { type: 'emoji', emoji: '🔴' } } }
  const r = await fetch(`https://api.notion.com/v1/blocks/${TICKET_ID}/children`, { method: 'PATCH', headers: H, body: JSON.stringify({ children: [callout] }) })
  console.log(`  Notion要人間verdict: ${r.ok ? 'ok' : 'NG ' + (await r.text()).slice(0, 120)}`)
  try { execSync(`node ${resolve(ROOT, 'scripts/notify-humanball.mjs')} --kind 要人間verdict --task "独立レビュー" --detail ${JSON.stringify(`critical ${crit.length}件(${RANGE})。要人間verdict。`)}`, { stdio: 'ignore' }) } catch {}
}

const result = await callGemini().catch((e) => { console.error('✗ ' + e.message); process.exit(2) })
const findings = Array.isArray(result.findings) ? result.findings : []
const crit = findings.filter((f) => /critical/i.test(f.severity || ''))
const high = findings.filter((f) => /high/i.test(f.severity || ''))

if (JSON_ONLY) { console.log(JSON.stringify(result)); }
else {
  console.log(`\n=== 独立レビュー (Gemini ${MODEL}) ${RANGE} ===`)
  if (intentNote) console.log(intentNote)
  console.log(`findings: 🔴critical ${crit.length} / high ${high.length} / 計 ${findings.length}`)
  for (const f of findings) console.log(`  [${f.severity}] ${f.file}:${f.line} (${f.rule}) ${f.message}`)
  console.log(`accessRuleEnforced: ${result.accessRuleEnforced ?? '-'}`)
  console.log(`verdictSuggestion: ${result.verdictSuggestion ?? '-'}`)
  console.log(`\n📋ダイジェスト用: 独立レビュー=🔴${crit.length}/high${high.length}・verdict=${result.verdictSuggestion ?? '-'}`)
}
if (crit.length) {
  if (DRY) console.log(`\n[dry-run] critical ${crit.length}件 → Notion更新は行わない（標準出力のみ）。`)
  else await flagNotion(crit, result)
}
// verdict=block 相当（critical あり）は非ゼロで返し、/run 側が要人間verdictを拾えるように
process.exit(crit.length ? 1 : 0)
