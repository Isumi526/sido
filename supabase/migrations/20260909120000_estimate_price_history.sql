-- ============================================================
--  20260909120000_estimate_price_history.sql
--  (1) 単価履歴ビューの匿名公開を塞ぐ  (2) 作業内容の名寄せ辞書を足す
--
--  ══ (1) セキュリティ修正（2026-09-09 実測で発覚）═══════════════
--  public.estimate_price_history は 2026-07-28 に作られたビューだが、
--   ・anon に SELECT が付いたまま
--   ・security_invoker が未設定＝**土台テーブルのRLSを迂回する**
--  ため、公開キー（クライアントJSに埋まっていて誰でも入手できる）だけで
--  **全テナントの下請け単価と業者名が読めた**。本番で実測:
--    GET /rest/v1/estimate_price_history → 200
--    {"item_name":"天井LGS下地組","unit_price":2300,"subcontractor_name":"…"}
--  業者ごとの単価は営業上の機密で、しかもこれから実データを溜める場所。
--
--  ★このビューを使うのは管理画面(authenticated)とE2E(service_role)だけで、
--   anon で叩く必要のある箇所は無い（grep 済み）。塞いでも壊れない。
--  ★security_invoker=on にすると呼び出し元のRLSが効く。土台の
--   estimate_quote_lines / _requests / estimate_projects には
--   authenticated 向けの SELECT ポリシーが既にあるため管理画面は従来どおり動く。
--   subcontractors はRLS無効だが、参照元が account 単位で絞られるため越境しない。
--
--  ══ (2) 名寄せ辞書 ═══════════════════════════════════════
--  同じ作業でも業者ごとに呼び方が違う（「天井下地」「天井LGS下地組」「天井下地組」）。
--  寄せないと候補が業者の言い回しの数だけ並び、候補機能そのものが使えなくなる。
--    「業者ごとに天井下地とか天井なんとか下地とか、若干語彙が違うから、そこの統一」
--    （大塚さん・2026-07-26 打ち合わせ②）
--  ★AIは候補を出すだけで、確定は必ず人。誤って寄せると金額が直接狂うため、
--   誰がいつ確定したかを残す。
--
--  ★単価履歴そのものは既存の estimate_price_history ビューで足りるので
--   新しいテーブルは作らない（基盤の二重化を避ける）。
--  ★追加のみ。既存の列・データは触らない。
-- ============================================================

-- ── (1) 匿名公開を塞ぐ ────────────────────────────────────
alter view public.estimate_price_history set (security_invoker = on);
revoke all on public.estimate_price_history from anon;

comment on view public.estimate_price_history is
  '作業内容×業者×提示日の単価履歴（estimate_quote_lines 由来）。'
  ' ★anon には出さない・security_invoker=on。2026-09-09 まで公開キーで'
  ' 全テナントの下請け単価が読める状態だったため塞いだ。戻さないこと。';

-- ── (2) 名寄せ辞書 ───────────────────────────────────────
create table if not exists public.estimate_name_aliases (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  -- 業者側の表記（「天井LGS下地組」）
  alias        text not null,
  -- 寄せ先の自社の正式名称（「天井 下地組」）
  work_name    text not null,
  -- ★誰がいつ確定したか。AIの推測をそのまま採らないための記録
  confirmed_by uuid references public.workers(id),
  confirmed_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.estimate_name_aliases is
  '業者ごとの表記ゆれを自社の正式名称へ寄せる辞書。単価候補の重複を防ぐ。'
  ' AIは候補を出すだけで確定は人が行う（誤って寄せると金額が直接狂うため）。';

create unique index if not exists estimate_name_aliases_uniq
  on public.estimate_name_aliases (account_id, alias);
create index if not exists estimate_name_aliases_work_idx
  on public.estimate_name_aliases (account_id, work_name);

alter table public.estimate_name_aliases enable row level security;
revoke all on public.estimate_name_aliases from anon;

drop policy if exists estimate_name_aliases_sel on public.estimate_name_aliases;
create policy estimate_name_aliases_sel
  on public.estimate_name_aliases for select to authenticated
  using (account_id = (select public.current_account_id()));

drop policy if exists estimate_name_aliases_ins on public.estimate_name_aliases;
create policy estimate_name_aliases_ins
  on public.estimate_name_aliases for insert to authenticated
  with check (account_id = (select public.current_account_id()));

drop policy if exists estimate_name_aliases_upd on public.estimate_name_aliases;
create policy estimate_name_aliases_upd
  on public.estimate_name_aliases for update to authenticated
  using (account_id = (select public.current_account_id()))
  with check (account_id = (select public.current_account_id()));

drop policy if exists estimate_name_aliases_del on public.estimate_name_aliases;
create policy estimate_name_aliases_del
  on public.estimate_name_aliases for delete to authenticated
  using (account_id = (select public.current_account_id()));
