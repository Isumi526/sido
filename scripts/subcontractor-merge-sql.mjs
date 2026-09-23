#!/usr/bin/env node
// ============================================================
//  scripts/subcontractor-merge-sql.mjs
//  協力業者マスタの「㈱ 表記への統一」と「重複の統合」の SQL を、実データから生成する（生成のみ・適用しない）。
//  Notion: 協力業者マスタの重複（16組32件）を統合する（実測 21組45件・尾崎さん回答 2026-09-05/07: 全社 ㈱ 表記・名鏡は ㈱名鏡）
//
//  ★順序（チケットの ⚠ に従う）:
//   1. 集計側の名寄せ（shared/vendor-name.ts）を本番に出す ← これが出るまで 2・3 を適用しない
//   2. 01-rename.sql … 社名を ㈱／㈲ 表記へ（UPDATE のみ・戻しは 91-reverse-rename.sql）
//   3. 02-merge.sql  … 重複を1社へ寄せる（FK の付け替え＋寄せた側は無効化・戻しは 92-reverse-merge.sql）
//      ★破壊的（請求実績の帰属先が変わる）＝人がバックアップを取って SQL エディタで実行する。CC は実行しない。
//
//  使い方:
//    node scripts/subcontractor-merge-sql.mjs --slug sido [--db "$SUPABASE_PROD_DB_URL"] [--out <dir>] [--exclude "社名A,社名B"]
//    --exclude … そのグループを 02-merge から外す（同一社か確定できない組。改名 01 には残る）
//  既定: --db は .env の SUPABASE_PROD_DB_URL（読み取りだけ）、--out は $TMPDIR/subcontractor-merge-<slug>/
//  ★出力には顧客の取引先名が含まれる。リポジトリ（public）にコミットしないこと。
// ============================================================
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean))
const envText = readFileSync(resolve(ROOT, '.env'), 'utf8')
const envOf = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
const DB = typeof args.db === 'string' ? args.db : envOf('SUPABASE_PROD_DB_URL')
const SLUG = typeof args.slug === 'string' ? args.slug : 'sido'
const OUT = typeof args.out === 'string' ? args.out : resolve(tmpdir(), `subcontractor-merge-${SLUG}`)
// ★統合から外すグループ（同一社と確定できない組・カンマ区切りで「そのグループに含まれる社名のどれか」を指定）
const EXCLUDE = (typeof args.exclude === 'string' ? args.exclude : '').split(',').map(x => x.trim()).filter(Boolean)
if (!DB) { console.error('✗ DB 接続先がありません（--db か .env の SUPABASE_PROD_DB_URL）'); process.exit(1) }

