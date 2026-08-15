-- ============================================================
--  20260815040000_attendance_anon_lockdown.sql
--  出退勤ログから anon の読み書きを完全に外す（EF経由に一本化）
--  Notion: 出退勤ログの読み書きをEdge Function経由にする（anonの全件読み取り・打刻偽造を塞ぐ）
--
--  ★背景（2026-08-11 発覚 → 2026-08-15 恒久対応）:
--   本番の attendance_logs が公開 anon キーだけで全テナント分読めていた。
--   anon キーは LIFF の JS に埋め込まれて配信されるため、サイトを開けば誰でも入手できる。
--   応急処置で GPS 等の列は外し INSERT も now()±10分に縛ったが、
--     ① anon は依然として「誰が・いつ・どの現場で」打刻したかを全テナント分読める
--     ② anon キーがあれば（今この瞬間の分は）打刻を捏造できる
--   が残っていた。anon には身元が無いのでRLSでは絞れない。
--   打刻画面の読み書きを EF `attendance-log`（service_role・身元検証あり）に移したので、
--   ここで anon の権限自体を落とす。
--
--  ★★適用の順序が重要（先に当てると本番が壊れる）★★
--   本番の LIFF は main ビルドで動いており、EF化前のコードは anon で直読みしている。
--   このマイグレーションを先に当てると、現行の打刻画面が即座に動かなくなる。
--   必ず「LIFF を本番デプロイしてから」当てること。
--     1. main にマージ → Vercel が LIFF を本番デプロイ
--     2. supabase functions deploy attendance-log --no-verify-jwt
--     3. このマイグレーションを適用
--   逆順にしないこと。
--
--  ★admin（authenticated）は従来どおりテーブルを直接読む。
--   出退勤ログ画面・日報一覧の突き合わせがこれに依存しており、
--   attendance_select_tenant で自テナントに絞られている。ここは触らない。
-- ============================================================

-- anon は一切触れない。読み取りも登録も EF 経由に一本化する。
revoke all on attendance_logs from anon;

drop policy if exists attendance_select_anon on attendance_logs;

-- INSERT ポリシーも anon 向けの緩和は不要になる。authenticated（admin が代理で入れる
-- 経路は今のところ無い）に限定し、EF は service_role なので RLS を通らない。
--  ★ポリシー自体は残す。将来 authenticated から入れたくなった時に、
--   「今この瞬間・自テナント内」という縛りが効いたままであってほしい。
drop policy if exists attendance_insert_guarded on attendance_logs;
create policy attendance_insert_guarded on attendance_logs for insert to authenticated
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

comment on table attendance_logs is
  '出退勤の打刻ログ（追記専用・UPDATE/DELETE禁止）。'
  ' 読み書きは Edge Function attendance-log 経由（anon は権限なし）。admin は authenticated で自テナントのみ参照可。';

-- ── ロールバック手順 ────────────────────────────────
--   grant select (id, worker_id, site_id, type, checked_at) on attendance_logs to anon;
--   grant insert on attendance_logs to anon;
--   create policy attendance_select_anon on attendance_logs for select to anon using (true);
--   （anon直読みに戻す＝2026-08-11 の穴が半分開く。EFを止める時以外は戻さないこと。）
