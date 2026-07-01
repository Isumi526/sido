-- ============================================================
--  20260630020000_overtime_requests.sql
--  残業申請ワークフロー（架空残業対策）。作業員が当日15:00までに「固定終了を超える
--  終了時刻」で残業を申請し、管理者が admin で承認する。承認された worker×date のみ
--  日報の終了時刻を固定終了を超えて入力できる（未申請日は固定終了でブロック＝report.vue）。
--    - キーは worker_id（report_edit_grants と同様・ログイン方式跨ぎで安定）。
--    - account_id でテナント分離（論理）。LIFF(anon)=申請insert/自状況read、admin=承認update。
--    - 既存 LIFF 露出テーブル群に合わせ anon 運用（RLS無効・親エピックで一括RLS化）。
--    - 金額/集計には触れない（workerHours の料率計算は保存済み時刻から従来どおり算出）。
--    - 追加のみDDL（CREATE TABLE / INDEX / GRANT）。非破壊。
-- ============================================================

create table if not exists public.overtime_requests (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid references accounts(id),
  worker_id          uuid,                       -- workers.id（ログイン方式跨ぎで安定）
  date               date not null,              -- 残業する日付（通常は当日）
  requested_end_time time,                        -- 申請する終了時刻（固定終了を超える分）
  reason             text,                        -- 残業理由（任意）
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  requested_at       timestamptz not null default now(),
  approved_by        text,                        -- 承認/却下した管理者（メール等）
  decided_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists overtime_requests_account_idx
  on public.overtime_requests (account_id);
create index if not exists overtime_requests_lookup_idx
  on public.overtime_requests (account_id, worker_id, date);

-- 二重申請防止（DBレベル）: 同一 worker×date の「有効な申請」(pending/approved)は1件まで。
--   却下(rejected)は対象外＝再申請できる。アプリ側の select→insert 競合の最終防壁。
create unique index if not exists overtime_requests_active_uidx
  on public.overtime_requests (account_id, worker_id, date)
  where status in ('pending', 'approved');

-- 既存 LIFF 露出テーブルに合わせ anon 運用（RLS無効）。本番RLS化は親エピックで一括。
alter table public.overtime_requests disable row level security;
-- delete は「作業員が誤った申請を取り消す（pending 撤回）」のために許可（anon運用）。
grant select, insert, update, delete on public.overtime_requests to anon, authenticated, service_role;

comment on table public.overtime_requests is
  '残業申請/承認（worker×date）。LIFF=申請insert/自状況read、admin=承認update。承認でその日のみ固定終了超過入力を解放。';
