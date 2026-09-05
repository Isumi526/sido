-- ============================================================
--  20260903090000_trial_notice.sql
--  無償試用期間の満了を「20日前までに」告知し、確認した履歴を残す
--
--  ★背景（2026-09-01 弁護士打合せ・契約書第22条の3第2項）:
--   甲（当社）は無償試用期間の満了日の20日前までに、満了日・有償への移行・
--   移行しない場合の申出期限（10日前）を通知する義務を負う。
--   弁護士の回答:「チェックしてからないと通常の操作ができないよってこうしてれば
--   いい」「先方が確認したっていう履歴が残るような形になってれば」。
--
--  ★月額金額はテナントごとの契約条件で異なる（5万〜10万円・契約書別紙）ため、
--   accounts に monthly_fee_yen を追加した。未設定のテナントには誤った金額を
--   表示できないため、EF側で null の間はポップアップを出さない（フェイルセーフ）。
--   新規テナントは scripts/provision-tenant.mjs --monthly-fee で設定する運用。
--   既存テナントは billing_status='active'（無償期間データ模型のmigrationで
--   本日中に一括'active'化済み）のためこの機能の対象外＝今回の変更で挙動が
--   変わるテナントは無い。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。
-- ============================================================

alter table public.accounts add column if not exists monthly_fee_yen integer;
comment on column public.accounts.monthly_fee_yen is
  '有償移行後の月額（円・税別/税込は契約書に従う）。無償満了の告知ポップアップに表示する。'
  ' 未設定の間は告知ポップアップを出さない（誤った金額を出さないためのフェイルセーフ）。';

create table if not exists public.trial_notice_acks (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.accounts(id) on delete cascade,
  -- どの無償満了日についての確認か。満了日が変わる(延長等)と別レコードとして再度告知される。
  trial_ends_at          date not null,
  -- 表示した時点の値のスナップショット（後で金額を変更しても過去の確認内容は変わらない）
  monthly_fee_yen        integer,
  notice_deadline        date not null,   -- 申出期限（満了日の10日前）
  confirmed_by_worker_id uuid references public.workers(id),
  confirmed_by_email     text,            -- workerが後で削除されても監査用に残す
  confirmed_at           timestamptz not null default now(),
  shown_content          jsonb not null,  -- 実際に画面へ表示した文言そのもの（AC4）
  created_at             timestamptz not null default now()
);

comment on table public.trial_notice_acks is
  '無償試用期間の満了告知に対する、管理者の確認履歴（契約上の通知義務の証跡）。'
  ' 監査ログのため、confirmed_at 以降に内容を書き換えられないようUPDATE/DELETEは許可しない。';

-- 同じ満了日への重複確認は不要（最新の満了日に確認済みかを1行の有無で判定できるように）
create unique index if not exists trial_notice_acks_account_period_uniq
  on public.trial_notice_acks (account_id, trial_ends_at);

create index if not exists trial_notice_acks_account_idx
  on public.trial_notice_acks (account_id);

-- ── 権限 ──────────────────────────────────────────────
--  ★書きは EF(service_role) 経由のみ。「本人が実際に画面で確認して押した」ことを
--   サーバ側で検証してから書く。クライアント直書きにすると押していない確認を偽装できる。
--   （worker_consents と同じ考え方）
alter table public.trial_notice_acks enable row level security;
revoke all on public.trial_notice_acks from anon;
revoke insert, update, delete on public.trial_notice_acks from authenticated;

-- 管理画面が確認状況を読むぶんだけ許す（自テナントのみ）
drop policy if exists trial_notice_acks_select_own_account on public.trial_notice_acks;
create policy trial_notice_acks_select_own_account
  on public.trial_notice_acks for select to authenticated
  using (account_id = (select public.current_account_id()));
