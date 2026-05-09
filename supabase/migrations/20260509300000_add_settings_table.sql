-- ============================================================
--  supabase/migrations/20260509300000
--  設定マスタテーブル（燃料単価など）
-- ============================================================

create table if not exists settings (
  key        text primary key,
  value      text not null,
  label      text not null,
  updated_at timestamptz not null default now()
);

-- 初期データ
insert into settings (key, value, label) values
  ('gasoline_rate_per_km', '23', 'ガソリン単価（円/km）'),
  ('diesel_rate_per_km',   '20', '軽油単価（円/km）')
on conflict (key) do nothing;

alter table settings disable row level security;
