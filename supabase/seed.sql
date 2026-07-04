-- ============================================================
--  supabase/seed.sql  （ローカルスタック専用の架空シード）
--  `supabase db reset` 実行時に全migration適用後、自動で流れる。
--  ※ 本番の実名・顧客情報は一切含めない。すべて Worker 01 等の架空値。
--  ※ アプリの .env.local は ACCOUNT_SLUG=test なので 'test' アカウントに紐付ける。
--  すべて冪等（on conflict do nothing）。
-- ============================================================

-- ── アカウント（ローカル用 test）──────────────────────────
insert into accounts (name, slug) values ('ローカルテスト建設', 'test')
on conflict (slug) do nothing;

-- ── 作業員マスタ（架空）──────────────────────────────────
-- created_at を service_start_date(2026-01-01)より前に固定：
--   getNextUnsubmittedDate の起点 effStart=max(service_start_date, workers.created_at) が
--   reset当日にならず、未送信日が複数残る → liff 日報送信系E2E(report/ai-receipt/parking)が
--   「未送信日が1日だけ→1本submit後skip」にならず安定して走る。
-- daily_wage=日当(=unit_price)・hourly_wage=時給(=日当/8 の概算)を明示（新モデル：両方必須）
insert into workers (name, role, unit_price, daily_wage, hourly_wage, sort_order, account_id, created_at)
select v.name, v.role, v.price, v.price, round(v.price / 8.0)::int, v.ord, a.id, timestamptz '2025-12-01 00:00:00+09'
from accounts a
cross join (values
  ('Worker 01', 'site',    20000, 1),
  ('Worker 02', 'site',    20000, 2),
  ('Worker 03', 'factory', 22000, 3),
  ('Worker 04', 'site',    21000, 4),
  ('Worker 05', 'factory', 23000, 5)
) as v(name, role, price, ord)
where a.slug = 'test'
on conflict (name, account_id) do nothing;

-- ── 現場マスタ（架空）────────────────────────────────────
insert into sites (name, sort_order, account_id)
select v.name, v.ord, a.id
from accounts a
cross join (values ('テスト現場A', 1), ('テスト現場B', 2), ('テスト現場C', 3), ('テスト現場D', 4)) as v(name, ord)
where a.slug = 'test'
on conflict (name, account_id) do nothing;

-- ── 下請け業者マスタ（架空）──────────────────────────────
insert into subcontractors (name, sort_order, account_id)
select v.name, v.ord, a.id
from accounts a
cross join (values ('下請A', 1), ('下請B', 2)) as v(name, ord)
where a.slug = 'test'
on conflict (name, account_id) do nothing;

-- ── 元請け業者マスタ（架空・今朝の新機能 contractors）────
insert into contractors (name, sort_order, account_id)
select v.name, v.ord, a.id
from accounts a
cross join (values ('元請A', 1), ('元請B', 2)) as v(name, ord)
where a.slug = 'test'
on conflict (name, account_id) do nothing;

-- ── 車両マスタ（架空）────────────────────────────────────
insert into vehicles (name, sort_order, account_id)
select v.name, v.ord, a.id
from accounts a
cross join (values ('軽トラ1号', 1), ('ハイエース1号', 2)) as v(name, ord)
where a.slug = 'test'
on conflict (name, account_id) do nothing;

-- ── LIFF dev モード用ユーザー（line_user_id='dev-user-id'）─
--    Worker 01 に紐付け。これでローカルでもLIFFが動く。
insert into users (line_user_id, worker_id, real_name, worker_role, is_approved, account_id)
select 'dev-user-id', w.id, 'Worker 01', 'site', true, a.id
from accounts a
join workers w on w.name = 'Worker 01'
where a.slug = 'test'
on conflict (line_user_id) do nothing;

-- ── サンプル日報1件（当日・明細つき）──────────────────────
insert into daily_reports (user_id, date, is_working, leave_type, note, account_id, sites)
select u.id, current_date, true, null, 'ローカルseedのサンプル日報', a.id,
  '[{
     "siteName": "テスト現場A",
     "workers": [{"workerName":"Worker 01","workerRole":"site","startTime":"08:00","endTime":"17:30","breakMinutes":60}],
     "expenses": {"vehicles":[{"vehicleName":"軽トラ1号","distanceKm":20,"parkingYen":500}], "trains":[], "others":[]},
     "subcontractors": [{"subcontractorName":"下請A","count":2}],
     "siteNote": "seedメモ"
   }]'::jsonb
from accounts a
join users u on u.line_user_id = 'dev-user-id'
where a.slug = 'test'
on conflict (user_id, date) do nothing;

-- ── 設定（ローカルは通知OFFにしておく＝余計な送信を避ける）─
insert into settings (key, value, label, account_id)
select v.key, v.val, v.label, a.id
from accounts a
cross join (values
  ('service_start_date',     '2026-01-01', 'サービス開始日'),
  ('notify_report_enabled',  'false',      '日報通知（送信・編集）')
) as v(key, val, label)
where a.slug = 'test'
on conflict (key, account_id) do nothing;

-- ── 予定カテゴリマスタ（#A・iOSカレンダー設定キャプチャの名目/カラーそのまま）─
insert into schedule_categories (account_id, key, label, color, sort_order, active)
select a.id, v.key, v.label, v.color, v.ord, true
from accounts a
cross join (values
  ('general',          'カレンダー',       '#34C6E0', 0),
  ('meeting-survey',   '打ち合わせ現調',   '#1F7A34', 1),
  ('work',             '現場作業',         '#8CC63F', 2),
  ('meeting',          '会議、会合',       '#C62828', 3),
  ('private',          'プライベート',     '#F35C8B', 4),
  ('business-trip',    '出張',             '#283593', 5),
  ('birthday',         '誕生日',           '#F9C74F', 6),
  ('night-work',       '現場作業　夜勤',   '#2B2B2B', 7),
  ('important',        '重要',             '#E0A800', 8),
  ('schedule-process', '現場工程',         '#9CA3AF', 9)
) as v(key, label, color, ord)
where a.slug = 'test'
on conflict (account_id, key) do update
  set label = excluded.label, color = excluded.color, sort_order = excluded.sort_order, active = true;

-- ────────────────────────────────────────────────────────────────
-- ローカルE2E用 GRANT（root fix / 2026-06-24）
--   liff・admin は anon キーで public 表を読み書きする設計（RLS未有効）。
--   fresh `supabase db reset` 直後は anon/authenticated/service_role が
--   public 表へアクセスできず、E2E global-setup のシードが 401 で全落ちし
--   liff の現場プルダウン等も空になっていた（過去はアドホックGRANTのドリフトで成立）。
--   seed.sql は **ローカル db reset 専用**（本番migrationには含まれない）ため、
--   ここで明示GRANTしてローカルのテスト基盤を毎回再現可能にする。
-- ────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
-- 以降に作られる表にも自動付与（将来のmigration追加表もシード後に取りこぼさない）
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
