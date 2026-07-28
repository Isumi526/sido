-- ============================================================
--  supabase/migrations/20260728040000
--  見積R8: 元請けから来た図面PDFのページを選んで下請担当者にメール送信
--
--  背景（2026-07-28 ユーザー通しレビュー・音声）:
--   現状の業務フローは Dropbox でこうなっている。
--     元請けから来た図面をDropboxに保存
--       → 図面は工種ごとにページが分かれている（何ページ〜が塗装、何ページ〜が軽鉄）
--       → 塗装業者に投げるなら、そのページだけチェックを入れて共有
--       → 親しい相手にはLINE、かしこまった相手には該当ページだけ抽出してメール
--   これを GENLINKS 内で完結させる。
--
--  ★履歴を残す理由: 「誰にどのページを渡したか」が後で必ず問題になる
--   （見積が食い違った時に「その図面は渡していない」が起きる）。
--   pages を配列で持ち、実際に送った抽出PDFも storage に残す。
--
--  Notion: R8 3ab0ff81c56b81369617fedc1a1ab7fe
--
--  admin(authenticated)＋EF(service_role)からのみ使うためRLS有効・account_idスコープ。
-- ============================================================

create table if not exists estimate_drawing_sends (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references accounts(id),
  project_id       uuid not null references estimate_projects(id) on delete cascade,
  -- 元になった添付図面。図面が消されても送った事実は残すので on delete set null。
  attachment_id    uuid references estimate_project_attachments(id) on delete set null,
  source_name      text,                          -- 送信時点の元ファイル名（後から辿れるように控える）
  subcontractor_id uuid references subcontractors(id),
  email_to         text,                          -- 実際の宛先（カンマ区切り）
  subject          text,
  -- ★どのページを渡したか（1始まりのページ番号）
  pages            integer[] not null default '{}',
  pdf_path         text,                          -- 抽出後PDFの保存先（estimate-drawings バケット）
  note             text,
  sent_at          timestamptz,                   -- 実送信できた時だけ入る（失敗を成功に見せない）
  created_at       timestamptz not null default now()
);
create index if not exists est_dsend_account_idx on estimate_drawing_sends(account_id);
create index if not exists est_dsend_project_idx on estimate_drawing_sends(project_id, created_at desc);

alter table estimate_drawing_sends enable row level security;
revoke all on estimate_drawing_sends from anon;
grant select, insert, update, delete on estimate_drawing_sends to authenticated;

drop policy if exists est_dsend_sel on estimate_drawing_sends;
create policy est_dsend_sel on estimate_drawing_sends for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_dsend_ins on estimate_drawing_sends;
create policy est_dsend_ins on estimate_drawing_sends for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_dsend_upd on estimate_drawing_sends;
create policy est_dsend_upd on estimate_drawing_sends for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_dsend_del on estimate_drawing_sends;
create policy est_dsend_del on estimate_drawing_sends for delete to authenticated
  using (account_id = (select public.current_account_id()));
