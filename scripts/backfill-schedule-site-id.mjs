#!/usr/bin/env node
// ============================================================
//  backfill-schedule-site-id.mjs
//  schedules.site_id を後付けする（title に残っている現場名から解決する）。
//
//  ★なぜ必要か（2026-08-15 発見）:
//   予定作成フォームの現場 <select> が v-model=title（現場「名」の文字列）で、
//   site_id を入れる箇所がどこにも無かった。ユーザーは現場を選んでいるのに
//   システムには名前しか残らず、本番の schedules 全件で site_id が NULL だった。
//   フォーム側は同日に修正済み。これは既に溜まった分の救済。
//
//  ★埋めるのは「正規化名が一致したものだけ」。
//   一致しないものは NULL のまま残す。実データを見ると未一致の大半は
//   「丹青社安全大会」「会社会議」「有給(私用)」「足場講習」等の**非現場の予定**で、
//   NULL が正しい。現場かどうかは業務知識なので機械が推測してはいけない。
//   未一致は一覧で出すので、人が現場マスタと突き合わせる。
//
//  使い方:
//    node scripts/backfill-schedule-site-id.mjs                  # local・dry-run（既定・安全）
//    node scripts/backfill-schedule-site-id.mjs --apply          # local に適用
//    node scripts/backfill-schedule-site-id.mjs --db prod        # 本番・dry-run（読取のみ）
//    node scripts/backfill-schedule-site-id.mjs --db prod --apply # 本番に適用（人の承認後）
//
//  接続: local=.env の LOCAL_DB_URL / prod=.env の SUPABASE_PROD_DB_URL（値はログに出さない）。
//  追加のみ・非破壊（site_id が NULL の行にだけ書く。title は変更しない）。
// ============================================================
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const DB = args.includes('--db') ? args[args.indexOf('--db') + 1] : 'local'

function loadEnv() {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const out = {}
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
    return out
  } catch { return {} }
}
const env = loadEnv()
const DB_URL = DB === 'prod'
  ? (env.SUPABASE_PROD_DB_URL || '')
  : (env.LOCAL_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
if (DB === 'prod' && !DB_URL) { console.error('SUPABASE_PROD_DB_URL が .env にありません'); process.exit(1) }

// ---- 現場名の正規化（正典: shared/site-similarity.ts と同一ロジック）----
//  ★.mjs から .ts を import できないため写している。shared 側を変えたらここも直す。
//  ここを独自実装にすると日報側の解決結果とズレる。必ず同じ規則を使う。
function normalizeSiteName(s) {
  return (s || '')
    .normalize('NFKC')
    .replace(/[\s　・,，、。.\-_/／()（）「」『』【】]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()
}

function psqlJsonLines(sql) {
  const r = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status !== 0) { console.error('psql エラー:', r.stderr); process.exit(1) }
  return r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

console.log(`[backfill-schedule-site-id] db=${DB} mode=${APPLY ? 'APPLY' : 'dry-run'}`)

// 1) 現場マスタ（アカウント別）。★無効な現場も対象に含める——
//    過去の予定は「当時は有効だった現場」を指しているので、active だけに絞ると解決できない。
const sites = psqlJsonLines(`
  select json_build_object('id', id, 'account_id', account_id, 'name', name, 'active', active)
  from sites order by account_id, name;
`)
const byAccount = new Map()
for (const s of sites) {
  if (!byAccount.has(s.account_id)) byAccount.set(s.account_id, [])
  byAccount.get(s.account_id).push(s)
}

// 2) site_id が未設定の予定（削除済みは除く）
const rows = psqlJsonLines(`
  select json_build_object('id', id, 'account_id', account_id, 'title', title)
  from schedules where site_id is null and deleted_at is null order by created_at;
`)

const resolved = []
const unresolved = []
const ambiguous = []
for (const r of rows) {
  const list = byAccount.get(r.account_id) ?? []
  const name = (r.title ?? '').trim()
  if (!name) { unresolved.push({ ...r, why: 'タイトルが空' }); continue }
  const exact = list.filter((s) => s.name === name)
  if (exact.length === 1) { resolved.push({ ...r, site_id: exact[0].id, how: '完全一致' }); continue }
  if (exact.length > 1) { ambiguous.push({ ...r, why: `同名の現場が${exact.length}件` }); continue }
  const nn = normalizeSiteName(name)
  if (!nn) { unresolved.push({ ...r, why: '正規化すると空' }); continue }
  const norm = list.filter((s) => normalizeSiteName(s.name) === nn)
  // ★複数に当たったら埋めない。どれか選ぶのは推測になる
  if (norm.length === 1) { resolved.push({ ...r, site_id: norm[0].id, how: '正規化一致' }) }
  else if (norm.length > 1) { ambiguous.push({ ...r, why: `正規化して${norm.length}件に当たる` }) }
  else { unresolved.push({ ...r, why: '現場マスタに無い' }) }
}

console.log(`\n対象(site_id未設定): ${rows.length}件`)
console.log(`  解決できる:   ${resolved.length}`)
console.log(`  曖昧(埋めない): ${ambiguous.length}`)
console.log(`  未一致(埋めない): ${unresolved.length}`)

// 未一致は「非現場の予定」が大半のはず。人が仕分けられるよう件数順で出す
const counts = new Map()
for (const u of unresolved) counts.set(u.title, (counts.get(u.title) ?? 0) + 1)
if (counts.size) {
  console.log('\n── 未一致のタイトル（件数順）──')
  console.log('   ※ 会議・講習・有給などの非現場の予定は NULL のままが正しい。')
  console.log('     現場らしいのに一致しないものだけ、現場マスタと突き合わせて手で直す。')
  for (const [title, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}件  ${title}`)
  }
}
if (ambiguous.length) {
  console.log('\n── 曖昧（同名/正規化衝突・埋めない）──')
  for (const a of ambiguous) console.log(`   ${a.title} … ${a.why}`)
}

if (!resolved.length) { console.log('\n埋める対象がありません。'); process.exit(0) }

// 3) SQL を書き出す（人が読んでから適用できるように必ずファイルへ残す）
const sql = [
  '-- backfill: schedules.site_id（title の現場名から解決）',
  '-- 追加のみ・非破壊（site_id が NULL の行にだけ書く。title は変更しない）',
  'begin;',
  ...resolved.map((r) => `update schedules set site_id = '${r.site_id}' where id = '${r.id}' and site_id is null;`),
  'commit;',
  '',
].join('\n')
const out = `.backfill-schedule-site-id.${DB}.generated.sql`
writeFileSync(out, sql)
console.log(`\nSQL を書き出しました: ${out}（${resolved.length}件）`)

if (!APPLY) {
  console.log('dry-run です。適用するには --apply を付けてください。')
  process.exit(0)
}

const r = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', out], { encoding: 'utf8' })
if (r.status !== 0) { console.error('適用に失敗:', r.stderr); process.exit(1) }
console.log('適用しました。')

// 4) 適用後の検算（埋めたつもりで埋まっていない、を防ぐ）
const after = psqlJsonLines(`
  select json_build_object('n', count(*)) from schedules where site_id is null and deleted_at is null;
`)
console.log(`検算: site_id 未設定は ${after[0].n}件（想定 ${ambiguous.length + unresolved.length}件）`)
