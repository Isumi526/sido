#!/usr/bin/env node
// ============================================================
//  scripts/anon-grant-check.mjs
//  ローカルDBの anon 付与が supabase/seed.sql の宣言と一致しているかを見る。
//
//  ★なぜ要るか（2026-09-08〜09 の1日で4回踏んだ）
//   seed.sql が anon に全表 DML を付けており、db reset は migration の後に
//   seed を流すため、anon ロックダウンの migration が毎回上書きされて無効化されていた。
//   結果ローカルだけ anon が開きっぱなしになり、
//   「anonキーでは読めない/書けない」系のE2Eがローカルでだけ落ちる。
//   落ち方が 200＋空配列 / 期待>=400・実際200 なので、
//   **自分の変更が壊したように見える**のが最悪の点だった。
//   （2026-08-27 にも2回、同じ誤診の記録がある）
//
//   seed.sql は 2026-09-09 に本番の付与をそのまま写した形へ直した。
//   このスクリプトは「その宣言どおりになっているか」を機械的に言う。
//   ★本番へは接続しない（オフラインで完結する）。本番との一致は seed.sql が担保する。
//
//  使い方:
//    node scripts/anon-grant-check.mjs            # 差分を出す（差分ありなら exit 1）
//    node scripts/anon-grant-check.mjs --repair   # 一致させるSQLを出力（適用はしない）
// ============================================================
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DB_URL = process.env.LOCAL_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:56322/postgres'
const SEED = 'supabase/seed.sql'
const REPAIR = process.argv.includes('--repair')

/** seed.sql が宣言している anon 付与を {table, priv, cols|null} に正規化する。 */
function declaredFromSeed() {
  const sql = readFileSync(SEED, 'utf8')
  const out = new Map()
  //  grant select on public.foo to anon;
  //  grant insert (a, b) on public.foo to anon;
  const re = /^grant\s+(select|insert|update|delete)\s*(?:\(([^)]*)\))?\s+on\s+public\.("?[A-Za-z0-9_]+"?)\s+to\s+anon;\s*$/gim
  let m
  while ((m = re.exec(sql))) {
    const priv = m[1].toUpperCase()
    const cols = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean).sort() : null
    const table = m[3].replace(/"/g, '')
    out.set(`${table}:${priv}`, cols)
  }
  return out
}

/** 実DBの anon 付与。列単位付与は列名まで見る（テーブル単位は全列に付いている状態）。 */
function actualFromDb() {
  const q = `
    with cols as (
      select table_name, count(*)::int as total from information_schema.columns
      where table_schema='public' group by table_name
    ), g as (
      select table_name, privilege_type, count(*)::int as granted,
             string_agg(column_name, ',' order by column_name) as cols
      from information_schema.role_column_grants
      where grantee='anon' and table_schema='public'
        and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
      group by table_name, privilege_type
    )
    select g.table_name || '\t' || g.privilege_type || '\t' ||
           case when g.granted = c.total then '*' else g.cols end
    from g join cols c on c.table_name = g.table_name
    union all
    -- ★DELETE は列単位の権限ではないので role_column_grants に出ない。
    --  ここを忘れると DELETE のドリフトを一切検出できないし、
    --  seed の生成側でも DELETE が丸ごと落ちる（2026-09-09 に実際に踏んだ。
    --  admin.expense-rescue が「anonで expense_settlements を消せない」で落ちて気づいた）。
    select table_name || '\t' || 'DELETE' || '\t' || '*'
    from information_schema.role_table_grants
    where grantee='anon' and table_schema='public' and privilege_type='DELETE'
    order by 1;`
  const raw = execFileSync('psql', [DB_URL, '-t', '-A', '-c', q], { encoding: 'utf8' })
  const out = new Map()
  for (const line of raw.split('\n')) {
    const [table, priv, cols] = line.split('\t')
    if (!table || !priv) continue
    out.set(`${table}:${priv}`, cols === '*' ? null : cols.split(',').map(s => s.trim()).sort())
  }
  return out
}

const same = (a, b) => (a === null && b === null) || (a && b && a.join(',') === b.join(','))

const declared = declaredFromSeed()
const actual = actualFromDb()

const extra = []    // DBにあるが seed に無い（＝開きすぎ）
const missing = []  // seed にあるが DBに無い（＝閉じすぎ）
const differ = []   // 列の内容が違う

for (const [k, v] of actual) {
  if (!declared.has(k)) extra.push(k)
  else if (!same(declared.get(k), v)) differ.push(k)
}
for (const k of declared.keys()) if (!actual.has(k)) missing.push(k)

if (REPAIR) {
  console.log('-- ローカルを seed.sql の宣言に合わせる（本番と同じ状態にする）')
  console.log('revoke select, insert, update, delete on all tables in schema public from anon;')
  console.log(readFileSync(SEED, 'utf8').split('\n').filter(l => /^grant .* to anon;$/.test(l)).join('\n'))
  process.exit(0)
}

const total = extra.length + missing.length + differ.length
if (total === 0) {
  console.log('✓ anon 付与はローカルと seed.sql の宣言で一致（本番と同じ状態）')
  process.exit(0)
}

console.error('⚠ anon 付与がドリフトしています（ローカルDBが seed.sql の宣言と違う）')
console.error('')
console.error('  ★これは「あなたの変更が壊した」のではない可能性が高いです。')
console.error('   anon 締め出し系のE2Eが 200＋空配列 / 期待>=400・実際200 で落ちる時は、')
console.error('   まずここを疑ってください（2026-08〜09 に計6回、同じ誤診をしています）。')
console.error('')
if (extra.length)   console.error(`  開きすぎ (${extra.length}件): ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ' …' : ''}`)
if (missing.length) console.error(`  閉じすぎ (${missing.length}件): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`)
if (differ.length)  console.error(`  列が違う (${differ.length}件): ${differ.slice(0, 8).join(', ')}${differ.length > 8 ? ' …' : ''}`)
console.error('')
console.error('  直し方:  node scripts/anon-grant-check.mjs --repair | psql "$LOCAL_DB_URL"')
process.exit(1)
