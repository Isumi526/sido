-- ============================================================
--  20260816010000_daily_reports_rls.sql
--  日報にRLSを入れ、anon/authenticated の書き込みを止める
--  Notion: 【P0・権限】daily_reports が RLS 無効 × authenticated 全権限
--
--  ★2026-08-15 に実証した穴:
--   daily_reports は RLS 無効かつ anon/authenticated に権限が開いていた。
--     - 本番（読み取りのみ）: demo テナントのJWTで絞り込み無しに SELECT すると
--       **4テナント分・全2,827件**が読めた。日付・現場・作業員名・稼働時間・経費まで丸ごと
--     - ローカル（本番と同一の権限状態）: 別テナントのJWTで PATCH が204、
--       DELETE が204で **行が実際に消えた**
--   ＝他社の日報を読める・書き換えられる・消せる状態だった。
--
--  ★LIFF の読み書きは Edge Function へ全部移した（2026-08-15〜16）:
--   - 読み取り8本 … daily-reports-read（dates/list/one/expense）
--   - 保存1本     … save-daily-report（期限内の通常提出）
--   - 過去日の編集・期限切れ提出 … report-edit-log（従来どおり承認制）
--   いずれも身元をサーバ側で検証し、自分と worker_proxies の代理対象だけを扱う。
--   `grep "from('daily_reports')" apps/liff` は0件（コメントを除く）。
--
--  ★admin は authenticated。SELECT は自テナントに絞るポリシーで残す
--   （集計・承認・出面勤怠など15ファイルが読む）。書き込みは EF 経由に一本化。
--
--  ★★適用の順序（先に当てると本番の日報送信が止まる）★★
--     1. main にマージ → Vercel が LIFF/admin を本番デプロイ
--     2. CI が save-daily-report / daily-reports-read をデプロイ
--     3. **配信中のバンドルに新コードが入っていることを実測してから** このマイグレーションを適用
--   2026-08-15 に sites / overtime_requests で同じ順序を踏んでおり、
--   いずれも配信物を実際に取得して確認してから当てている。
-- ============================================================

alter table public.daily_reports enable row level security;

-- 自テナントのみ読める。current_account_id() は JWT の app_metadata.account_slug から
-- アカウントを引く既存のヘルパ（overtime_requests / purchase_orders と同じ形）。
drop policy if exists daily_reports_sel on public.daily_reports;
create policy daily_reports_sel on public.daily_reports
  for select to authenticated
  using (account_id = (select current_account_id()));

-- ★書き込みポリシーは作らない＝authenticated からの INSERT/UPDATE/DELETE は通らない。
--  service_role（EF）は RLS を跨ぐので影響しない。
revoke insert, update, delete on public.daily_reports from authenticated;

-- ★anon は列単位の付与が残っている場合があるので、列ごとに剥がしてから表単位でも剥がす。
--  REVOKE ALL ON <table> は列単位の付与を消さない（2026-08-15 に workers で踏んだ）。
do $$
declare c record;
begin
  for c in
    select a.attname from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'daily_reports'
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke all (%I) on public.daily_reports from anon', c.attname);
  end loop;
end $$;
revoke all on public.daily_reports from anon;

comment on table public.daily_reports is
  '日報。読み書きは Edge Function 経由'
  '（読み=daily-reports-read / 保存=save-daily-report / 編集・期限切れ提出=report-edit-log）。'
  ' anon は権限なし。authenticated は自テナントの SELECT のみ（RLS）。'
  ' ★クライアントから直接 upsert しないこと——2026-08-15 に他テナントの日報を'
  ' 読み書き・削除できる穴になっていた。';

-- ── ロールバック手順 ────────────────────────────────
--   grant insert, update, delete on public.daily_reports to authenticated;
--   grant select, insert, update, delete on public.daily_reports to anon;
--   alter table public.daily_reports disable row level security;
--   （他テナントの日報を読める・書き換えられる・消せる状態に戻る。戻さないこと。）
