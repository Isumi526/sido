-- ============================================================
--  20260827020000_site_document_consents.sql
--  送り出し資料の承認ログ（2026-08-19 打合せ・出退勤モデル変更のC）
--
--  ★なぜ要るか:
--   これまで「送り出し資料に同意した」証跡は attendance_logs.agreed_document_names
--   （資料"名"の配列）にしか無かった。出退勤モデルの変更で資料の確認を打刻から切り離す
--   と、この証跡の置き場が消える。かつ名前の配列では「どの資料か」を一意に特定できず
--   （改名・同名別ファイルを区別できない）、法的な確認記録としては弱い。
--   attachment_id で特定し、誰が・いつ・どの資料（の名前スナップショット）に同意したかを残す。
--
--  ★対象者は「現場に参加している作業員」＝ site_shares（現場×ユーザー）＋
--   sites.responsible_worker_id（現場責任者）。useMySiteIds と同じ定義を EF 側で使う。
--
--  追加のみ（非破壊）。既存の attendance_logs.agreed_document_names は消さない
--  （過去の証跡なので残す。新しい同意はこのテーブルに積む）。
-- ============================================================

create table if not exists site_document_consents (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  site_id       uuid not null references sites(id) on delete cascade,
  attachment_id uuid not null references site_attachments(id) on delete cascade,
  worker_id     uuid not null references workers(id) on delete cascade,
  -- ★資料名のスナップショット。あとで資料が改名・差し替えされても
  --  「その時なんという資料に同意したか」が残るようにする（agreed_rule_texts と同じ考え方）。
  document_name text,
  consented_at  timestamptz not null default now(),
  -- 同じ資料に同じ人が二重に同意しない（承認は1回で足りる）
  unique (attachment_id, worker_id)
);

create index if not exists sdc_site_idx     on site_document_consents (site_id);
create index if not exists sdc_worker_idx   on site_document_consents (worker_id);
create index if not exists sdc_account_idx  on site_document_consents (account_id);

comment on table site_document_consents is
  '送り出し資料の承認ログ（誰が・いつ・どの資料に同意したか）。2026-08-27 の出退勤モデル変更で'
  ' 打刻から切り離した現場特有ルール/書類の確認記録。attendance_logs.agreed_document_names の後継。';

-- ★追記専用。同意の記録は後から書き換えられてはいけない（証跡としての意味が消える）。
--  attendance_logs と同じ扱いにする（UPDATE/DELETE のポリシーを作らない＝拒否）。
alter table site_document_consents enable row level security;

drop policy if exists sdc_select_tenant on site_document_consents;
create policy sdc_select_tenant on site_document_consents for select to authenticated
  using (
    exists (
      select 1 from workers w
      where w.auth_user_id = auth.uid() and w.account_id = site_document_consents.account_id
    )
    or exists (
      select 1 from accounts a
      where a.id = site_document_consents.account_id and a.owner_auth_user_id = auth.uid()
    )
  );

-- anon（LIFF公開キー）には一切触らせない。読み書きは Edge Function 経由に一本化する
-- （attendance_logs と同じ方針。身元が無い anon では「本人の同意」を担保できない）。
revoke all on site_document_consents from anon;

-- ★authenticated は「読むだけ」。書き込みは service_role の Edge Function だけが行う。
--  RLS に INSERT/UPDATE/DELETE のポリシーを作っていないので実際には拒否されるが、
--  既定で付く write 権限を明示的に剥がしておく（意図＝追記専用をスキーマ側で示す）。
revoke insert, update, delete on site_document_consents from authenticated;
grant select on site_document_consents to authenticated;

-- ── ロールバック手順 ────────────────────────────────
--   drop table if exists site_document_consents;
