-- ============================================================
--  20260913100000_workers_guard_sensitive_columns.sql
--  【P0・権限】ログイン済みの作業員が自力でオーナーに昇格できる穴を塞ぐ
--
--  ★現象（2026-09-07 本番実測・2026-09-13 再確認）
--   workers は RLS 無効・authenticated に UPDATE(全列)/INSERT/DELETE/TRUNCATE が付与され、
--   permission_role を守るトリガーが無い。ログインさえ持っていれば
--     PATCH /rest/v1/workers?id=eq.<自分> {"permission_role":"admin"}
--   の1発で自分をオーナーにでき、以後は全社の賃金・原価・請求が読める。
--   これまでの権限制御（canManageUsers / canAssignRole / canManageAuthForRole /
--   ルートガード）は全部クライアントとEFの判定で、テーブル直書きを想定していない。
--   ★anon 経路は 2026-08-01 に封鎖済み。authenticated は一度も塞がれていなかった。
--
--  ★方式＝BEFORE トリガーで「機密列の変更」を呼び出し元のロールで拒否する（チケット案1）
--   - 追加のみDDL（CREATE FUNCTION / CREATE TRIGGER）。既存の正当な書き込み経路を壊さない:
--       admin 作業員マスタ（owner/admin/office が authenticated で直接 UPDATE/INSERT）
--       有休画面（hire_date / initial_used_leave_days / excluded_grant_dates）
--       Edge Function（service_role＝素通し）、migration/psql（postgres＝素通し）
--   - workers の RLS 有効化（本筋）は親エピック「本番DBのRLS有効化」で別途。
--   - 列単位 REVOKE は採らない（2026-08-15 に全列 revoke ループが INSERT/UPDATE の
--     列付与も消し、本番の新規登録が停止した事故がある）。
--
--  ★ロールの天井は apps/admin/src/lib/auth.ts と同じ:
--   owner/admin … 全部可
--   office      … 権限・ログイン列は宛先が worker / site_manager の時だけ可
--                 （canAssignRole / canManageAuthForRole と同じ。office が admin を
--                  作って乗っ取る2手を塞ぐ）。賃金・経費枠は可（経理）。
--   site_manager… 権限・ログイン・賃金・経費枠は不可。それ以外の列と、ログイン手段を
--                 持たない一般作業員行の INSERT は可（現場の受け入れ）。
--   worker      … 権限・ログイン・賃金・経費枠は不可。INSERT/DELETE 不可。
--   別テナントの行は誰も触れない（current_account_id() と行の account_id が一致すること）。
--
--  ★TRUNCATE は行トリガーを通らないので anon/authenticated から剥奪する（1文・データ影響なし）。
-- ============================================================

create or replace function public.workers_guard_sensitive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role    text := auth.role();          -- 'anon' | 'authenticated' | 'service_role' | null(postgres)
  caller      text;
  caller_acct uuid;
  row_acct    uuid := coalesce(NEW.account_id, OLD.account_id);
  role_old    text;
  role_new    text;
  wage_changed boolean;
begin
  -- Edge Function（service_role）と migration/psql（JWT無し）は素通し
  if jwt_role is null or jwt_role = 'service_role' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;
  -- anon: 2026-08-01 の封鎖で列付与は name/role/unit_price/active/account_id の INSERT だけが残る
  -- （LINE自己登録 register.vue 用。/register は 2026-09-08 に廃止済みだが本番の付与は残っている）。
  -- 権限・ログインを持たない一般作業員行の INSERT だけ通し、それ以外は拒否する。
  if jwt_role = 'anon' then
    if TG_OP = 'INSERT' and coalesce(NEW.permission_role, 'worker') = 'worker'
       and NEW.auth_user_id is null and NEW.login_id is null then
      return NEW;
    end if;
    raise exception 'workers: write not allowed for anon' using errcode = '42501';
  end if;
  if jwt_role <> 'authenticated' then
    raise exception 'workers: write not allowed for role %', jwt_role using errcode = '42501';
  end if;

  caller      := public.current_role();       -- owner/admin/office/site_manager/worker（無ければ worker）
  caller_acct := public.current_account_id();
  if caller_acct is null or row_acct is null or caller_acct <> row_acct then
    raise exception 'workers: cross-tenant write denied' using errcode = '42501';
  end if;

  if TG_OP = 'DELETE' then
    if caller in ('owner', 'admin', 'office') then return OLD; end if;
    raise exception 'workers: % cannot delete workers', caller using errcode = '42501';
  end if;

  role_new := coalesce(NEW.permission_role, 'worker');

  if TG_OP = 'INSERT' then
    if caller in ('owner', 'admin') then return NEW; end if;
    if caller = 'office' then
      if role_new in ('worker', 'site_manager') then return NEW; end if;
      raise exception 'workers: office cannot create a % worker', role_new using errcode = '42501';
    end if;
    if caller = 'site_manager'
       and role_new = 'worker'
       and NEW.auth_user_id is null and NEW.login_id is null
       and NEW.daily_wage is null and NEW.hourly_wage is null and NEW.unit_price is null
       and coalesce(NEW.can_apply_personal_expense, false) = false
       and NEW.default_monthly_expense_limit is null then
      return NEW;
    end if;
    raise exception 'workers: % cannot create this worker', caller using errcode = '42501';
  end if;

  -- UPDATE
  if caller in ('owner', 'admin') then return NEW; end if;
  role_old := coalesce(OLD.permission_role, 'worker');

  if NEW.account_id is distinct from OLD.account_id then
    raise exception 'workers: account_id cannot be changed' using errcode = '42501';
  end if;

  -- 権限・ログイン列（昇格・乗っ取り経路）
  if NEW.permission_role is distinct from OLD.permission_role
     or NEW.auth_user_id is distinct from OLD.auth_user_id
     or NEW.login_id is distinct from OLD.login_id then
    if caller = 'office' and role_old in ('worker', 'site_manager') and role_new in ('worker', 'site_manager') then
      null;  -- canAssignRole / canManageAuthForRole と同じ天井
    else
      raise exception 'workers: % cannot change role/login of a % worker', caller, role_old using errcode = '42501';
    end if;
  end if;

  -- 賃金・経費枠列（経理＝office までは可）
  wage_changed := (NEW.daily_wage, NEW.hourly_wage, NEW.unit_price, NEW.wage_type,
                   NEW.can_apply_personal_expense, NEW.default_monthly_expense_limit)
                  is distinct from
                  (OLD.daily_wage, OLD.hourly_wage, OLD.unit_price, OLD.wage_type,
                   OLD.can_apply_personal_expense, OLD.default_monthly_expense_limit);
  if wage_changed and caller <> 'office' then
    raise exception 'workers: % cannot change wage/expense columns', caller using errcode = '42501';
  end if;

  return NEW;
end
$$;

comment on function public.workers_guard_sensitive() is
  'workers の権限・ログイン・賃金列を呼び出し元ロールで守る BEFORE トリガー（2026-09-13 P0）。service_role/postgres は素通し。';

drop trigger if exists trg_workers_guard_sensitive on public.workers;
create trigger trg_workers_guard_sensitive
  before insert or update or delete on public.workers
  for each row execute function public.workers_guard_sensitive();

-- TRUNCATE は行トリガーを迂回するので剥奪（他の付与種別には触らない）
revoke truncate on public.workers from anon, authenticated;
