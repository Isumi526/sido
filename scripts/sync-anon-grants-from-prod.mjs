// ============================================================
//  scripts/sync-anon-grants-from-prod.mjs
//  ローカルDBの anon 権限を「本番と同じ」に揃える。
//
//  ★なぜ要るか:
//   ローカルは db reset やアドホックな検証で anon 権限が本番より緩くなりがちで、
//   その状態だと anon 締め出しのE2E（＝セキュリティの回帰テスト）が落ちる。
//   落ちた時に「自分の変更が壊した」と誤診して、正しい実装を疑って壊す方向に直す
//   事故が実際に起きた（2026-08-27 / 08-30 に複数回）。
//   本番を正として機械的に合わせるのが唯一の確実な直し方。
//
//  ★安全性: 触るのは **ローカルDBの anon 権限だけ**。本番へは一切書き込まない
//   （本番は information_schema を読むだけ）。LOCAL_DB_URL がローカルを
//   指していない場合は実行を止める。
//
//  使い方:
//    node --env-file=.env scripts/sync-anon-grants-from-prod.mjs         # 差分を表示するだけ
//    node --env-file=.env scripts/sync-anon-grants-from-prod.mjs --apply # 実際に揃える
// ============================================================
import { spawnSync } from 'node:child_process'

const LOCAL = process.env.LOCAL_DB_URL
const PROD = process.env.SUPABASE_PROD_DB_URL
if (!LOCAL || !PROD) { console.error('LOCAL_DB_URL と SUPABASE_PROD_DB_URL が要ります（.env）'); process.exit(1) }
if (!/(127\.0\.0\.1|localhost)/.test(LOCAL)) { console.error('★LOCAL_DB_URL がローカルを指していません。中止します。'); process.exit(1) }
const APPLY = process.argv.includes('--apply')

function q(url, sql) {
  const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|', '-c', sql], { encoding: 'utf8' })
  if (r.status !== 0) { console.error(r.stderr?.trim()); process.exit(1) }
  return r.stdout.split('\n').map(l => l.trim()).filter(Boolean)
}
function exec(url, sql) {
  const r = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  if (r.status !== 0) { console.error('失敗:', sql.slice(0, 120)); console.error(r.stderr?.trim()); process.exit(1) }
}

// 列単位の付与（テーブル単位の付与も column_privileges に展開されて出る）
const SQL = `
select table_name, privilege_type, column_name
from information_schema.column_privileges
where table_schema='public' and grantee='anon' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
order by 1,2,3`
const parse = (rows) => {
  const m = new Map()   // "table|priv" -> Set(columns)
  for (const line of rows) {
    const [t, p, c] = line.split('|')
    const k = `${t}|${p}`
    if (!m.has(k)) m.set(k, new Set())
    m.get(k).add(c)
  }
  return m
}
const local = parse(q(LOCAL, SQL))
const prod = parse(q(PROD, SQL))

const tables = new Set([...local.keys(), ...prod.keys()].map(k => k.split('|')[0]))
const diffs = []
for (const t of [...tables].sort()) {
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const k = `${t}|${p}`
    const l = local.get(k) ?? new Set()
    const r = prod.get(k) ?? new Set()
    const extra = [...l].filter(c => !r.has(c))       // ローカルにだけある＝緩い
    const missing = [...r].filter(c => !l.has(c))     // 本番にだけある＝厳しすぎ
    if (extra.length || missing.length) diffs.push({ t, p, extra, missing, prodCols: [...r] })
  }
}

if (!diffs.length) { console.log('✓ ローカルの anon 権限は本番と一致しています'); process.exit(0) }

console.log(`本番と違う組み合わせ: ${diffs.length}件`)
for (const d of diffs) {
  const tag = d.extra.length ? '🔴緩い' : '🟡厳しい'
  console.log(`  ${tag} ${d.t} ${d.p}  +local:${d.extra.length} -local:${d.missing.length}`)
}

if (!APPLY) { console.log('\n（表示のみ。実際に揃えるには --apply）'); process.exit(0) }

// ★本番を正として、対象テーブルの anon 権限を作り直す
const touched = [...new Set(diffs.map(d => d.t))]
for (const t of touched) {
  exec(LOCAL, `revoke all on public."${t}" from anon;`)
  // 列単位の付与はテーブル単位の revoke では消えないので、列も1つずつ剥がす
  exec(LOCAL, `do $$
declare c record;
begin
  for c in select a.attname from pg_attribute a
           join pg_class k on k.oid=a.attrelid join pg_namespace n on n.oid=k.relnamespace
           where n.nspname='public' and k.relname='${t}' and a.attnum>0 and not a.attisdropped
  loop execute format('revoke all (%I) on public."${t}" from anon', c.attname); end loop;
end $$;`)
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const cols = prod.get(`${t}|${p}`)
    if (!cols || !cols.size) continue
    const list = [...cols].map(c => `"${c}"`).join(',')
    exec(LOCAL, `grant ${p} (${list}) on public."${t}" to anon;`)
  }
  console.log(`  ✓ ${t}`)
}
console.log(`\n✓ ${touched.length}テーブルを本番と同じ anon 権限に揃えました`)
