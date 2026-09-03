// ============================================================
//  scripts/seed-punch-correction-review.mjs
//  打刻修正のレビュー用に「大須賀さんが実際に踏んだ連鎖」をローカルで再現する。
//
//  再現する状態（2026-09-03 本番で起きたもの）:
//    昨日 17:45 退勤（後追い入力）
//    昨日 17:58 出勤 ← 退勤のつもりで押した
//    今日 08:05 退勤 ← 出勤のつもりで押した（前日の誤出勤で「出勤中」扱いになったため）
//
//  使い方:
//    node --env-file=.env scripts/seed-punch-correction-review.mjs         # 作る
//    node --env-file=.env scripts/seed-punch-correction-review.mjs --clean # 片付け
//
//  ★ローカル(LOCAL_DB_URL)専用。本番の接続文字列では動かさないこと。
// ============================================================
import { execFileSync } from 'node:child_process'

const DB = process.env.LOCAL_DB_URL
if (!DB) { console.error('LOCAL_DB_URL が未設定です（.env）'); process.exit(1) }
if (!/127\.0\.0\.1|localhost/.test(DB)) { console.error('ローカルDBではありません。中止します'); process.exit(1) }

const clean = process.argv.includes('--clean')
const psql = (sql) => execFileSync('psql', [DB, '-tAc', sql], { encoding: 'utf8' }).trim()

const workerId = psql(`select w.id from users u join workers w on w.id = u.worker_id where u.line_user_id = 'dev-user-id' limit 1`)
if (!workerId) { console.error('dev-user-id に紐づく作業員が見つかりません'); process.exit(1) }

// 直近7日ぶんを一度きれいにする（レビューのたびに古い打刻が積み上がらないように）
psql(`delete from attendance_correction_requests where log_id in (
        select id from attendance_logs where worker_id = '${workerId}' and checked_at > now() - interval '7 days')`)
psql(`delete from attendance_logs where worker_id = '${workerId}' and checked_at > now() - interval '7 days'`)

if (clean) { console.log('✓ 片付けました（直近7日の打刻と修正申請を削除）'); process.exit(0) }

const rows = [
  // [JSTの日付オフセット, 時刻, 種別, 後追い入力か]
  [1, '17:45', 'checkout', true],   // 打ち忘れに気づいて後から入れた（正しい）
  [1, '17:58', 'checkin',  false],  // ★退勤のつもりで出勤を押した
  [0, '08:05', 'checkout', false],  // ★出勤のつもりで退勤を押した（連鎖）
]
for (const [offset, hhmm, type, backdated] of rows) {
  // ★括弧が要る。`+ time 'x' at time zone 'JST'` と書くと at time zone が time 側に
  //  先に掛かって時刻がずれる（17:45 が 02:45 になった）。日時を組んでから変換する。
  psql(`insert into attendance_logs (worker_id, type, checked_at, agreed_rule_texts, backdated)
        values ('${workerId}', '${type}',
          (((now() at time zone 'Asia/Tokyo')::date - ${offset}) + time '${hhmm}') at time zone 'Asia/Tokyo',
          '{}', ${backdated})`)
}

console.log('✓ 再現しました（作業員: Worker 01 / dev-user-id）')
console.log(psql(`select to_char(checked_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') || '  ' ||
                    case type when 'checkin' then '出勤' else '退勤' end ||
                    case when backdated then '（後追い）' else '' end
                  from attendance_logs where worker_id = '${workerId}' and checked_at > now() - interval '7 days'
                  order by checked_at`))
