#!/usr/bin/env node
// ============================================================
//  migrate-work-categories-2026-08-17.mjs
//  「現場もどき」を 台帳(現場) × 作業区分 の形へ寄せる（本番データ移行）
//
//  ★なぜ必要か
//   これまで「作業の種類」を入れる場所が無かったので、現場マスタに
//   「事務、その他、名古屋」「見積」「工場作業、その他」「移動」といった
//   “現場ではないもの” を現場として登録して回していた。その結果、
//    - 同じ事務が「事務、その他」「事務、その他 名古屋」「事務所」と3つに割れて集計が合わない
//    - 現場ごとの原価に「見積」「移動」が現場として混ざる
//   という状態だった。作業区分が入ったので、本来の形（台帳×区分）へ寄せる。
//
//  ★やること
//   1. 台帳の名前を実態に合わせる（事務、その他、名古屋 → 事務所（名古屋） 等）
//   2. 重複していた台帳を1つに寄せ、余りは非表示にする
//   3. 過去の日報の各行に site_id と workCategoryId を刻む
//      ※ siteName（当時そう選んだという記録）は書き換えない。集計は site_id を見る
//   4. 事務所の定時を (台帳×区分) の組へ移す（名古屋 08:00-18:30 / 東京 08:30-18:30）
//
//  ★元に戻せるようにしてある
//   適用前に、触る日報行と現場マスタを .backfill-work-category-20260817.snapshot.jsonl に
//   まるごと保存し、それを流し込むだけで戻せる rollback SQL も同時に書き出す。
//
//  ★触らないもの
//   有給・半有給。これは「作業の種類」ではなく勤怠の区分で、軸が違う（daily_reports.leave_type 側）。
//
//  使い方:
//    node --env-file=.env scripts/migrate-work-categories-2026-08-17.mjs --dry     # 何が変わるかだけ出す
//    node --env-file=.env scripts/migrate-work-categories-2026-08-17.mjs --apply   # 適用（先にスナップショット）
// ============================================================
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const DB = process.env.SUPABASE_PROD_DB_URL
if (!DB) { console.error('SUPABASE_PROD_DB_URL が無い（--env-file=.env を付ける）'); process.exit(1) }
const APPLY = process.argv.includes('--apply')

const SNAPSHOT = '.backfill-work-category-20260817.snapshot.jsonl'
const ROLLBACK = '.backfill-work-category-20260817.rollback.sql'

