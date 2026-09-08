-- ============================================================
--  20260908020000_site_owner_rls_step2_lists.sql
--  「現場管理者の所有権モデル」Step2-2: 4画面のリスト絞り込み（RLS）
--
--  ★背景: 2026-07-31 ユーザー方針。Q1〜Q4は回答済み（Notionチケット参照）。
--   Step1（20260903100000）で sites の UPDATE を所有軸で絞った。こちらは
--   「現場管理者には自分が責任者の現場を含む日報/申請だけ見せる」を
--   SELECT ポリシーで担保する。画面で絞ってもAPIを直接叩けば全件取れるため。
--
--  ★対象画面: reports.vue / report-edit-approvals.vue / overtime-approvals.vue
--            / site-reports.vue（いずれも下の3テーブルを読む）
--
--  ★確定済みの判断（再質問しない）
--   Q1 = A: 責任現場を1つでも含むなら、その日報を丸ごと見せる（按分しない）
--   Q2 = A: 現場未設定の日報は現場管理者に見せない（オーナー・役員のみ）
--
--  ★★blast radius を最小にするための設計方針
--   「site_manager のときだけ絞る」。それ以外のロール（admin/owner/office/worker）は
--   USING句が true に短絡して従来どおり全件見える＝挙動を一切変えない。
--   owner/admin/office の閲覧を壊すと全社の日報が見えなくなるため、
--   絞る対象をロールで明示的に限定する（「全員に条件を課して例外を足す」形にしない）。
--
--   短絡はSECURITY DEFINER関数の中で行う。ポリシー式に直接 jsonb_array_elements を
--   書くと、admin/office でも行ごとにJSONB展開が走ってコストになるため。
--
--  ★自分のものは常に見える
--   site_manager 本人が出した日報・残業申請・編集申請は、現場が他人のものでも見える。
--   これが無いと自分のLIFF履歴や申請状況が見えなくなる（現場が止まる）。
--
--  ★非稼働（休み）の日報の扱い＝見せない側に倒す（本番実測にもとづく明示的判断）
--   本番の直近3ヶ月で site_id を1つも持たない日報は 968件。うち 797件が
--   is_working=false（休み）、56件が leave_type あり、26件が現場ブロック0。
--   ＝「稼働しているのに現場未設定」は 171件（全体の約6%）にとどまる。
--   休みの日報は現場に紐づかないため所有軸では拾えず、Q2 の「現場未設定は
--   現場管理者に見せない」に従って**見えなくなる**。Q3 の「必要になったら緩める方が安全」
--   と同じ保守側の倒し方。運用上「誰が休みか」を現場管理者にも見せたくなったら、
--   is_working=false を無条件許可に足す（1行の緩和・可逆）。
--
--  ★ALTER POLICY を使う（DROP+CREATE にしない）
--   DROP している間だけポリシーが消える瞬間を作らないため。既存ポリシー名・
--   対象ロール・コマンドは変えず、USING句だけ差し替える。
--   ロールバックは末尾のコメントのSQLで元のUSING句に戻すだけ（データ変更ゼロ）。
-- ============================================================

-- 呼び出し元の users.id（daily_reports.user_id / submitted_by_user_id と突き合わせる）。
--  users には auth_user_id が無く worker_id 経由で辿る（EF側 handleReview と同じ規則）。
create or replace function public.current_users_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from users u
  where u.account_id = public.current_account_id()
    and u.worker_id = public.current_worker_id()
  limit 1
$$;

-- 日報が「自分の現場」を含むか。Q1=1つでも含めば丸ごと可。
--  ★site_manager 以外は即 true（短絡）＝従来挙動。
create or replace function public.can_view_report_row(p_sites jsonb, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() is distinct from 'site_manager' then true
    when p_user_id is not null and p_user_id = public.current_users_id() then true   -- 自分の日報
    else exists (
      select 1
      from jsonb_array_elements(coalesce(p_sites, '[]'::jsonb)) e
      join sites s on s.id = (e->>'site_id')::uuid
      where e->>'site_id' is not null
        and s.responsible_worker_id = public.current_worker_id()
    )
  end
$$;

-- 残業申請が「自分の現場」のものか。
--  ★overtime_requests は site_id を持たず site_names(text[]) しか無いため名前で突き合わせる。
--   同名の現場が複数あって片方だけ自分の担当の場合、この判定は true になる（fail-open）。
--   承認フローは「自分の現場の申請が承認待ちに出てこない」方が事故が大きい（申請が詰まる）ため、
--   閲覧についてはこちら側に倒す。書き込み（承認）は EF の resolveApprover が別途検査する。
create or replace function public.can_view_overtime_row(p_worker_id uuid, p_site_names text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() is distinct from 'site_manager' then true
    when p_worker_id is not null and p_worker_id = public.current_worker_id() then true  -- 自分の申請
    else exists (
      select 1 from sites s
      where s.account_id = public.current_account_id()
        and s.responsible_worker_id = public.current_worker_id()
        and s.name = any(coalesce(p_site_names, array[]::text[]))
    )
  end
$$;

-- 日報編集の申請が「自分の現場」のものか。元の日報(report_id)の sites を見る。
--  ★daily_reports 自体にも RLS があるが、この関数は security definer なので
--   所有者権限で評価される＝ポリシー同士の再帰にならない。
create or replace function public.can_view_pending_edit_row(p_report_id uuid, p_submitted_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_role() is distinct from 'site_manager' then true
    when p_submitted_by is not null and p_submitted_by = public.current_users_id() then true  -- 自分の申請
    else exists (
      select 1
      from daily_reports dr
      join lateral jsonb_array_elements(coalesce(dr.sites, '[]'::jsonb)) e on true
      join sites s on s.id = (e->>'site_id')::uuid
      where dr.id = p_report_id
        and e->>'site_id' is not null
        and s.responsible_worker_id = public.current_worker_id()
    )
  end
$$;

-- ---------- ポリシーの差し替え（USING句のみ） ----------

alter policy daily_reports_sel on public.daily_reports
  using (
    account_id = (select public.current_account_id())
    and public.can_view_report_row(sites, user_id)
  );

alter policy overtime_requests_sel on public.overtime_requests
  using (
    account_id = (select public.current_account_id())
    and public.can_view_overtime_row(worker_id, site_names)
  );

alter policy drpe_sel on public.daily_report_pending_edits
  using (
    account_id = (select public.current_account_id())
    and public.can_view_pending_edit_row(report_id, submitted_by_user_id)
  );

-- ---------- ロールバック（必要時・データ変更ゼロ） ----------
-- alter policy daily_reports_sel on public.daily_reports
--   using (account_id = (select public.current_account_id()));
-- alter policy overtime_requests_sel on public.overtime_requests
--   using (account_id = (select public.current_account_id()));
-- alter policy drpe_sel on public.daily_report_pending_edits
--   using (account_id = (select public.current_account_id()));
-- （関数は残しても無害。消すなら drop function ... current_users_id/can_view_report_row/
--   can_view_overtime_row/can_view_pending_edit_row）
