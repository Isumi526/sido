#!/usr/bin/env node
// ============================================================
//  scripts/prod-health/self-test.mjs
//  ★検知器がちゃんと鳴るかを確かめる。
//
//  なぜ要るか: きれいなDBに対して「違反0件」と出ても、それは検知能力の証明にならない。
//   壊れていても鳴らない監査は、無いより悪い（「見ているつもり」になるから）。
//   なので わざと違反を作って→鳴ることを確認し→片付けて→鳴り止むことまで見る。
//
//  使い方:
//    node scripts/prod-health/self-test.mjs        # ローカルDBに対してのみ実行
//
//  ★本番に対しては絶対に実行しない（わざとデータを壊すため）。接続先がローカルでなければ停止する。
// ============================================================

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function loadEnv() {
  const env = {}
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv()
const url = (env.LOCAL_DB_URL || '').trim()
if (!url) { console.error('✗ .env に LOCAL_DB_URL が無い'); process.exit(2) }
// ★安全装置: ローカル以外には絶対に流さない
const u = new URL(url)
if (!['127.0.0.1', 'localhost'].includes(u.hostname)) {
  console.error(`✗ 接続先がローカルでない(${u.hostname})。この自己テストはデータをわざと壊すので停止する`)
  process.exit(2)
}

const pgEnv = {
  PGHOST: u.hostname, PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username || 'postgres'),
  PGPASSWORD: decodeURIComponent(u.password || ''),
  PGDATABASE: (u.pathname || '/postgres').replace(/^\//, ''),
}
const sql = (q) => {
  const out = execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q],
    { env: { ...process.env, ...pgEnv }, encoding: 'utf8' })
  // ★RETURNING を使うと値の後に "INSERT 0 1" のコマンドタグが続く。混ぜるとUUIDが壊れる。
  return out.split('\n')
    .filter((l) => l.trim() && !/^(INSERT|UPDATE|DELETE|SELECT|MERGE)\s+\d/.test(l.trim()))
    .join('\n').trim()
}

/** チェックを1本走らせて「新規違反の件数」を返す */
function freshCount(id) {
  const out = execFileSync('node', [join(ROOT, 'scripts', 'prod-health.mjs'), `--check=${id}`, '--json'],
    { encoding: 'utf8' })
  return JSON.parse(out).results[0].fresh
}

const accountId = sql(`select id from accounts where slug='test' limit 1`)
const userId = sql(`select id from users where account_id='${accountId}' limit 1`)
if (!accountId || !userId) { console.error('✗ テスト用の account / user がローカルに無い'); process.exit(2) }

/**
 * ★このテストが作るデータには必ず SELFTEST 印を付け、開始時と終了時に印で一括掃除する。
 *  理由: 最初の実装は「作った行の id を覚えて finally で消す」だけだった。ところが
 *  cleanup 自体が例外を投げた時に1行が残り、ローカルDBは他の spec と共有なので
 *  admin.report-edit-review の「承認待ちバッジが0になる」が落ちるようになった
 *  （2026-08-13 に実際に踏んだ）。後片付けは「正常終了したら消す」ではなく
 *  「印を付けて毎回まとめて消す」形にしないと、落ちた時に必ず漏れる。
 */
const MARK = 'SELFTEST'
function purgeMarked() {
  sql(`delete from daily_report_pending_edits where submitted_by_name='${MARK}' or reason like '${MARK}%'`)
  sql(`delete from daily_reports where sites::text like '%${MARK}%'`)
}
purgeMarked()                                    // 前回の落ち残りを引き継がない
process.on('exit', () => { try { purgeMarked() } catch { /* 終了処理なので握る */ } })

let pass = 0, fail = 0
const ok = (m) => { console.log(`  ✓ ${m}`); pass++ }
const ng = (m) => { console.log(`  ✗ ${m}`); fail++ }

/**
 * わざと違反を作って鳴ることを確認し、片付けて鳴り止むことまで見る。
 * seed() は片付け用の SQL を返す。
 */
