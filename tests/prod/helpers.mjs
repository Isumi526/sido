// 本番スモーク用の下ごしらえ（demoテナントのみ・実テナントには一切触れない）
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const DB = env.SUPABASE_PROD_DB_URL
export const WORKER = 'デモ次郎'
export const SLUG = 'demo'
// ★Postgres の current_date は UTC 基準。日本時間の「今日」とは深夜〜朝でズレる。
//  アプリは JST で動くので、テストデータも必ず JST の日付で作る（実際に1日ズレて誤検知した）
export const JST_TODAY = "(now() at time zone 'Asia/Tokyo')::date"

export function q(sql) {
  return execFileSync('psql',[DB,'-A','-t','-v','ON_ERROR_STOP=1','-c',sql],
    { encoding:'utf8', stdio:['ignore','pipe','pipe'] })
}
export const ymd = (n=0) => new Intl.DateTimeFormat('en-CA',{ timeZone:'Asia/Tokyo' })
  .format(new Date(Date.now() - n*86400000))
/** ★必ず slug='demo' と worker 名で縛る。日付だけの DELETE は書かない */
const GUARD = `join users u on u.id=dr.user_id join workers w on w.id=u.worker_id join accounts a on a.id=w.account_id
  where a.slug='${SLUG}' and w.name='${WORKER}'`
export function clearToday() {
  q(`delete from daily_reports dr using users u, workers w, accounts a
     where dr.user_id=u.id and u.worker_id=w.id and w.account_id=a.id
       and a.slug='${SLUG}' and w.name='${WORKER}' and dr.date >= ${JST_TODAY} - 8;`)
  q(`delete from attendance_logs al using workers w, accounts a
     where al.worker_id=w.id and w.account_id=a.id
       and a.slug='${SLUG}' and w.name='${WORKER}' and al.checked_at >= ${JST_TODAY} - 8;`)
  q(`delete from daily_report_pending_edits p using users u, workers w, accounts a
     where p.report_user_id=u.id and u.worker_id=w.id and w.account_id=a.id
       and a.slug='${SLUG}' and w.name='${WORKER}' and p.report_date >= ${JST_TODAY} - 8;`)
}
/** 過去日を提出済みにして「溜まり無し」にする */
export function fillBacklog() {
  q(`update workers w set report_start_date = ${JST_TODAY} - 2
     from accounts a where a.id=w.account_id and a.slug='${SLUG}' and w.name='${WORKER}';`)
  for (const n of [1,2,3,4,5,6]) {
    q(`insert into daily_reports (account_id, user_id, date, is_working, sites, note)
       select a.id, u.id, ${JST_TODAY} - ${n}, false, '[]'::jsonb, 'smoke'
       from users u join workers w on w.id=u.worker_id join accounts a on a.id=w.account_id
       where a.slug='${SLUG}' and w.name='${WORKER}'
       on conflict (user_id, date) do nothing;`)
  }
}
/** 過去日を未提出にして「溜まりあり」にする */
export function makeBacklog() {
  q(`update workers w set report_start_date = ${JST_TODAY} - 6
     from accounts a where a.id=w.account_id and a.slug='${SLUG}' and w.name='${WORKER}';`)
  clearToday()
}
export function punch(type, hhmm) {
  q(`insert into attendance_logs (worker_id, type, agreed_rule_texts, backdated, checked_at)
     select w.id, '${type}', '{}', false, (${JST_TODAY}::text || ' ${hhmm}:00+09')::timestamptz
     from workers w join accounts a on a.id=w.account_id
     where a.slug='${SLUG}' and w.name='${WORKER}';`)
}
export function todayReport() {
  return q(`select coalesce(json_agg(json_build_object('is_working',dr.is_working,'leave_type',dr.leave_type,'leave_days',dr.leave_days))::text,'[]')
    from daily_reports dr ${GUARD} and dr.date = ${JST_TODAY};`).trim()
}
export function todayPunches() {
  return q(`select count(*) from attendance_logs al join workers w on w.id=al.worker_id
    join accounts a on a.id=w.account_id where a.slug='${SLUG}' and w.name='${WORKER}'
    and al.checked_at >= (${JST_TODAY}::text || ' 00:00:00+09')::timestamptz;`).trim()
}
