-- ============================================================
--  20260924110000_approver_push_subscriptions.sql
--  承認者（管理者・現場責任者）の端末へ「承認待ち」をプッシュ通知するための購読（A-3・2026-09-24）。追加のみ。
--
--  ★なぜ push_subscriptions と分けるか:
--   push_subscriptions は現場チャット用で「現場」単位の購読（site_id）。承認通知は「人」単位
--   （その会社の承認者の端末すべて）なので持ち方が違う。混ぜると現場チャットの配信先に承認通知が混ざる。
--
--  ★どこで購読するか: 作業員アプリ(LIFF)。承認者も作業員として毎日 LIFF で日報を出しており、
--   ホーム画面に追加された PWA（sw-push.js を持つ）はこちら。admin には Service Worker が無い。
--   通知をタップすると管理画面の承認ページ（ADMIN_URL/overtime-approvals）が開く。
--
--  ★アクセスは Edge Function(service_role) 経由だけ:
--   RLS を有効にし、anon/authenticated には一切付与しない。購読の登録は attendance-log EF が
--   身元（JWT/LINE ID token）を検証してから行う＝他人の端末を勝手に登録/削除できない。
--   （RLS監査のラチェット: 新しい表を RLS 無効×anon で作らない）
-- ============================================================
create table if not exists public.approver_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  worker_id    uuid not null references public.workers(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
-- 同じ端末(endpoint)は1行。別の人がその端末でログインし直したら持ち主を付け替える（upsert on endpoint）
create unique index if not exists approver_push_subscriptions_endpoint_uidx
  on public.approver_push_subscriptions (endpoint);
create index if not exists approver_push_subscriptions_account_idx
  on public.approver_push_subscriptions (account_id);

alter table public.approver_push_subscriptions enable row level security;
revoke all on table public.approver_push_subscriptions from anon, authenticated;

comment on table public.approver_push_subscriptions is
  '承認者の端末のWeb Push購読（承認待ちの通知用）。LIFFで登録。読み書きはEF(service_role)のみ';