// ── shared/vendor-name.ts と同じ規則（scripts から .ts を import しない前例に合わせて複製・変えたら両方直す）──
function normalizeVendorName(s) {
  return (s ?? '').normalize('NFKC')
    .replace(/[（(](株|有|合|同|名|資)[）)]/g, '')
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|特定非営利活動法人)/g, '')
    .replace(/(御中|様)\s*$/g, '')
    .replace(/[\s　・,，.。\-ー－]/g, '').toLowerCase()
}
function toKabuNotation(name) {
  const s = (name ?? '').trim()
  const kh = /^(株式会社|\(株\)|（株）|㈱)\s*/, kt = /\s*(株式会社|\(株\)|（株）|㈱)$/, yh = /^(有限会社|\(有\)|（有）|㈲)\s*/, yt = /\s*(有限会社|\(有\)|（有）|㈲)$/
  if (kh.test(s)) return '㈱' + s.replace(kh, '').trim()
  if (kt.test(s)) return '㈱' + s.replace(kt, '').trim()
  if (yh.test(s)) return '㈲' + s.replace(yh, '').trim()
  if (yt.test(s)) return '㈲' + s.replace(yt, '').trim()
  return s
}
const q = (sql) => JSON.parse(execFileSync('psql', [DB, '-Atc', `select coalesce(json_agg(t), '[]') from (${sql}) t`], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim() || '[]')
const lit = (v) => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`

// FK（confrelid=subcontractors）は実 DB から拾う＝表が増えても漏れない
const FKS = q(`select c.conrelid::regclass::text as tbl, a.attname as col
  from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
  where c.contype='f' and c.confrelid='public.subcontractors'::regclass order by 1,2`)
const acct = q(`select id from accounts where slug=${lit(SLUG)}`)[0]
if (!acct) { console.error(`✗ account slug=${SLUG} が無い`); process.exit(1) }
const subs = q(`select id, name, category, active, created_at from subcontractors where account_id=${lit(acct.id)} order by created_at`)
const refCount = (id) => FKS.reduce((n, f) => n + Number(q(`select count(*) as c from ${f.tbl} where ${f.col}=${lit(id)}`)[0].c), 0)

// ── グループ化（正規化キーが同じ＝同じ会社）──
const groups = new Map()
for (const s of subs) { const k = normalizeVendorName(s.name); if (!k) continue; (groups.get(k) ?? groups.set(k, []).get(k)).push(s) }
const dupGroups = [...groups.values()].filter(g => g.length > 1)

// 寄せ先＝参照が最も多い行（同数なら古い方）。統一後の社名＝寄せ先の ㈱ 表記（法人格は「株」が1つでもあれば ㈱）
const plans = dupGroups.map(g => {
  const withRefs = g.map(s => ({ ...s, refs: refCount(s.id) }))
  const canon = [...withRefs].sort((a, b) => b.refs - a.refs || a.created_at.localeCompare(b.created_at))[0]
  const anyKabu = g.some(s => /株式会社|\(株\)|（株）|㈱/.test(s.name))
  const core = toKabuNotation(canon.name).replace(/^[㈱㈲]/, '')
  const target = (anyKabu ? '㈱' : (/有限会社|\(有\)|（有）|㈲/.test(g.map(s => s.name).join('')) ? '㈲' : '')) + core
  // 法人格・空白以外が違う（例: ヒート・システム／ヒートシステム）は同一社の確度が下がるので要確認印を付ける
  const coreOf = (n) => n.normalize('NFKC').replace(/[（(](株|有|合|同|名|資)[）)]/g, '').replace(/(株式会社|有限会社|合同会社)/g, '').replace(/[\s　]/g, '')
  const cores = new Set(g.map(s => coreOf(s.name)))
  return { key: normalizeVendorName(canon.name), target, canon, dups: withRefs.filter(s => s.id !== canon.id), review: cores.size > 1 ? [...cores].join(' / ') : null }
})

// ★--exclude で指定された社名を含むグループは統合しない（改名だけ残す）。理由は 00-summary に書く
const excluded = []
const mergePlans = plans.filter(p => {
  const names = [p.canon.name, ...p.dups.map(d => d.name)]
  const hit = EXCLUDE.find(e => names.some(n => n.includes(e) || e.includes(n)))
  if (hit) { excluded.push({ target: p.target, names, by: hit }); return false }
  return true
})

// ── 01 rename（重複グループの寄せ先も含め、全社 ㈱ 表記へ）──
const dupIds = new Set(plans.flatMap(p => p.dups.map(d => d.id)))
const renames = []
for (const s of subs) {
  if (dupIds.has(s.id)) continue          // 寄せる側は 02 で無効化するので改名しない
  const plan = plans.find(p => p.canon.id === s.id)
  const to = plan ? plan.target : toKabuNotation(s.name)
  if (to !== s.name) renames.push({ id: s.id, from: s.name, to })
}
const clash = renames.filter(r => subs.some(s => s.id !== r.id && !dupIds.has(s.id) && s.name === r.to))
mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, '01-rename.sql'), [
  `-- 協力業者の社名を ㈱／㈲ 表記へ統一（account=${SLUG}・${renames.length}件・生成 ${new Date().toISOString()}）`,
  `-- ★集計側の名寄せ（shared/vendor-name.ts）が本番に出てから適用する。戻しは 91-reverse-rename.sql`,
  'begin;',
  ...renames.map(r => `update subcontractors set name=${lit(r.to)}, updated_at=now() where id=${lit(r.id)} and name=${lit(r.from)}; -- ${r.from} → ${r.to}`),
  'commit;', ''].join('\n'))
writeFileSync(resolve(OUT, '91-reverse-rename.sql'), ['begin;', ...renames.map(r => `update subcontractors set name=${lit(r.from)} where id=${lit(r.id)} and name=${lit(r.to)};`), 'commit;', ''].join('\n'))

// ── 02 merge（FK 付け替え＋寄せた側を無効化）。戻し用に「動かす行の id」を今の値で控える ──
const merge = [`-- 協力業者の重複を統合（account=${SLUG}・${mergePlans.length}組・生成 ${new Date().toISOString()}）`,
  `-- ★破壊的（請求実績の帰属先が変わる）。事前バックアップ → SQL エディタで実行 → 検算。戻しは 92-reverse-merge.sql`, 'begin;']
const reverse = ['begin;']
for (const p of mergePlans) {
  merge.push(`\n-- ${p.target} ← ${p.dups.map(d => `${d.name}(参照${d.refs})`).join(', ')}  ／ 寄せ先 ${p.canon.name}(参照${p.canon.refs}) id=${p.canon.id}`)
  for (const d of p.dups) {
    for (const f of FKS) {
      const rows = q(`select id from ${f.tbl} where ${f.col}=${lit(d.id)}`)
      if (!rows.length) continue
      const ids = rows.map(r => lit(r.id)).join(',')
      if (f.tbl === 'site_subcontractors') {
        // 現場×業者は一意。寄せ先が既に紐づく現場の行は付け替えず削除（戻しは再 insert）
        const dupRows = q(`select s.id, s.site_id from site_subcontractors s where s.subcontractor_id=${lit(d.id)} and exists (select 1 from site_subcontractors t where t.site_id=s.site_id and t.subcontractor_id=${lit(p.canon.id)})`)
        for (const r of dupRows) { merge.push(`delete from site_subcontractors where id=${lit(r.id)};`); reverse.unshift(`insert into site_subcontractors (id, account_id, site_id, subcontractor_id) values (${lit(r.id)}, ${lit(acct.id)}, ${lit(r.site_id)}, ${lit(d.id)}) on conflict do nothing;`) }
        const rest = rows.filter(r => !dupRows.some(x => x.id === r.id)).map(r => lit(r.id)).join(',')
        if (rest) { merge.push(`update ${f.tbl} set ${f.col}=${lit(p.canon.id)} where id in (${rest});`); reverse.unshift(`update ${f.tbl} set ${f.col}=${lit(d.id)} where id in (${rest});`) }
        continue
      }
      merge.push(`update ${f.tbl} set ${f.col}=${lit(p.canon.id)} where id in (${ids});`)
      reverse.unshift(`update ${f.tbl} set ${f.col}=${lit(d.id)} where id in (${ids});`)
    }
    merge.push(`update subcontractors set active=false, name=${lit(`${d.name}（統合済→${p.target}）`)}, updated_at=now() where id=${lit(d.id)};`)
    reverse.unshift(`update subcontractors set active=${d.active ? 'true' : 'false'}, name=${lit(d.name)} where id=${lit(d.id)};`)
  }
}
merge.push('commit;', ''); reverse.push('commit;', '')
writeFileSync(resolve(OUT, '02-merge.sql'), merge.join('\n'))
writeFileSync(resolve(OUT, '92-reverse-merge.sql'), reverse.join('\n'))

// ── 検算用 ──
writeFileSync(resolve(OUT, '03-verify.sql'), [
  `-- 適用後の検算: 重複キーが残っていない／参照が寄せ先に集まっている`,
  `select count(*) as active_total from subcontractors where account_id=${lit(acct.id)} and active;`,
  ...mergePlans.map(p => `select ${lit(p.target)} as target, (select count(*) from subcontractor_invoices where subcontractor_id=${lit(p.canon.id)}) as invoices, (select active from subcontractors where id=${lit(p.canon.id)}) as active;`), ''].join('\n'))

// ── 要約（人が読む）──
const summary = [
  `# 協力業者 統合プラン（account=${SLUG}・${new Date().toISOString().slice(0, 10)}）`,
  `- 全社数 ${subs.length}（active ${subs.filter(s => s.active).length}）／ ㈱㈲ への改名 ${renames.length}件 ／ 重複グループ ${plans.length}組（うち統合する ${mergePlans.length}組・外した ${excluded.length}組）`,
  clash.length ? `- ⚠ 改名先が既存の別社名と衝突: ${clash.map(c => `${c.from}→${c.to}`).join(', ')}（要確認）` : '- 改名の衝突なし',
  '', '## 重複グループ（寄せ先 ← 寄せる側・参照数）',
  ...mergePlans.map(p => `- **${p.target}** ← 寄せ先 ${p.canon.name}(${p.canon.refs}) / ${p.dups.map(d => `${d.name}(${d.refs})`).join(' / ')}${p.review ? `  ⚠要確認（表記が法人格以外でも違う: ${p.review}）` : ''}`),
  ...(excluded.length ? ['', '## 統合から外した組（同一社と確定できないもの・改名だけ行う）',
    ...excluded.map(e => `- ${e.names.join(' / ')}  ← --exclude "${e.by}" で除外`)] : []),
  '', '## 参照する表（FK）', ...FKS.map(f => `- ${f.tbl}.${f.col}`), '',
  `出力: ${OUT}`, '']
writeFileSync(resolve(OUT, '00-summary.md'), summary.join('\n'))
console.log(summary.join('\n'))