function probe(id, label, seed) {
  const before = freshCount(id)
  let cleanup
  try {
    cleanup = seed()
    const during = freshCount(id)
    if (during > before) ok(`${label} — 壊したら鳴った (${before}→${during})`)
    else ng(`${label} — ★壊したのに鳴らない (${before}→${during})`)
  } catch (e) {
    ng(`${label} — 種まきに失敗: ${(e.stderr || e.message).toString().split('\n')[0]}`)
  } finally {
    if (cleanup) sql(cleanup)
  }
  const after = freshCount(id)
  if (after === before) ok(`${label} — 片付けたら鳴り止んだ`)
  else ng(`${label} — ★片付け漏れ (${before}→${after})`)
}

console.log('\n検知器の自己テスト（ローカルDB）\n' + '━'.repeat(56))
console.log('\n【わざと壊して鳴るか】')

probe('pending-edit-empty-diff', '差分が空の編集申請', () => {
  const id = sql(`insert into daily_report_pending_edits
    (account_id, report_user_id, report_date, kind, status, reason, diffs, submitted_by_name, submitted_at, payload)
    values ('${accountId}','${userId}','2026-09-01','edit','pending','SELFTEST 差分空', null, 'SELFTEST', now(), '{}'::jsonb)
    returning id`)
  return `delete from daily_report_pending_edits where id='${id}'`
})

probe('edit-claims-receipt-but-none', '「領収書添付」なのに0枚', () => {
  const payload = JSON.stringify({ sites: [{ expenses: { hotels: [{ yen: 15098, tategae: true, fileUrls: [] }] } }] })
  const id = sql(`insert into daily_report_pending_edits
    (account_id, report_user_id, report_date, kind, status, reason, diffs, submitted_by_name, submitted_at, payload)
    values ('${accountId}','${userId}','2026-09-02','edit','pending','SELFTEST 領収書の添付忘れ', '["x"]'::jsonb,
            'SELFTEST', now(), '${payload}'::jsonb)
    returning id`)
  return `delete from daily_report_pending_edits where id='${id}'`
})

probe('pending-edit-stale', '7日以上ほったらかしの申請', () => {
  const id = sql(`insert into daily_report_pending_edits
    (account_id, report_user_id, report_date, kind, status, reason, diffs, submitted_by_name, submitted_at, payload)
    values ('${accountId}','${userId}','2026-09-03','edit','pending','SELFTEST 滞留', '["x"]'::jsonb,
            'SELFTEST', now() - interval '10 days', '{}'::jsonb)
    returning id`)
  return `delete from daily_report_pending_edits where id='${id}'`
})

probe('tategae-no-receipt', '立替なのに領収書なし', () => {
  const sites = JSON.stringify([{ siteName: 'SELFTEST', expenses: { hotels: [{ yen: 33333, tategae: true, payee: 'SELFTEST宿', fileUrls: [] }] } }])
  const id = sql(`insert into daily_reports (account_id, user_id, date, is_working, sites)
    values ('${accountId}','${userId}', current_date - 1, true, '${sites}'::jsonb)
    on conflict (user_id, date) do update set sites = excluded.sites
    returning id`)
  return `delete from daily_reports where id='${id}'`
})

// ────────────────────────────────────────────────
//  DB制約で書き込み時に防がれている不変条件は、そもそも違反を作れない。
//  ★だから「鳴るか」ではなく「守りが今も掛かっているか」を確認する。
//   制約が外れた瞬間にこのテストが落ち、同時に上の監査が実データで鳴り始める＝二重の守り。
// ────────────────────────────────────────────────
console.log('\n【書き込み時の制約で守られている（違反を作れない）】')
for (const [label, idx] of [
  ['1ログイン=1作業員', 'workers_account_auth_user_unique'],
  ['同じ人・同じ日の日報は1件', 'daily_reports_user_date_unique'],
  ['作業員に users 行は1つ', 'users_account_worker_uniq'],
  ['LINEユーザーに users 行は1つ', 'expense_users_line_user_id_key'],
]) {
  const found = sql(`select count(*) from pg_indexes where schemaname='public' and indexname='${idx}'`)
  if (found === '1') ok(`${label} — 一意インデックス ${idx} が有効`)
  else ng(`${label} — ★${idx} が無い。書き込み時に防げていない`)
}

console.log('\n' + '━'.repeat(56))
console.log(`${fail ? '✗' : '✓'} ${pass} 件成功 / ${fail} 件失敗`)
process.exit(fail ? 1 : 0)
