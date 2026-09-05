-- ============================================================
--  20260903060000_worker_consents.sql
--  作業員登録（初回ログイン）時に、個人データの外国（韓国）移転を含む同意を取り、
--  履歴として残す
--
--  ★背景（2026-09-01 弁護士打合せ）:
--   契約書第9条・第10条4項で、利用会社（乙）が自社の従業員・協力会社の社員の
--   情報を登録する前に本人同意を取る義務が規定された（外国＝大韓民国にある
--   第三者への個人データ提供への同意を含む）。同意を取れる仕組みが無いと
--   利用会社が契約上の義務を履行できない（第17条：同意欠如時は利用会社が
--   自己負担で解決し当社の損害も補償する建て付け）。
--
--  ★同意文は法務レビュー前提で先行実装する（本文の指示どおり）。
--   文面が変わっても「過去の同意が何に対するものだったか」を追えるよう、
--   バージョン番号だけでなく同意時点の文面そのものも保存する
--   （attendance_logs.agreed_rule_texts と同じ考え方＝スナップショットを残す）。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。
-- ============================================================

create table if not exists public.worker_consents (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  worker_id     uuid not null references public.workers(id) on delete cascade,
  consent_version integer not null,
  consent_text  text not null,
  consented_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.worker_consents is
  '作業員の個人データ取扱い（外国＝韓国への移転を含む）への同意履歴。'
  ' 初回ログイン時に取得。文面が変わっても過去の同意内容を追えるよう'
  ' consent_text にその時点の文面をスナップショットで残す（削除・更新しないこと）。';

-- 同じバージョンへの重複同意は不要（最新版に同意済みかを1行の有無で判定できるように）
create unique index if not exists worker_consents_worker_version_uniq
  on public.worker_consents (worker_id, consent_version);

create index if not exists worker_consents_account_idx
  on public.worker_consents (account_id, worker_id);

-- ── 権限 ──────────────────────────────────────────────
--  ★書きは EF(service_role) 経由のみ。LINE作業員はSupabase JWTを持たないため
--   authenticated 書込があっても使えないが、authenticated にも書かせない
--   （同意の記録は「本人が実際に画面で確認して押した」ことをサーバ側で検証してから
--    書くべきで、クライアント直書きにすると押していない同意を偽装できてしまう）。
alter table public.worker_consents enable row level security;
revoke all on public.worker_consents from anon;
revoke insert, update, delete on public.worker_consents from authenticated;

-- 管理画面が同意状況を読むぶんだけ許す（自テナントのみ）
drop policy if exists worker_consents_select_own_account on public.worker_consents;
create policy worker_consents_select_own_account
  on public.worker_consents for select to authenticated
  using (account_id = (select public.current_account_id()));
