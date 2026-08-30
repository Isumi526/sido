-- ============================================================
--  20260831010000_external_consents.sql
--  外部者（協力業者ポータル・チャット招待ゲスト）の規約同意を記録する（契約対応②）
--
--  ★なぜ要るか: 契約 別紙2§9 が「協力業者ポータル・チャット招待ゲストに同意文言を
--   表示・記録する機能を提供」と書いているのに未実装だった。契約と実態のズレを埋める。
--
--  ★方針（/ball 2026-08-30）: 仕組みを先に作り、文言は後入れ。
--   同意文言の本文はプレースホルダで始め、確定後にバージョン1として差し替える。
--   ACが「文言は差し替え可能・版管理」と定めているので、文言確定は仕組みの前提ではない。
--
--  ★記録するもの: 誰が・いつ・どの文言（バージョン）に同意したか。
--   「同意した」だけ残しても、後から文言を変えたときに何に同意したか分からなくなる。
--   文言そのものを控えとして焼き付ける（consented_text）。
--
--  ★追加のみ（非破壊）。
--   ロールバック:
--     drop table if exists external_consents;
--     delete from settings where key in ('external_terms_text','external_terms_version');
-- ============================================================

create table if not exists external_consents (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references accounts(id) on delete cascade,
  -- 誰が同意したか。外部者はログインを持たないので、識別できる情報を素直に持つ
  subject_kind   text not null check (subject_kind in ('subcontractor_portal', 'chat_guest')),
  subject_id     uuid,                       -- 協力業者ID／招待ID（分かる場合）
  subject_label  text,                       -- 表示名（業者名・招待された人の名前など）
  -- 何に同意したか。★版だけでなく文面そのものを控える（後から文言を変えても遡って分かる）
  terms_version  text not null,
  consented_text text not null,
  consented_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

comment on table external_consents is
  '外部者（協力業者ポータル・チャット招待ゲスト）の規約同意の記録（契約 別紙2§9・2026-08-31）。'
  ' 同意した版だけでなく、同意した時点の文面そのものを控える。文言を差し替えても'
  ' 過去に誰が何に同意したかを遡れるようにするため。';

create index if not exists external_consents_account_idx
  on external_consents (account_id, consented_at desc);
-- 同じ相手・同じ版で二重に積まない（再訪のたびに行が増えるのを防ぐ）
create unique index if not exists external_consents_unique_idx
  on external_consents (account_id, subject_kind, subject_id, terms_version)
  where subject_id is not null;

-- RLS: 自テナントの管理画面から読むだけ。書き込みは外部者の代わりにEF(service_role)が行う。
--  ★anonには一切開かない。同意記録は誰がどの業者かが分かる情報なので、
--   公開キーで一覧できてはいけない。
alter table external_consents enable row level security;

drop policy if exists external_consents_select on external_consents;
create policy external_consents_select on external_consents for select to authenticated
  using (account_id = (select current_account_id()));

revoke all on external_consents from anon;
grant select on external_consents to authenticated;

-- 同意文言（アカウント共通・管理者が差し替え可能）。
-- ★本文はプレースホルダ。弁護士・運用者の確認後に差し替える。
insert into settings (account_id, key, value, label)
select a.id, 'external_terms_version', '0', '外部者向け同意文言のバージョン'
from accounts a
on conflict do nothing;

insert into settings (account_id, key, value, label)
select a.id, 'external_terms_text',
  E'【仮の文言です。確定後に差し替えます】\n本サービスの利用にあたり、以下に同意いただく必要があります。\n・提供された情報は、発注・請求に関する業務の目的でのみ利用します。\n・個人情報は適切に管理し、目的外に利用しません。',
  '外部者向け同意文言'
from accounts a
on conflict do nothing;
