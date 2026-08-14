-- ============================================================
--  20260814020000_notifications_generalize.sql
--  schedule_notifications を「アプリ内通知（お知らせ）」の受け皿として汎用化する
--  Notion: アプリ内通知（お知らせ一覧）を作り、通知の届け先をそこに集約する
--
--  ★なぜ新しいテーブルを作らないのか（決定的・巻き戻し禁止）:
--   新規テーブルは ratchet 方針で「RLS 有効＋anon 遮断」にする必要がある。
--   ところが **LINE アプリ内から入る作業員は anon で動く**（Supabase JWT を持たない）。
--   新テーブルにすると、通知が最も必要なその層に1件も表示されない。
--   schedule_notifications は既に anon から読める前提でベースライン化されている
--   （.kody/accepted.yml）ので、拡張するぶんには新しい違反を積まない。
--
--  ★なぜ改名しないのか:
--   テーブル名の変更は破壊的DDL。既存の FK・INSERT 2箇所・バッジ・E2E が
--   すべて名前で繋がっている。中身が汎用になれば名前が古いだけで実害は無いので、
--   名前は据え置いて列だけ足す。
--
--  ★元々そういう設計だった:
--   20260702050000 の冒頭に「本テーブルは push/メールの送信元データも兼ねられる
--   （後続で read_at 未読分を push/メール対象にできる）」と書かれている。
--   汎用インボックスの土台として作られていて、名前だけが schedule_ に寄っていた。
--
--  追加のみDDL（ADD COLUMN / CREATE INDEX）。既存列・既存データに変更なし。
-- ============================================================

alter table schedule_notifications
  -- 何の通知か。既存行はすべて予定通知なので default 'schedule' で辻褄が合う。
  --  schedule        … 予定が追加された
  --  report_reject   … 日報の編集/提出が差し戻された
  --  （後続: overtime_decision / expense_reject / chat_mention）
  add column if not exists kind text not null default 'schedule',
  -- タップした時の遷移先（アプリ内パス）。例 '/report?edit=2026-07-24'
  --  ★ref_table/ref_id のような汎用参照にはしない。通知の役目は「関係する画面へ
  --   連れて行くこと」なので、行き先をそのまま持つのが一番壊れにくい。
  add column if not exists link_path text;

comment on column schedule_notifications.kind is
  '通知の種別（schedule / report_reject / …）。お知らせ一覧のアイコンと絞り込みに使う。';
comment on column schedule_notifications.link_path is
  'タップ時の遷移先アプリ内パス。NULL なら遷移しない。';

-- 既読を含めて新しい順に引く（お知らせ一覧）。既存の (worker_id, read_at) は
-- 未読カウント用で、この並びには効かない。
create index if not exists schedule_notifications_inbox_idx
  on schedule_notifications(account_id, worker_id, created_at desc);

-- ── ロールバック手順 ────────────────────────────────
--   drop index if exists schedule_notifications_inbox_idx;
--   alter table schedule_notifications drop column if exists link_path;
--   alter table schedule_notifications drop column if exists kind;
--   （列追加のみ。落としても既存の予定通知は無傷で、バッジも従来どおり動く。）
