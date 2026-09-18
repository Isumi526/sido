-- ============================================================
--  20260918130000_inventory_category_and_ai_corrections.sql
--  在庫②：品目マスタを「区分→詳細」の2段にし、写真→AI品目候補の訂正履歴をテナント内で持つ
--  Notion: 【在庫②】https://app.notion.com/p/3d90ff81c56b81fdbd15fe5e67274d63
--
--  ★なぜ必要か（2026-09-10 SEED 会議）:
--   大塚「電卓を探すスクロールが多分みなさん…電卓ってやったら出る方がいい」「区分を作って、区分からの詳細っていう…（フラットだと）無限」
--   亥角「Googleの画像の類似検索…違ければ品番を打ち込む工程は発生する…これはこの品番だよっていう履歴をひたすらAIに学習」
--   今井「ケイカル t6ミリとかは打ち込んで」「ちょっと名前変わって登録される」（名寄せの懸念＝④で alias）
--
--  ★このマイグレーションは**追加のみ**。既存の列・データは触らない。
-- ============================================================

-- ── 品目に「区分」を持たせる（区分→詳細の2段。区分は自由文字列＝会社ごとの言葉で） ──
alter table public.inventory_items add column if not exists category text;
comment on column public.inventory_items.category is
  '区分（ボード・下地材・床材 …）。LIFF の予測検索で絞る第1段。null は「未分類」。';
create index if not exists inventory_items_category_idx
  on public.inventory_items (account_id, category);

-- ── AI 候補の訂正履歴（写真 → AI推定 → 人が確定した品目） ──
--  ★account_id で閉じる（他社の学習データを混ぜない＝AC5・セキュリティ）。
--   次回の候補提示で「この会社では AI推定 X → 確定 Y」を few-shot として渡す。
create table if not exists public.inventory_item_corrections (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  item_id         uuid not null references public.inventory_items(id) on delete cascade,  -- 人が確定した品目
  ai_guess        text,                 -- AI が読んだ品名（自由文字列）
  ai_category     text,                 -- AI が推定した区分
  matched         boolean not null default false,   -- AI の第1候補がそのまま確定した（訂正なし）か
  photo_url       text,                 -- 登録時の写真（在庫の移動記録と同じ URL）
  worker_id       uuid references public.workers(id) on delete set null,
  created_at      timestamptz not null default now()
);
comment on table public.inventory_item_corrections is
  '写真→AI品目候補の確定履歴（会社ごと）。次回の候補提示の few-shot に使う。他社のデータは混ぜない。';
create index if not exists inventory_item_corrections_account_idx
  on public.inventory_item_corrections (account_id, created_at desc);

-- ── RLS（新規テーブルは最初から閉じる） ──
alter table public.inventory_item_corrections enable row level security;
drop policy if exists inventory_item_corrections_sel on public.inventory_item_corrections;
create policy inventory_item_corrections_sel on public.inventory_item_corrections
  for select to authenticated using (account_id = (select current_account_id()));
revoke all on public.inventory_item_corrections from anon;
revoke insert, update, delete on public.inventory_item_corrections from authenticated;

-- ── ロールバック手順 ──
--   drop table if exists public.inventory_item_corrections;
--   alter table public.inventory_items drop column if exists category;
