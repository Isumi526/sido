-- ============================================================
--  20260827010000_attendance_daily_model.sql
--  出退勤モデルの変更（2026-08-19 打合せ・2026-08-27 大塚さん回答で確定）
--   1) 現場ごとの打刻をやめ、1日「最初の出勤」「最後の退勤」の2回のみにする
--      → attendance_logs.site_id を任意（NULL可）にする。列は消さない（既存行の参照を壊さない）
--   2) 打刻時のルールは現場別ではなく「アカウント共通の1セット」を出勤/退勤の2回見せる
--      → account_attendance_rules を新設（site_rules は現場別のまま残置・UIから外す）
--
--  ★このマイグレーションは追加のみ（非破壊）。
--   ・site_id は元々 NOT NULL ではないので列定義の変更は不要。
--     変えるのは「sites への join を要求していた INSERT ポリシー」だけ。
--   ・既存データ（打刻35件・現場ルール29件／本番実測 2026-08-27）は消さない。
--     大塚さんから「ほとんど動いていないので捨ててOK」と回答済みだが、
--     データ削除は不可逆なので本マイグレーションには含めない（必要なら別途人の承認で）。
-- ============================================================

-- ── 1) 打刻を現場非依存にする ────────────────────────
-- 既存の INSERT ポリシーは sites への join を含んでおり、site_id が NULL だと
-- authenticated 経路の INSERT が通らない（EF は service_role なので RLS 非適用だが、
-- ポリシーの意味が「現場前提」のまま残ると将来の経路追加時に事故る）。
-- 「今この瞬間・自テナントの作業員」という縛りは維持したまま、現場の要求だけ外す。
drop policy if exists attendance_insert_guarded on attendance_logs;
create policy attendance_insert_guarded on attendance_logs for insert to authenticated
  with check (
    checked_at >= now() - interval '10 minutes'
    and checked_at <= now() + interval '10 minutes'
    and exists (
      select 1 from workers w
      where w.id = attendance_logs.worker_id
    )
    -- site_id は任意。付いている場合だけ自テナントの現場であることを求める
    and (
      attendance_logs.site_id is null
      or exists (
        select 1 from workers w2
        join sites s on s.id = attendance_logs.site_id
        where w2.id = attendance_logs.worker_id
          and s.account_id = w2.account_id
      )
    )
  );

comment on column attendance_logs.site_id is
  '打刻した現場。2026-08-27 の出退勤モデル変更で任意になった（1日=最初の出勤・最後の退勤の2回のみ・現場に紐づけない）。'
  ' 変更前のデータおよび現場QR経由の打刻にのみ値が入る。工数配賦・原価計算には使わない（日報の申請時間を使う）。';

-- 1日1組（出勤/退勤）を素早く引くための索引。現場を跨がなくなるので worker×日で引く
create index if not exists attendance_logs_worker_checked_idx
  on attendance_logs (worker_id, checked_at desc);

-- ── 2) アカウント共通の確認ルール ────────────────────
create table if not exists account_attendance_rules (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  -- 出勤時だけ／退勤時だけ／両方、のどれで見せるか（site_rules と同じ語彙に揃える）
  timing      text not null default 'both' check (timing in ('checkin', 'checkout', 'both')),
  content     text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists account_attendance_rules_account_idx
  on account_attendance_rules (account_id, timing, sort_order);

comment on table account_attendance_rules is
  '出退勤の打刻時に見せるアカウント共通の確認ルール（2026-08-27 出退勤モデル変更）。'
  ' 現場別ルール(site_rules)を置き換える。現場特有の内容は「送り出し資料」の承認フローへ移す。';

-- RLS: 自テナントのみ。読み書きとも authenticated（管理画面）に限る。
-- ★anon には一切許さない。LIFF の打刻画面は attendance-log EF(service_role)経由で
--  ルールを受け取るので、公開キーでの直読みは要らない（当初 using(true) にしていたが、
--  それだと公開キーで全テナントのルール本文が読めてしまう＝テナント越境。2026-08-30 是正）。
alter table account_attendance_rules enable row level security;

drop policy if exists aar_select_all on account_attendance_rules;
drop policy if exists aar_select_tenant on account_attendance_rules;
create policy aar_select_tenant on account_attendance_rules for select to authenticated
  using (account_id = (select current_account_id()));

drop policy if exists aar_write_authenticated on account_attendance_rules;
create policy aar_write_authenticated on account_attendance_rules for all to authenticated
  using (
    exists (
      select 1 from workers w
      where w.auth_user_id = auth.uid() and w.account_id = account_attendance_rules.account_id
    )
    or exists (
      select 1 from accounts a
      where a.id = account_attendance_rules.account_id and a.owner_auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from workers w
      where w.auth_user_id = auth.uid() and w.account_id = account_attendance_rules.account_id
    )
    or exists (
      select 1 from accounts a
      where a.id = account_attendance_rules.account_id and a.owner_auth_user_id = auth.uid()
    )
  );

revoke all on account_attendance_rules from anon;
grant select, insert, update, delete on account_attendance_rules to authenticated;

-- ── ロールバック手順 ────────────────────────────────
--   drop table if exists account_attendance_rules;
--   drop index if exists attendance_logs_worker_checked_idx;
--   -- INSERT ポリシーを現場必須へ戻す:
--   drop policy if exists attendance_insert_guarded on attendance_logs;
--   create policy attendance_insert_guarded on attendance_logs for insert to authenticated
--     with check (
--       checked_at >= now() - interval '10 minutes'
--       and checked_at <= now() + interval '10 minutes'
--       and exists (
--         select 1 from workers w join sites s on s.id = attendance_logs.site_id
--         where w.id = attendance_logs.worker_id and s.account_id = w.account_id
--       )
--     );
