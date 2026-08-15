-- ============================================================
--  20260815030000_attendance_hotfix_codify.sql
--  2026-08-11 に本番へ直接当てた出退勤ログの応急処置を、マイグレーションに落とす
--  Notion: 出退勤ログの読み書きをEdge Function経由にする（anonの全件読み取り・打刻偽造を塞ぐ）
--
--  ★なぜ今これを書くのか:
--   応急処置は本番にだけ手で当たっていて、ローカル・新規cloneには入っていなかった。
--   そのせいで「ローカルでは通るのに本番では弾かれる」機能を実際に作ってしまった
--   （打刻の遡り入力。本番の INSERT ポリシーが checked_at を now()±10分に縛っているため
--    過去日時の打刻が入らない。2026-08-15 に発覚）。
--   本番にだけ在る制約は、いずれ必ずこの形で事故になる。差分をコードに戻す。
--
--  ★このファイルは「本番の現状に合わせる」だけで、新しい制限は足さない。
--   anon の締め出し（AC3）は 20260815040000 で別に行う（アプリのデプロイ順があるため）。
--
--  冪等。本番では既に同じ状態なので何も変わらない（差し替えのみ）。
-- ============================================================

-- ── SELECT: authenticated は自テナントのみ／anon は行では絞れないので素通し ──
--  anon に身元が無い以上RLSでは絞れない。列権限で GPS・同意文面を外して被害を狭めてある。
--  恒久対応は読み取りのEF化（次のマイグレーションでanonのSELECT自体を落とす）。
drop policy if exists allow_select_logs on attendance_logs;
drop policy if exists admin_read_all_logs on attendance_logs;
drop policy if exists workers_read_own_logs on attendance_logs;

drop policy if exists attendance_select_tenant on attendance_logs;
create policy attendance_select_tenant on attendance_logs for select to authenticated
  using (exists (
    select 1 from workers w
    where w.id = attendance_logs.worker_id
      and w.account_id = (select public.current_account_id())
  ));

drop policy if exists attendance_select_anon on attendance_logs;
create policy attendance_select_anon on attendance_logs for select to anon
  using (true);

-- ── INSERT: 捏造できる範囲を「今この瞬間・自テナント内の実在する組み合わせ」に狭める ──
--  ★checked_at を now()±10分に縛っているのが肝。これが無いと anonキーだけで
--   1週間前の勤怠を後付けで作れた（人件費の証跡の偽造）。
--  ★この制約があるため、意図的に過去日時を入れる機能（打刻の遡り入力）は
--   anon から直接 INSERT できない。EF（service_role）経由にする必要がある。
drop policy if exists anyone_insert_logs on attendance_logs;
drop policy if exists attendance_insert_guarded on attendance_logs;
create policy attendance_insert_guarded on attendance_logs for insert
  with check (
    checked_at >= now() - interval '10 minutes'
    and checked_at <= now() + interval '10 minutes'
    and exists (
      select 1 from workers w
      join sites s on s.id = attendance_logs.site_id
      where w.id = attendance_logs.worker_id
        and s.account_id = w.account_id
    )
  );

-- ── 過剰権限の整理（TRUNCATE は RLS の対象外なので特に危険だった）──
revoke update, delete, truncate on attendance_logs from anon;
revoke truncate on attendance_logs from authenticated;

-- ── anon の列権限を最小化（GPS・同意文面・書類名を読ませない）──
--  ★revoke してから必要な列だけ grant し直す。列単位の grant は積み上がるため、
--   一度落とさないと過去に付いた列が残る。
revoke select on attendance_logs from anon;
grant select (id, worker_id, site_id, type, checked_at) on attendance_logs to anon;

-- ── ロールバック手順 ────────────────────────────────
--   2026-08-11 以前（全面素通し）に戻すことは推奨しない。戻す場合は
--   create policy allow_select_logs on attendance_logs for select using (true);
--   create policy anyone_insert_logs on attendance_logs for insert with check (true);
--   grant select on attendance_logs to anon;
