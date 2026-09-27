-- ============================================================
--  20260927130000_worker_push_and_prefs.sql
--  スマホ通知を全員向けにする（設計「承認や申請の処理をやることで完結＋通知の統一」A-1・2026-09-27）。
--
--  ・worker_push_subscriptions … 作業員（全員）の端末の Web Push 購読。1端末1行（endpoint 一意）。
--      これまでの approver_push_subscriptions（承認者だけ）を一般化したもの。既存の購読はここへ写す。
--  ・worker_notification_prefs … 通知の種類ごとのオン/オフ。**行が無い＝オン**（既定は全部オン・確認事項#4=A）。
--      kind: approval（承認のお願い）/ my_result（自分の申請の結果）/ schedule（予定）/
--            reminder（打刻・日報のお願い）/ chat（チャット）/ announcement（会社からのお知らせ）
--  どちらも読み書きは EF（service_role）だけ。RLS 有効・anon / authenticated には何も付与しない。
--
--  ★追加のみ。approver_push_subscriptions は残す（古いアプリの版が参照している間の互換・後で撤去）。
-- ============================================================

create table if not exists public.worker_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  worker_id    uuid not null references public.workers(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index if not exists worker_push_subscriptions_endpoint_uidx on public.worker_push_subscriptions (endpoint);
create index if not exists worker_push_subscriptions_worker_idx on public.worker_push_subscriptions (account_id, worker_id);
alter table public.worker_push_subscriptions enable row level security;
revoke all on table public.worker_push_subscriptions from anon, authenticated;
comment on table public.worker_push_subscriptions is
  '作業員の端末の Web Push 購読（全員・A-1）。作業員アプリで登録。読み書きは EF(service_role) のみ';

create table if not exists public.worker_notification_prefs (
  account_id uuid not null references public.accounts(id) on delete cascade,
  worker_id  uuid not null references public.workers(id) on delete cascade,
  kind       text not null check (kind in ('approval', 'my_result', 'schedule', 'reminder', 'chat', 'announcement')),
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  primary key (worker_id, kind)
);
alter table public.worker_notification_prefs enable row level security;
revoke all on table public.worker_notification_prefs from anon, authenticated;
comment on table public.worker_notification_prefs is
  'スマホ通知の種類ごとのオン/オフ（A-1）。行が無い種類はオン。読み書きは EF(service_role) のみ';

-- 既存の承認者の購読を引き継ぐ（コピーのみ・元の表は変えない）
insert into public.worker_push_subscriptions (account_id, worker_id, endpoint, p256dh, auth, created_at, last_seen_at)
select account_id, worker_id, endpoint, p256dh, auth, created_at, last_seen_at
from public.approver_push_subscriptions
on conflict (endpoint) do nothing;

-- ↩ ロールバック: 新しく作った2つの表（worker_notification_prefs / worker_push_subscriptions）を消す。
--   approver_push_subscriptions は変えていないので、コードを戻せば元どおり（戻しの SQL は人が書く）
