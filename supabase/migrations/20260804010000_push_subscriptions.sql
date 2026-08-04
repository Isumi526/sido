-- ============================================================
--  20260804010000_push_subscriptions.sql
--  現場チャットの新着を web push で知らせるための購読先。
--
--  ★背景: 招待リンク経由のゲスト（非ユーザー）は、チャット画面を開いていない間
--   新着に気づけなかった。要回答の回答=A（web push で進める）に基づく土台。
--
--  ★効く範囲は限定的（承知の上）: LINE webview では web push は動作しない可能性が高く、
--   現実的に効くのは iOS16.4+ Safari 等で「ホーム画面に追加」した standalone PWA。
--   非対応環境では購読自体を行わない（静かに no-op）設計にしてある。
--
--  追加のみDDL（CREATE TABLE / CREATE INDEX / CREATE POLICY）。既存テーブルへの変更なし。
-- ============================================================

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id),
  -- どの現場のチャットの新着を受け取るか。現場単位で購読する。
  site_id     uuid references sites(id) on delete cascade,

  -- Web Push の購読情報（PushSubscription.toJSON() の中身）
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,

  -- 誰の購読か分かるようにする任意のラベル（ゲスト名など）。個人特定情報は入れない。
  label       text,
  -- 自分が送ったメッセージで自分に通知しないための識別子（送信者名の一致判定に使う）
  sender_name text,

  created_at  timestamptz not null default now()
);

-- 同じ端末（endpoint）が同じ現場を二重購読しないようにする＝通知が複数回届くのを防ぐ
create unique index if not exists push_subs_endpoint_site_uniq
  on push_subscriptions(endpoint, site_id);
create index if not exists push_subs_site_idx
  on push_subscriptions(account_id, site_id);

alter table push_subscriptions enable row level security;

-- ★anon には一切開けない（独立レビュー2026-08-04のcritical指摘）。
--   当初は「ゲストが登録するので insert だけ anon に開ける」設計にしていたが、
--   `with check (true)` だと **誰でも任意の account_id / site_id に購読を登録できる**。
--   購読できるということは、その現場のチャットの新着プレビュー（送信者名＋本文の先頭）が
--   自分の端末に push で届くということ＝**他テナントのチャット内容が漏れる**。
--   → 登録も EF(send-site-chat-push の action=subscribe・service_role) 経由に統一し、
--     EF側で「招待トークンが実在する / 身元がその現場のアカウントに属する」を確認してから入れる。
revoke all on push_subscriptions from anon;
revoke all on push_subscriptions from authenticated;
grant select on push_subscriptions to authenticated;

-- 管理画面が「この現場に何件購読があるか」を見るための SELECT のみ（自テナント限定）
drop policy if exists push_subs_sel on push_subscriptions;
create policy push_subs_sel on push_subscriptions for select to authenticated
  using (account_id = (select public.current_account_id()));

comment on table push_subscriptions is
  '現場チャット新着の web push 購読先。anon は一切触れない（登録も EF send-site-chat-push の action=subscribe 経由＝招待トークン/身元を検証してから入れる）。任意の site_id に購読できると他テナントのチャット内容がpushで漏れるため。';

-- ── ロールバック手順 ────────────────────────────────
--   drop table if exists push_subscriptions;
