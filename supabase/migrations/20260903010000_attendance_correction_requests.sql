-- ============================================================
--  20260903010000_attendance_correction_requests.sql
--  出退勤の打刻を「本人が修正申請 → 管理者が承認」で直せるようにする
--
--  ★なぜ必要か（2026-09-03 大須賀さん / LINE「出退勤の打刻間違え打った為修正できますか」）:
--   打刻を直す導線が1つも無かった。EF は punch（挿入のみ・時刻はサーバが決める）と
--   backdate（打ち忘れた日の後追い入力のみ・同じ種別が既にあると409）だけで、
--   管理画面の勤怠は閲覧専用。つまり誰も直せなかった。
--
--  ★実データで起きたのは単発ミスではなく「連鎖」:
--    9/1 朝の出勤を打ち忘れ → 17:58 に退勤しようとしたら画面が「出勤」を出し、押して出勤が記録
--    → 以降アプリは「出勤中」と判断 → 翌朝 8:05 の出勤も「退勤」として記録された。
--   打刻の種別は「直近20時間の最後の打刻」だけで決まるので、1回ずれると後続が全部ずれる。
--
--  ★設計（2026-09-03 ユーザー確定）:
--   本人が申請し、管理者が承認して初めて反映する。打刻は勤怠の証跡なので
--   本人が自由に書き換えられるようにはしない（時刻をサーバが決めている理由と同じ）。
--   承認の作りは overtime_requests（残業申請）に揃える＝自己承認禁止・二重決裁防止。
--
--  ★打刻は物理削除しない。
--   誤打刻も「あった事実」なので消さず deleted_at で無効化し、直した場合は
--   元の値（original_type / original_checked_at）と誰がいつ直したかを残す。
--
--  ★追加のみ。既存の列・データ・挙動は触らない。
-- ============================================================

-- ── 打刻の修正申請 ────────────────────────────────────
create table if not exists public.attendance_correction_requests (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  -- 申請者＝その打刻の持ち主。代理では出させない（他人の勤怠を書き換える導線を開けない）
  worker_id    uuid not null references public.workers(id) on delete cascade,
  log_id       uuid not null references public.attendance_logs(id) on delete cascade,
  -- 何をどう直したいか。'type'=出勤/退勤の押し間違い / 'time'=時刻違い / 'delete'=余計な打刻
  kind         text not null check (kind in ('type', 'time', 'delete')),
  requested_type       text check (requested_type in ('checkin', 'checkout')),
  requested_checked_at timestamptz,
  reason       text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  approved_by  text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  -- kind ごとに必要な値が入っていることをDBでも担保する（EF側だけの検証にしない）
  constraint attendance_correction_kind_payload check (
    (kind = 'type'   and requested_type is not null) or
    (kind = 'time'   and requested_checked_at is not null) or
    (kind = 'delete')
  )
);

comment on table public.attendance_correction_requests is
  '打刻の修正申請。本人が出し、管理者が承認して初めて attendance_logs に反映する。'
  ' 打刻は勤怠の証跡なので本人が直接書き換えられるようにはしない（2026-09-03）。';

create index if not exists attendance_correction_pending_idx
  on public.attendance_correction_requests (account_id, status, requested_at desc);
create index if not exists attendance_correction_log_idx
  on public.attendance_correction_requests (log_id);

-- ★1つの打刻に pending を2件作らせない（連打・二重申請で承認キューが荒れる）
create unique index if not exists attendance_correction_one_pending_per_log
  on public.attendance_correction_requests (log_id) where status = 'pending';

-- ── 打刻側の監査列 ────────────────────────────────────
alter table public.attendance_logs
  add column if not exists original_type       text,
  add column if not exists original_checked_at timestamptz,
  add column if not exists corrected_at        timestamptz,
  add column if not exists corrected_by        text,
  add column if not exists deleted_at          timestamptz;

comment on column public.attendance_logs.original_type is
  '修正前の種別。修正していない打刻は null。';
comment on column public.attendance_logs.original_checked_at is
  '修正前の打刻時刻。修正していない打刻は null。';
comment on column public.attendance_logs.corrected_by is
  '誰が直したか（承認者名）。クライアントからは受け取らず検証済みの身元から引く。';
comment on column public.attendance_logs.deleted_at is
  '論理削除。誤打刻も「あった事実」なので物理削除しない。'
  ' ★読み出し側は必ず deleted_at is null で絞ること（集計・出勤打刻なし判定・直近ログ）。';

-- 集計・直近ログの取得は「生きている打刻」だけを見る。部分indexで効かせる
create index if not exists attendance_logs_alive_idx
  on public.attendance_logs (worker_id, checked_at desc) where deleted_at is null;

-- ── 権限 ──────────────────────────────────────────────
--  ★書きは EF(service_role) 経由のみ。anon はもちろん authenticated にも書かせない
--   （承認を経ずに勤怠を書き換えられると証跡にならない）。
alter table public.attendance_correction_requests enable row level security;
revoke all on public.attendance_correction_requests from anon;
revoke insert, update, delete on public.attendance_correction_requests from authenticated;

-- 管理画面が承認キューを読むぶんだけ許す（自テナントのみ）
drop policy if exists attendance_correction_select_own_account on public.attendance_correction_requests;
create policy attendance_correction_select_own_account
  on public.attendance_correction_requests for select to authenticated
  using (
    account_id in (
      select w.account_id from public.workers w
      where w.auth_user_id = auth.uid()
      union
      select a.id from public.accounts a
      where a.owner_auth_user_id = auth.uid()
    )
  );
