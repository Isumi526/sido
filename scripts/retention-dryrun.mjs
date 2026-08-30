// ============================================================
//  scripts/retention-dryrun.mjs
//  保持期間を過ぎたデータの「削除候補」を数えて出す（契約対応④）
//
//  ★このスクリプトは1行も削除しない。数えて表示するだけ。
//   契約 別紙2 は「退職3年後・解約後にデータを復元不能に削除」と書いているが、
//   保持期間の確定値がまだ無い。先に候補の件数が見えたほうが期間を決めやすいので、
//   期間をパラメータにして試算できる形にした（/ball 2026-08-30 の方針）。
//
//  ★実削除は別チケット。不可逆なので、人の承認ゲートを必ず挟む設計にする。
//   このスクリプトの出力が、その承認の材料になる。
//
//  使い方:
//    node --env-file=.env scripts/retention-dryrun.mjs               # 既定3年・ローカルDB
//    node --env-file=.env scripts/retention-dryrun.mjs --years 5     # 5年で試算
//    node --env-file=.env scripts/retention-dryrun.mjs --prod        # 本番を読む（読み取りのみ）
//    node --env-file=.env scripts/retention-dryrun.mjs --csv out.csv # CSVに書き出す
// ============================================================
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const YEARS = Number(arg('--years', '3'))
const USE_PROD = argv.includes('--prod')
const CSV_OUT = arg('--csv', null)

const URL = USE_PROD ? process.env.SUPABASE_PROD_DB_URL : process.env.LOCAL_DB_URL
if (!URL) {
  console.error(USE_PROD ? 'SUPABASE_PROD_DB_URL が要ります（.env）' : 'LOCAL_DB_URL が要ります（.env）')
  process.exit(1)
}
if (!(YEARS > 0)) { console.error('--years は正の数で'); process.exit(1) }

function q(sql) {
  const r = spawnSync('psql', [URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-F', '|', '-c', sql], { encoding: 'utf8' })
  if (r.status !== 0) { console.error(r.stderr?.trim()); process.exit(1) }
  return r.stdout.split('\n').map(l => l.trim()).filter(Boolean)
}

// ★何を「保持期間の起点」にするかは種類ごとに違う。ここを間違えると
//  「まだ必要な記録を消す」または「いつまでも消えない」になる。
//  労基法109条は日報・賃金台帳などに5年（当面3年）の保存義務がある＝
//  起点は「その記録の日付」であって作成日ではない。
const RULES = [
  {
    key: 'daily_reports', label: '日報',
    note: '労基法109条の保存対象。起点は日報の対象日',
    sql: (y) => `select count(*) from daily_reports where date < (current_date - interval '${y} years')`,
  },
  {
    key: 'attendance_logs', label: '出退勤の打刻',
    note: '労基法109条の保存対象。起点は打刻日時',
    sql: (y) => `select count(*) from attendance_logs where checked_at < (now() - interval '${y} years')`,
  },
  {
    key: 'overtime_requests', label: '残業申請',
    note: '起点は対象日',
    sql: (y) => `select count(*) from overtime_requests where date < (current_date - interval '${y} years')`,
  },
  {
    key: 'personal_expenses', label: '個人経費',
    note: '起点は支出日',
    sql: (y) => `select count(*) from personal_expenses where date < (current_date - interval '${y} years')`,
  },
  {
    key: 'paid_leave_grants', label: '有給の付与',
    note: '★失効から起算する（付与日ではない）。まだ使える有給を消さないため',
    sql: (y) => `select count(*) from paid_leave_grants where expires_at < (current_date - interval '${y} years')`,
  },
  {
    key: 'site_chat_messages', label: '現場チャット',
    note: '起点は投稿日時',
    sql: (y) => `select count(*) from site_chat_messages where created_at < (now() - interval '${y} years')`,
  },
  {
    key: 'workers_retired', label: '退職した作業員',
    note: '★契約は「退職3年後」。ただし退職日を持つ列が無く、いま判定できない（下記の注意を参照）',
    sql: () => `select 0`,
    caveat: true,
  },
]

console.log(`保持期間 ${YEARS}年 を過ぎた「削除候補」の件数`)
console.log(`対象: ${USE_PROD ? '★本番（読み取りのみ）' : 'ローカル'}`)
console.log('※このスクリプトは1行も削除しません。数えて表示するだけです。')
console.log('─'.repeat(72))

const rows = []
for (const r of RULES) {
  let n = 0
  try { n = Number(q(r.sql(YEARS))[0] ?? 0) } catch { n = -1 }
  rows.push({ ...r, count: n })
  const mark = r.caveat ? '⚠' : (n > 0 ? '●' : '　')
  console.log(`${mark} ${r.label.padEnd(16, '　')} ${String(n).padStart(7)} 件   ${r.note}`)
}

console.log('─'.repeat(72))
const total = rows.filter(r => !r.caveat).reduce((a, r) => a + Math.max(0, r.count), 0)
console.log(`合計 ${total} 件が ${YEARS}年より前のデータ`)

console.log(`
★実装を進める前に決めることが2つあります。

 1. 退職した作業員の扱い
    契約は「退職3年後に削除」と書いていますが、workers に **退職日を持つ列がありません**
    （status/active で「退職済み」は分かるが、いつ退職したかが分からない）。
    退職日を記録する列を足さないと、この条件は判定できません。

 2. 消すのか、消さずに読めなくするのか
    労基法109条は日報・賃金台帳などに5年（当面3年）の保存義務があります。
    契約の「3年」と法定保存期間の関係を確認してから期間を確定してください。
    3年で消すと、法令上まだ保存が要る記録を消してしまう可能性があります。

★実削除は別チケットです。不可逆なので、人の承認ゲートを必ず挟みます。
`)

if (CSV_OUT) {
  const csv = ['種別,件数,起点の考え方', ...rows.map(r => `${r.label},${r.count},${r.note}`)].join('\n')
  writeFileSync(CSV_OUT, '﻿' + csv)
  console.log(`CSVに書き出しました: ${CSV_OUT}`)
}
