#!/usr/bin/env node
// ============================================================
//  scripts/seed-staging-demo.mjs
//  ステージング（本番Supabase・demoテナント）に「レビューできる状態」を作る。
//
//  使い方:
//    node --env-file=.env scripts/seed-staging-demo.mjs          # 投入（毎回作り直し）
//    node --env-file=.env scripts/seed-staging-demo.mjs --clean  # 片付け
//
//  ★作るものは全部「確認用」接頭辞。demo テナントの既存データ（デモ太郎〜五郎・4現場・
//   36日報）には触らない。片付けは接頭辞の一括削除で完結する。
//
//  ★書き込み先は本番Supabaseの demo テナント。他テナントには絶対に触らない
//   （account_id を固定し、SQL は全部その条件で書く）。
// ============================================================
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const DB = process.env.SUPABASE_PROD_DB_URL
if (!DB) { console.error('SUPABASE_PROD_DB_URL が無い（node --env-file=.env で実行する）'); process.exit(1) }

const DEMO = '67c75a85-2513-4755-9171-ce87be3011bb'   // accounts.slug='demo'
const PREFIX = '確認用'

const psql = (sql) => {
  writeFileSync('/tmp/.seed-staging.sql', sql)
  return execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-tA', '-f', '/tmp/.seed-staging.sql'], { encoding: 'utf8' })
}

// ★念のため: 本当に demo テナントか確かめてから書く（IDを取り違えて本番テナントを汚さない）
const slug = psql(`select slug from accounts where id='${DEMO}'`).trim()
if (slug !== 'demo') { console.error(`★account_id が demo ではない（${slug}）。中止する。`); process.exit(1) }

const CLEAN = `
delete from attendance_logs where site_id in (select id from sites where account_id='${DEMO}' and name like '${PREFIX}%');
delete from daily_reports where account_id='${DEMO}' and note like '${PREFIX}%';
delete from sites where account_id='${DEMO}' and name like '${PREFIX}%';
delete from contractors where account_id='${DEMO}' and name like '${PREFIX}%';
`

if (process.argv.includes('--clean')) {
  psql(CLEAN)
  console.log('片付け完了（確認用* を全削除）。demo の既存データは残っている。')
  process.exit(0)
}

const today = execFileSync('date', ['+%Y-%m-%d'], { encoding: 'utf8' }).trim()

psql(`
begin;
${CLEAN}

-- 元請け3社（現場別集計の「元請けで絞る」を試すため）
insert into contractors (account_id, name, active, sort_order) values
  ('${DEMO}','${PREFIX}ゼネコンA',true,0), ('${DEMO}','${PREFIX}ゼネコンB',true,1), ('${DEMO}','${PREFIX}ゼネコンC',true,2);

-- 現場30件。固定勤務時刻＋既定休憩つき（実働時間の自動計算／打刻との突き合わせに要る）。
-- 4件に1件は元請け未設定にする＝「元請けで絞ると出てこない現場」を再現する。
insert into sites (account_id, name, active, contractor_id, default_start_time, default_end_time, default_breaks)
select '${DEMO}',
       '${PREFIX}' || (array['新宿','渋谷','品川','横浜','大宮'])[1+(i%5)]
                    || (array['ビル','倉庫','工場','店舗','マンション'])[1+(i%5)] || lpad(i::text,2,'0'),
       true,
       case when i%4=3 then null else
         (select id from contractors where account_id='${DEMO}' and name='${PREFIX}ゼネコン'||(array['A','B','C'])[1+(i%3)]) end,
       '08:30','18:00',
       '[{"start":"12:00","minutes":60},{"start":"15:00","minutes":30}]'::jsonb
from generate_series(1,30) i;

-- 出退勤: 設定08:30-18:00 に対し 6:02出勤 / 19:53退勤 ＝ 大きなズレを目視できる（早朝搬入の再現）。
-- デモ三郎はわざと打刻しない＝「出勤打刻なし」に出る。
with s as (select id from sites where account_id='${DEMO}' and name like '${PREFIX}新宿ビル%' limit 1),
     w as (select id, name from workers where account_id='${DEMO}' and name in ('デモ太郎','デモ次郎'))
insert into attendance_logs (site_id, worker_id, type, checked_at, agreed_rule_texts)
select s.id, w.id, x.t, ('${today} '||x.hm||'+09')::timestamptz, '{}'
from s, w, (values ('checkin','06:02'),('checkout','19:53')) x(t,hm);

-- 経費: 旅費交通費(駐車/高速/電車)と 車両費(ガソリン) を当月に。科目・品名の表示と科目絞り込み用。
with u as (select u.id from users u join workers w on w.id=u.worker_id
           where w.account_id='${DEMO}' and w.name='デモ太郎' limit 1),
     s as (select name from sites where account_id='${DEMO}' and name like '${PREFIX}新宿ビル%' limit 1)
insert into daily_reports (account_id, user_id, date, is_working, note, sites, gasoline_items)
select '${DEMO}', u.id, '${today}'::date, true, '${PREFIX}',
  jsonb_build_array(jsonb_build_object(
    'siteName', s.name, 'workers','[]'::jsonb, 'subcontractors','[]'::jsonb,
    'expenses', jsonb_build_object(
      'parkings', jsonb_build_array(jsonb_build_object('yen',800,'payee','${PREFIX}タイムズ','tategae',true,'fileUrls','[]'::jsonb)),
      'highways', jsonb_build_array(jsonb_build_object('yen',1200,'payee','${PREFIX}NEXCO','tategae',false,'fileUrls','[]'::jsonb)),
      'trains',   jsonb_build_array(jsonb_build_object('yen',420,'payee','${PREFIX}JR','tategae',true,'fileUrls','[]'::jsonb)),
      'vehicles','[]'::jsonb,'hotels','[]'::jsonb,'others','[]'::jsonb,'entertainments','[]'::jsonb))),
  jsonb_build_array(jsonb_build_object('yen',5000,'liters',30,'payee','${PREFIX}ENEOS','tategae',false,'fileUrls','[]'::jsonb))
from u, s
on conflict (user_id, date) do update
  set sites = excluded.sites, gasoline_items = excluded.gasoline_items, note = '${PREFIX}';
commit;
`)

const n = psql(`
select '現場 '||(select count(*) from sites where account_id='${DEMO}' and name like '${PREFIX}%')
    || ' / 元請け '||(select count(*) from contractors where account_id='${DEMO}' and name like '${PREFIX}%')
    || ' / 打刻 '||(select count(*) from attendance_logs a join workers w on w.id=a.worker_id
                    -- ★JST基準で数える。checked_at::date は UTC 解釈になり、朝6時台の打刻が前日扱いで落ちる
                    where w.account_id='${DEMO}'
                      and (a.checked_at at time zone 'Asia/Tokyo')::date = '${today}')
    || ' / 当日の経費日報 '||(select count(*) from daily_reports where account_id='${DEMO}' and date='${today}' and note like '${PREFIX}%')
`).trim()
console.log('投入完了:', n)
console.log('※ デモ三郎は打刻していない（「出勤打刻なし」の確認用）')