function psql(sql, { json = false } = {}) {
  const args = ['-qAt', '-v', 'ON_ERROR_STOP=1', DB, '-c', sql]
  const out = execFileSync('psql', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
  return json ? (out.trim() ? JSON.parse(out) : null) : out
}

// ── 移行表 ────────────────────────────────────────────────
// 「今この site_id（または名前）で入っている日報行」を「どの台帳 × どの区分」に読み替えるか。
const SIDO = {
  slug: 'sido',
  // 台帳の名前を実態に合わせる（id を変えないので過去の日報がそのまま繋がる）
  renames: [
    ['9c31ba3d-548b-475a-a355-e177dce7f816', '事務所（名古屋）'],
    ['be0e6186-7bf0-462a-b5c6-629cdedaeba1', '事務所（東京）'],
    ['d7f3e6bd-5ab6-4475-a261-7cc8e4f07831', '工場（旧・統合済み）'], // 先に退かす。下の 4a90 を「工場」にするため
    ['4a9002e1-b359-4552-a4c7-2825644c2867', '工場'],
    ['4c668fe0-ebb6-45e3-b84e-191c8eecd417', '社内行事'],
  ],
  // 役目を終えた台帳（行は上の台帳へ寄せる）。一覧から消すだけで、行は消さない
  deactivate: [
    '80360223-bfa6-4efb-9cfe-cfb84d5c0725', // 事務所 → 事務所（名古屋）へ
    'c2872dc3-fb63-4273-aa72-178f046d600b', // 見積 → 事務所（名古屋）× 見積
    'c1df17b5-caa3-4c58-92f7-d8313b1c62ba', // 移動 → 事務所（名古屋）× 移動
    'd7f3e6bd-5ab6-4475-a261-7cc8e4f07831', // 工場（旧） → 工場へ
    'f60f7794-7903-4f99-b382-ac5a00f42272', // バウハウス 管理者講習 → 社内行事 × 講習
  ],
  // 日報行の読み替え: [今の site_id, 新しい台帳 site_id, 区分名]
  bySiteId: [
    ['9c31ba3d-548b-475a-a355-e177dce7f816', '9c31ba3d-548b-475a-a355-e177dce7f816', 'その他事務'],
    ['be0e6186-7bf0-462a-b5c6-629cdedaeba1', 'be0e6186-7bf0-462a-b5c6-629cdedaeba1', 'その他事務'],
    ['80360223-bfa6-4efb-9cfe-cfb84d5c0725', '9c31ba3d-548b-475a-a355-e177dce7f816', 'その他事務'],
    ['c2872dc3-fb63-4273-aa72-178f046d600b', '9c31ba3d-548b-475a-a355-e177dce7f816', '見積'],
    ['c1df17b5-caa3-4c58-92f7-d8313b1c62ba', '9c31ba3d-548b-475a-a355-e177dce7f816', '移動'],
    ['4a9002e1-b359-4552-a4c7-2825644c2867', '4a9002e1-b359-4552-a4c7-2825644c2867', '現場作業'],
    ['d7f3e6bd-5ab6-4475-a261-7cc8e4f07831', '4a9002e1-b359-4552-a4c7-2825644c2867', '現場作業'],
    ['4c668fe0-ebb6-45e3-b84e-191c8eecd417', '4c668fe0-ebb6-45e3-b84e-191c8eecd417', '講習'],
    ['f60f7794-7903-4f99-b382-ac5a00f42272', '4c668fe0-ebb6-45e3-b84e-191c8eecd417', '講習'],
  ],
  // site_id が刻まれていない古い行は名前で拾う。
  // 「事務、その他」は 2026-05〜06 の旧名。使った人を数えると大須賀48/今井29/鵜飼6…と
  // その後「名古屋」しか使っていない人が大半なので名古屋に寄せる（外れても戻せる）。
  byName: [
    ['事務、その他', '9c31ba3d-548b-475a-a355-e177dce7f816', 'その他事務'],
  ],
  // (台帳 × 区分) の定時。今まで現場マスタに置いていたものをここへ移す
  hours: [
    ['9c31ba3d-548b-475a-a355-e177dce7f816', 'その他事務', '08:00', '18:30'],
    ['be0e6186-7bf0-462a-b5c6-629cdedaeba1', 'その他事務', '08:30', '18:30'],
  ],
}

const HIRO = {
  slug: 'hiromokkou',
  renames: [
    ['a46b7a0c-ed1e-4948-924d-c0441d6e9179', '事務所'],   // データ入力／検品／撮影（15行と一番多い）を事務所の台帳にする
    ['413d2895-827f-4171-9785-43394f3c581e', '社内行事'], // 研修／勉強会
    ['387a7249-49aa-4a50-a310-730901539eda', '萬扇'],     // 萬扇 現場見積もり → 台帳は現場、区分が見積
  ],
  deactivate: [
    '1c6690a8-2cb9-4f87-82a8-77f5f859e3d1', // カメラ仕入れ → 事務所 × その他事務
    'b227a104-dcc4-4eeb-9e7a-545e3ddcf9f6', // 請求書発行 → 事務所 × その他事務
    '4207e75c-f8d5-4e2b-8b32-4babfe1510b9', // 商売繁盛祈願 → 社内行事
    '6c8889ee-9d9b-4095-957e-6a07c09fc9ac', // 業績評価 → 社内行事
  ],
  bySiteId: [
    ['a46b7a0c-ed1e-4948-924d-c0441d6e9179', 'a46b7a0c-ed1e-4948-924d-c0441d6e9179', 'その他事務'],
    ['1c6690a8-2cb9-4f87-82a8-77f5f859e3d1', 'a46b7a0c-ed1e-4948-924d-c0441d6e9179', 'その他事務'],
    ['b227a104-dcc4-4eeb-9e7a-545e3ddcf9f6', 'a46b7a0c-ed1e-4948-924d-c0441d6e9179', 'その他事務'],
    ['413d2895-827f-4171-9785-43394f3c581e', '413d2895-827f-4171-9785-43394f3c581e', '講習'],
    ['4207e75c-f8d5-4e2b-8b32-4babfe1510b9', '413d2895-827f-4171-9785-43394f3c581e', 'その他事務'],
    ['6c8889ee-9d9b-4095-957e-6a07c09fc9ac', '413d2895-827f-4171-9785-43394f3c581e', 'その他事務'],
    ['387a7249-49aa-4a50-a310-730901539eda', '387a7249-49aa-4a50-a310-730901539eda', '見積'],
  ],
  byName: [],
  hours: [],
}

const PLANS = [SIDO, HIRO]
const NEW_CATEGORIES = [
  // 標準3種（現場作業/見積/その他事務）に足りないもの。全アカウントに入れる
  { name: '講習', scope: null, sort_order: 40, note: '安全衛生講習・管理者講習・社内勉強会など' },
  { name: '移動', scope: null, sort_order: 50, note: '現場間の移動など、どの現場の作業でもない移動時間' },
]

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

// ── 1. 影響範囲を数える ───────────────────────────────────
function countAffected(plan) {
  const ids = plan.bySiteId.map(([from]) => q(from)).join(',')
  const names = plan.byName.map(([n]) => q(n)).join(',')
  const cond = [
    ids ? `(e->>'site_id') in (${ids})` : null,
    names ? `((e->>'site_id') is null and (e->>'siteName') in (${names}))` : null,
  ].filter(Boolean).join(' or ')
  const rows = psql(`
    select coalesce(json_agg(json_build_object('nm', nm, 'c', c))::text,'[]') from (
      select coalesce(nullif(e->>'siteName',''),'(空)') nm, count(*) c
      from daily_reports dr join accounts a on a.id=dr.account_id,
      lateral jsonb_array_elements(case when jsonb_typeof(dr.sites)='array' then dr.sites else '[]'::jsonb end) e
      where a.slug=${q(plan.slug)} and (${cond})
      group by 1 order by 2 desc) t;`, { json: true })
  return { cond, rows }
}

// ── 2. スナップショット（戻すため）─────────────────────────
function snapshot(plansWithCond) {
  const parts = plansWithCond.map(({ plan, cond }) => `
    select json_build_object('kind','report','slug',${q(plan.slug)},'id',dr.id,'sites',dr.sites)::text
    from daily_reports dr join accounts a on a.id=dr.account_id
    where a.slug=${q(plan.slug)} and exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(dr.sites)='array' then dr.sites else '[]'::jsonb end) e
      where ${cond})`)
  const siteIds = plansWithCond.flatMap(({ plan }) =>
    [...new Set([...plan.renames.map(r => r[0]), ...plan.deactivate, ...plan.bySiteId.flat().filter(v => /^[0-9a-f-]{36}$/.test(v))])])
  parts.push(`select json_build_object('kind','site','id',s.id,'name',s.name,'active',s.active,
      'default_start_time',s.default_start_time,'default_end_time',s.default_end_time,
      'default_break_minutes',s.default_break_minutes)::text
    from sites s where s.id in (${siteIds.map(q).join(',')})`)
  const out = psql(parts.join('\nunion all\n') + ';')
  writeFileSync(SNAPSHOT, out)
  const lines = out.trim().split('\n').filter(Boolean)
  console.log(`スナップショット: ${SNAPSHOT}（${lines.length} 行）`)
  return lines.map(l => JSON.parse(l))
}

function writeRollback(snap) {
  const sql = ['-- 2026-08-17 作業区分への移行を元に戻す。psql "$SUPABASE_PROD_DB_URL" -f このファイル',
    'begin;']
  for (const r of snap) {
    if (r.kind === 'report') {
      sql.push(`update public.daily_reports set sites = ${q(JSON.stringify(r.sites))}::jsonb where id = ${q(r.id)};`)
    } else {
      sql.push(`update public.sites set name = ${q(r.name)}, active = ${r.active}, ` +
        `default_start_time = ${r.default_start_time ? q(r.default_start_time) : 'null'}, ` +
        `default_end_time = ${r.default_end_time ? q(r.default_end_time) : 'null'} where id = ${q(r.id)};`)
    }
  }
  // この移行で入れた (台帳×区分) の定時だけを消す（人が今日作った分を巻き込まない）
  for (const plan of PLANS) {
    for (const [siteId, cat] of plan.hours) {
      sql.push(`delete from public.site_category_hours where site_id = ${q(siteId)}`
        + ` and category_id in (select id from public.work_categories where name = ${q(cat)});`)
    }
  }
  sql.push(`delete from public.work_categories where name in ('講習','移動');`)
  sql.push('commit;')
  writeFileSync(ROLLBACK, sql.join('\n') + '\n')
  console.log(`巻き戻しSQL: ${ROLLBACK}（${sql.length - 3} 文）`)
}

// ── 3. 適用 ──────────────────────────────────────────────
function buildApplySql(plansWithCond) {
  const s = ['begin;']

  // 足りない区分を全アカウントへ（新規アカウントは trigger 側で入る）
  for (const c of NEW_CATEGORIES) {
    s.push(`insert into public.work_categories (account_id, name, scope, sort_order, active)
      select a.id, ${q(c.name)}, ${c.scope ? q(c.scope) : 'null'}, ${c.sort_order}, true from public.accounts a
      where not exists (select 1 from public.work_categories w where w.account_id=a.id and w.name=${q(c.name)});`)
  }

  for (const { plan, cond } of plansWithCond) {
    const acct = `(select id from public.accounts where slug=${q(plan.slug)})`
    for (const [id, name] of plan.renames) s.push(`update public.sites set name=${q(name)} where id=${q(id)};`)
    if (plan.deactivate.length) {
      s.push(`update public.sites set active=false where id in (${plan.deactivate.map(q).join(',')});`)
    }

    // 日報行の読み替え。1本の update で、行ごとに case で振り分ける
    const cases = []
    for (const [from, to, cat] of plan.bySiteId) {
      cases.push(`when (e->>'site_id') = ${q(from)} then e || jsonb_build_object('site_id', ${q(to)},
        'workCategoryId', (select w.id::text from public.work_categories w where w.account_id=${acct} and w.name=${q(cat)}))`)
    }
    for (const [nm, to, cat] of plan.byName) {
      cases.push(`when (e->>'site_id') is null and (e->>'siteName') = ${q(nm)} then e || jsonb_build_object('site_id', ${q(to)},
        'workCategoryId', (select w.id::text from public.work_categories w where w.account_id=${acct} and w.name=${q(cat)}))`)
    }
    s.push(`update public.daily_reports dr set sites = (
        select jsonb_agg(case ${cases.join(' ')} else e end order by ord)
        from jsonb_array_elements(dr.sites) with ordinality t(e, ord))
      where dr.account_id = ${acct}
        and jsonb_typeof(dr.sites) = 'array'
        and exists (select 1 from jsonb_array_elements(dr.sites) e where ${cond});`)

    // (台帳 × 区分) の定時
    for (const [siteId, cat, st, et] of plan.hours) {
      s.push(`insert into public.site_category_hours (account_id, site_id, category_id, default_start_time, default_end_time)
        select ${acct}, ${q(siteId)}, w.id, ${q(st)}, ${q(et)} from public.work_categories w
        where w.account_id=${acct} and w.name=${q(cat)}
        on conflict (site_id, category_id) do update
          set default_start_time=excluded.default_start_time, default_end_time=excluded.default_end_time;`)
    }
  }
  s.push('commit;')
  return s.join('\n')
}

// ── main ────────────────────────────────────────────────
const plansWithCond = PLANS.map(plan => {
  const { cond, rows } = countAffected(plan)
  console.log(`\n[${plan.slug}] 読み替える日報行 ${rows.reduce((a, r) => a + Number(r.c), 0)} 行`)
  for (const r of rows) console.log(`   ${String(r.c).padStart(4)}  ${r.nm}`)
  return { plan, cond }
})

if (!APPLY) {
  console.log('\n--dry のため適用しない。--apply で実行する')
  process.exit(0)
}

const snap = snapshot(plansWithCond)
writeRollback(snap)
const sql = buildApplySql(plansWithCond)
writeFileSync('.backfill-work-category-20260817.apply.sql', sql + '\n')
psql(sql)
console.log('\n適用した。')
