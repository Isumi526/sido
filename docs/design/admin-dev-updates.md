# 設計書: 管理画面トップに「開発の更新履歴」を表示

- Notion: 管理者が開発の進捗状況を管理画面トップで確認できる（id 末尾 `dce68e58a608`）
- 優先順位: 緊急 / スコープ: **admin ＋ DB**

## 1. 背景・目的
機能追加・バグ修正を不定期にLINEで連絡している運用を、admin ダッシュボード上部の
「更新履歴」一覧に置き換える。1行要約＋該当ページリンク、OKでアーカイブ、新しい順。

## 2. 受け入れ条件(AC)（確定）
- AC1: admin トップ（ダッシュボード上部）に更新履歴が**新しい順**で一覧表示される
- AC2: 各項目は **1行要約**と、あれば**該当ページへのリンク**（クリックで遷移）を持つ
- AC3: 各項目の **OK ボタン**でアーカイブされ、一覧から消える（**アーカイブは全体共通**）
- AC4: 6月以降のGitを基にした**初期データ**が入っている（粒度は粗くてよい）

## 3. 決定事項
- アーカイブ単位 = **全体共通**（`archived` フラグ1つ・テーブル1つ）
- リンク = **管理画面/LIFF の該当ページURL**（GitのURLではない）。`/expenses` 等のadmin内パス、または `https://…`(LIFF等)
- 初期データ = 6月以降gitを私が粗く集約 → 承認後 seed migration で投入
- エントリ追加は開発側がDB/migrationで行う（admin の追加フォームは本スコープ外）

## 4. データモデル（新規・追加のみ・後方互換）
`supabase/migrations/<ts>_dev_updates.sql`
```sql
create table if not exists dev_updates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,                 -- 1行要約
  link       text,                          -- 該当ページ: admin内は '/expenses' 等 / それ以外は 'https://…'
  archived   boolean not null default false,
  created_at timestamptz not null default now()   -- 表示順・日付（初期データは実日付を指定）
);
create index if not exists dev_updates_archived_created_idx on dev_updates(archived, created_at desc);
alter table dev_updates disable row level security;   -- 既存方針に合わせる
```
- account_id なし（全社共通の更新履歴・アーカイブも共通）。

## 5. admin UI（`apps/admin/src/pages/index.vue`）
- ダッシュボード最上部（「月次集計」より上）に「**お知らせ / 更新履歴**」セクションを追加。
- 取得: `dev_updates` を `archived=false` で `created_at desc` 取得。
- 各行: `YYYY/M/D` ＋ `title` ＋（linkあれば）リンク ＋ `OK` ボタン。
  - リンク描画: `link` が `/` 始まり → `<RouterLink :to="link">`（admin内遷移）、それ以外 → `<a :href="link" target="_blank" rel="noopener">`。
- OK: `update dev_updates set archived=true where id=…` → 行をリストから除去。
- 0件のときはセクション非表示（または「新しいお知らせはありません」）。
- 既存の月次集計 UI はそのまま下に残す。

## 6. 初期データ（seed migration・承認後に確定）
`supabase/migrations/<ts>_seed_dev_updates.sql` に INSERT（追加のみ）。
6月以降の主な更新を粗く集約（候補は ★停止時に提示し承認を得る）。各行 title＋link(該当ページ)＋created_at(実日付)。

## 7. AC → E2E（Playwright, admin）
`tests/e2e/admin.dev-updates.spec.ts`:
- seed: global-setup で `dev_updates` にテスト用エントリを1件投入（冪等）。
- E2E-1 (AC1/AC2): `/` を開く→更新履歴セクションにそのエントリ（タイトル）が表示される。リンクがあれば要素が出る。
- E2E-3 (AC3): OK 押下→一覧から消える→リロードしても出ない（archived=true）。

## 8. デプロイ順序・後方互換性
1. **DB**: `dev_updates` 作成 ＋ 初期データ seed（どちらも追加のみ）。**/ship でDB適用ゲート**（db push禁止・psql直適用）。
2. **フロント**: admin の Vercel デプロイ。
- 後方互換: 新規テーブル＋ダッシュボードへのセクション追加のみ。既存機能に影響なし。
