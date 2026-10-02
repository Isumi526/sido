-- ============================================================
--  support_line_messages — GENLINKS の公式 LINE を入れたグループLINE（シードの管理側との修正依頼・やり取り用）の受信箱
--  （2026-10-02 亥角さん「グループLINEの修正依頼を自動で管理したい」）
--
--  ・受け口は EF support-line-webhook（LINE の署名を確かめてから保存する）。公式アカウントは何も返さない（記録だけ）
--  ・ここは生のメッセージをためるだけ。依頼への切り出しは Claude Code が /intake の前に
--    scripts/line-inbox-to-minutes.mjs で議事録DB（種別＝LINE）へまとめて移す（processed_at を付ける）
--  ・アプリの画面・ログインした人からは読めない（RLS を有効にしてポリシー無し＝service_role だけ）
--  ・画像やファイルは LINE 側ですぐ消えるので、受け取ったその場で非公開バケット support-line-media に保存する
-- ============================================================
create table if not exists public.support_line_messages (
  id               uuid primary key default gen_random_uuid(),
  -- 再送（LINE は失敗すると同じイベントを送り直す）を1件にまとめるためのキー。メッセージは message.id、それ以外は webhookEventId
  line_event_key   text not null unique,
  event_type       text not null,                 -- message / join / leave / memberJoined / memberLeft など
  message_type     text,                          -- text / image / file / video / audio / sticker / location
  source_type      text,                          -- group / room / user
  group_id         text,
  line_user_id     text,
  display_name     text,                          -- 送った人の LINE の表示名（取れた時だけ）
  text             text,                          -- 本文（テキスト以外は要約: ファイル名・スタンプ等）
  media_path       text,                          -- support-line-media の中の置き場所
  media_type       text,
  sent_at          timestamptz not null,          -- LINE の timestamp
  received_at      timestamptz not null default now(),
  raw              jsonb not null,                -- イベントの原文（後から読み直せるように）
  processed_at     timestamptz,                   -- 議事録DBへ取り込んだ時刻
  minutes_page_id  text                           -- 取り込んだ議事録DBの行
);
create index if not exists support_line_messages_unprocessed_idx
  on public.support_line_messages (sent_at) where processed_at is null;

alter table public.support_line_messages enable row level security;
revoke all on table public.support_line_messages from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('support-line-media', 'support-line-media', false)
on conflict (id) do update set public = false;
