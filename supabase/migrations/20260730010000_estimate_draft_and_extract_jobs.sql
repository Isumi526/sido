-- ============================================================
--  supabase/migrations/20260730010000
--  見積R51/R52/R53: 新規見積をステップ式にする土台（追加のみDDL）
--
--  背景（2026-07-30 ユーザー通しレビュー・第5回）:
--   ① 新規見積は「案件名を打つ」から始まるが、実際に最初に手元にあるのは元請けから来た図面。
--      図面を先に置き、案件名はファイル名から起こす形にする（R51）。
--   ② 担当者マスタを直しに行って戻ると入力が消える。原因は「作成ボタンを押すまで
--      DBに何も無く、URLにIDも無い」こと。押した時点で行を作り URL に ID を持たせる（R52）。
--      → 案件名が決まる前に行ができるので、name には仮名が入る。
--        (account_id, lower(name)) の一意index があるため仮名は必ず一意にする（時刻入り）。
--        「まだ名前が決まっていない行」を一覧で見分けられるように is_draft を持つ。
--   ③ 材料抽出は54ページの図面で数分かかり、その間モーダルに拘束される。
--      進捗を持たせ、他の作業と並行できるようにする（R53）。
--      ★タブを閉じた場合に「何ページまで終わったか＋その結果」を残しておき、
--        次に開いた時に残りから続けられるようにするためのテーブルを足す。
--        （ブラウザを閉じてもサーバー側で完走させる案は Edge Function の実行時間制限で
--          ワーカー新設が必要なため今回は採らない ＝ R56 として保留）
--
--  Notion: R51 3ad0ff81c56b81a8932ae87b0462ab3e / R52 3ad0ff81c56b8142a64ce2e09e9b2114
--          R53 3ad0ff81c56b81288cbfdba074e0307e
--
--  admin(authenticated)からのみ使うためRLS有効・account_idスコープ（purchase_orders方式）。
-- ============================================================

-- ── R52: 名前が決まる前の見積（下書き）───────────────────────
--  既存行は false（＝すべて確定済み扱い）。名前を確定した時点で false に落とす。
alter table estimate_projects add column if not exists is_draft boolean not null default false;
create index if not exists est_projects_draft_idx on estimate_projects(account_id, is_draft);

-- ── R53: 図面の材料抽出ジョブ（中断・再開できるようにする）──────
create table if not exists estimate_drawing_extract_jobs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references accounts(id),
  project_id     uuid not null references estimate_projects(id) on delete cascade,
  -- 対象の添付図面。図面が消えたらジョブも消えて良い（結果の使い道が無くなる）。
  attachment_id  uuid not null references estimate_project_attachments(id) on delete cascade,
  source_name    text,                                  -- 開始時点の元ファイル名（後から辿れるように控える）
  total_pages    integer not null default 0,
  done_pages     integer not null default 0,            -- ★ここまで解析済み。再開はこの次のページから
  -- running: 解析中 / paused: 中断（タブを閉じた等）/ done: 完走 / error: 失敗
  status         text not null default 'running',
  -- 抽出結果。ページ単位で積む（明細に入れるかは人が選ぶので、ここでは素の読み取り結果）
  rows           jsonb not null default '[]'::jsonb,
  error          text,
  -- 完了をナビのバッジで知らせる。人が結果を見たら acked_at を入れてバッジから落とす。
  acked_at       timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- 1つの図面につきジョブは1本（やり直しは同じ行を上書きして使う）
create unique index if not exists est_dext_job_att_uniq on estimate_drawing_extract_jobs(attachment_id);
create index if not exists est_dext_job_account_idx on estimate_drawing_extract_jobs(account_id, status);
create index if not exists est_dext_job_project_idx on estimate_drawing_extract_jobs(project_id);

alter table estimate_drawing_extract_jobs enable row level security;
revoke all on estimate_drawing_extract_jobs from anon;
grant select, insert, update, delete on estimate_drawing_extract_jobs to authenticated;

drop policy if exists est_dext_job_sel on estimate_drawing_extract_jobs;
create policy est_dext_job_sel on estimate_drawing_extract_jobs for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_dext_job_ins on estimate_drawing_extract_jobs;
create policy est_dext_job_ins on estimate_drawing_extract_jobs for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_dext_job_upd on estimate_drawing_extract_jobs;
create policy est_dext_job_upd on estimate_drawing_extract_jobs for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_dext_job_del on estimate_drawing_extract_jobs;
create policy est_dext_job_del on estimate_drawing_extract_jobs for delete to authenticated
  using (account_id = (select public.current_account_id()));
