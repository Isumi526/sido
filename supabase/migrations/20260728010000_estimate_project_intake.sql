-- ============================================================
--  supabase/migrations/20260728010000
--  見積: 元請けからの案件受領登録・ステータス管理（Q5）
--
--  背景: 元請けから見積依頼を受けた時点で案件を登録し、提出期限や進捗を管理したい
--   （2026-07-27 認識合わせ 確認2の追加要望・確認16で項目合意）。
--   業務フロー: 7/1 元請けから依頼受領 → 7/1-3 下請へ図面配布 → 7/14 見積回収
--               → 7/14-17 整理・検討 → 7/17 元請けへ提出 → 受注確定 → 現場へ昇華
--
--  Notion: 見積Q5 3aa0ff81c56b81f99bb2cdccdeee9399
--  設計根拠: docs/spec/見積機能_業務フロー認識合わせ_20260727.md §1
--
--  追加のみDDL（後方互換・既存データに影響なし）
-- ============================================================

-- ── 受領時に登録する情報 ──
alter table estimate_projects add column if not exists request_date date;   -- 元請けからの依頼日
alter table estimate_projects add column if not exists due_date     date;   -- 元請けへの提出期限
-- 失注/辞退の理由（確認9: アーカイブして単価の参考データとして残す・理由も残す）
alter table estimate_projects add column if not exists lost_reason  text;

-- ── 図面などの添付（site_attachments と同型）──
--  受領時に元請けから受け取る図面。Q7（図面凡例からの数量取込）でも使う。
create table if not exists estimate_project_attachments (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id),
  project_id  uuid not null references estimate_projects(id) on delete cascade,
  kind        text,                       -- 'drawing' | 'other' 等
  path        text not null,              -- storage 上のパス
  name        text,                       -- 元のファイル名
  created_at  timestamptz not null default now()
);
create index if not exists est_proj_att_account_idx on estimate_project_attachments(account_id);
create index if not exists est_proj_att_project_idx on estimate_project_attachments(project_id);

-- ★RLS: admin(authenticated)からしか使わないテーブルなので、purchase_orders と同じく
--  最初からRLSを有効にして account_id スコープで閉じる。anon には権限を渡さない。
--  （見積系の既存テーブルは anon 運用の pre-RLS ベースラインだが、新規テーブルを
--   その負債に合わせる理由はない。rls-audit の ratchet 基準でも新規のRLS無効×anon表は
--   違反として計上される＝実際に🔴LEAKで検知されたため本方式に変更した）
alter table estimate_project_attachments enable row level security;
revoke all on estimate_project_attachments from anon;
grant select, insert, update, delete on estimate_project_attachments to authenticated;

drop policy if exists est_proj_att_sel on estimate_project_attachments;
create policy est_proj_att_sel on estimate_project_attachments for select to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_proj_att_ins on estimate_project_attachments;
create policy est_proj_att_ins on estimate_project_attachments for insert to authenticated
  with check (account_id = (select public.current_account_id()));
drop policy if exists est_proj_att_upd on estimate_project_attachments;
create policy est_proj_att_upd on estimate_project_attachments for update to authenticated
  using (account_id = (select public.current_account_id()));
drop policy if exists est_proj_att_del on estimate_project_attachments;
create policy est_proj_att_del on estimate_project_attachments for delete to authenticated
  using (account_id = (select public.current_account_id()));

-- ── 図面用のストレージバケット（非公開）──
insert into storage.buckets (id, name, public)
values ('estimate-drawings', 'estimate-drawings', false)
on conflict (id) do nothing;

-- ── storage ポリシー（drawing-source-pdfs と同型）──
--  パスの先頭フォルダを account_id にして、認証ユーザーが自テナント配下のみ操作できるようにする。
--  ※これが無いと insert が RLS で弾かれる（E2Eで検出）。
drop policy if exists estimate_drawings_insert on storage.objects;
create policy estimate_drawings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'estimate-drawings' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists estimate_drawings_select on storage.objects;
create policy estimate_drawings_select on storage.objects for select to authenticated
  using (bucket_id = 'estimate-drawings' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists estimate_drawings_update on storage.objects;
create policy estimate_drawings_update on storage.objects for update to authenticated
  using (bucket_id = 'estimate-drawings' and (storage.foldername(name))[1] = (select public.current_account_id())::text);

drop policy if exists estimate_drawings_delete on storage.objects;
create policy estimate_drawings_delete on storage.objects for delete to authenticated
  using (bucket_id = 'estimate-drawings' and (storage.foldername(name))[1] = (select public.current_account_id())::text);
