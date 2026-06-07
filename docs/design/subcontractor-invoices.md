# 設計書: 下請け業者の請求情報を入力し現場別集計に反映

- Notion: 管理者が下請け業者からの請求情報を現場別集計に打ち込むことができる（id 末尾 `61c05d30`）
- 優先順位: 緊急 / スコープ: **admin ＋ DB ＋ functions(AI解析)**

## 1. 背景・目的
月1回、各下請けからバラバラのフォーマットで請求書が届く。来月は業者向けフォームを公開予定だが
今月は間に合わないため、**管理者が請求書情報（ヘッダ＋明細）を入力**し、**PDFアップロード→AI解析で自動入力**、
**現場別集計に反映**できるようにする。将来の業者向けフォームに流用できるデータモデルにする。

## 2. 受け入れ条件(AC)（確定）
- AC1: admin に「下請け請求」画面があり、**ヘッダ（業者名・件名・請求番号・請求日・支払期限・請求金額）**と
  **明細（日付・現場(プルダウン)・工事内容/品番/品名・数量・単位・単価・金額・税率(既定10%)・備考）**を入力・保存できる
- AC2: 明細の `金額 = 数量 × 単価`（税抜）を自動計算。請求金額(合計)＝Σ金額＋消費税を表示
- AC3: 請求書PDFをアップロード→**AI解析**でヘッダ＋明細が自動入力される（管理者が確認・修正可）
- AC4: 保存した請求が一覧で確認できる（新しい順）
- AC5: **現場別集計(site-reports)** に、下請け請求の現場×月合計が反映表示される

## 3. データモデル（新規・追加のみ・後方互換）
`supabase/migrations/20260607000000_subcontractor_invoices.sql`
```sql
-- 請求ヘッダ
create table if not exists subcontractor_invoices (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references accounts(id) not null,
  subcontractor_id uuid references subcontractors(id),   -- マスタ参照（任意）
  vendor_name      text not null,                        -- 業者名（マスタ未登録でも入る）
  title            text,                                 -- 件名
  invoice_no       text,                                 -- 請求番号
  invoice_date     date,                                 -- 請求日
  due_date         date,                                 -- 支払い期限
  total_amount     integer,                              -- 請求金額（請求書記載値・税込）
  pdf_path         text,                                 -- expense-receipts 上のPDF
  note             text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
-- 請求明細（各行に site_id を持ち現場別集計に使う）
create table if not exists subcontractor_invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid references subcontractor_invoices(id) on delete cascade not null,
  account_id  uuid references accounts(id) not null,     -- 集計クエリ用に非正規化
  item_date   date,                                      -- 日付
  site_id     uuid references sites(id),                 -- 現場（プルダウン）
  site_name   text,                                      -- 表示・流用用に名称も保持
  description text,                                      -- 工事内容/品番/品名
  quantity    numeric,                                   -- 数量
  unit        text,                                      -- 単位
  unit_price  integer,                                   -- 単価
  amount      integer,                                   -- 金額(税抜)=数量×単価
  tax_rate    numeric not null default 10,               -- 税率%（既定10）
  note        text,
  sort_order  int default 0
);
create index if not exists sii_account_site_date_idx on subcontractor_invoice_items(account_id, site_id, item_date);
create index if not exists sii_invoice_idx on subcontractor_invoice_items(invoice_id);
create index if not exists si_account_idx on subcontractor_invoices(account_id);
alter table subcontractor_invoices disable row level security;
alter table subcontractor_invoice_items disable row level security;
```
- per-account スコープ。明細に site_id＋account_id を持たせ site-reports の月集計を容易に。
- 業者向けフォーム流用: vendor_name/subcontractor_id 両持ち、将来は vendor がこのテーブルへ直接書く想定。

## 4. AI解析 edge function（新規）`supabase/functions/analyze-invoice`（＋ `test-` 変種）
- 既存 `analyze-receipt`（Gemini 2.5-flash, 3項目のみ）を参考に、**請求書全体**を抽出する新関数。
- 入力: `{ fileBase64, mimeType }`（PDF: `application/pdf` を Gemini inlineData で送る。画像も可）
- Gemini 2.5-flash に「請求書からヘッダ＋明細をJSON抽出」プロンプト。出力:
```json
{ "vendor_name": str|null, "title": str|null, "invoice_no": str|null,
  "invoice_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "total_amount": int|null,
  "items": [{ "date": "YYYY-MM-DD"|null, "site_name": str|null, "description": str|null,
              "quantity": num|null, "unit": str|null, "unit_price": int|null,
              "amount": int|null, "tax_rate": num|null, "note": str|null }] }
```
- best-effort。失敗時は空 `{ items: [] }`。`GEMINI_API_KEY` を使用。`--no-verify-jwt`（既存方針）＋CORS。
- site_name は文字列で返し、admin 側で sites マスタと名寄せ（一致すれば site_id 設定、無ければ未設定で人が選ぶ）。

## 5. admin UI（`apps/admin/src/pages/subcontractor-invoices.vue` 新規）
- ルート `/subcontractor-invoices`、メニュー「下請け請求」（レポート群に追加）。
- **一覧**: 保存済み請求を新しい順（業者名・件名・請求日・合計・明細件数）。行クリックで編集。
- **新規/編集フォーム**（モーダル or 同ページ）:
  - PDFアップロード → 「AI解析」ボタン → `analyze-invoice` 呼び出し → ヘッダ＋明細を流し込み（既存値は確認のうえ上書き）。
  - ヘッダ入力欄（業者=subcontractorsプルダウン＋自由入力 vendor_name、件名/請求番号/請求日/支払期限/請求金額）。
  - 明細テーブル（行追加/削除）: 日付・現場(sitesプルダウン)・工事内容・数量・単位・単価・金額(自動)・税率(既定10)・備考。
  - 合計表示: 税抜計／消費税／税込（＝請求金額の参考）。
  - 保存: `subcontractor_invoices` を upsert → 既存 items を入れ替え（delete→insert）。account_id/site_id 付与。
- account スコープ: `getAccountId()` で全クエリ `.eq('account_id', …)`。
- PDF は `expense-receipts/subcontractor-invoices/{account}/{invoiceId}.pdf` に保存。

## 6. 現場別集計への反映（`apps/admin/src/pages/site-reports.vue`）
- 当月の `subcontractor_invoice_items` を `account_id` ＋ 当月(item_date) で取得し、**現場(site_id/site_name)ごとに amount を合算**。
- 現場タブの表示に「下請け請求(当月)」の合計を追加（現場ごとの月サマリとして表示）。明細は折りたたみ/モーダルで一覧可。
- 既存の集計（日報内 subcontractors 人数×単価）とは別軸の「実請求額」として併記（混同しないようラベル分け）。

## 7. AC → E2E（Playwright, admin）
`tests/e2e/admin.subcontractor-invoices.spec.ts`:
- E2E-1 (AC1/AC2/AC4): 「下請け請求」を開く→新規→ヘッダ＋明細1行（現場=テスト現場A・数量×単価）入力→金額自動計算→保存→一覧に出る。
- E2E-5 (AC5): 現場別集計で当該現場・当月に下請け請求合計が表示される（seedした請求 or 上で作成した請求を参照）。
- AI解析(AC3)は Gemini 外部依存のため E2E 対象外（関数は別途レビュー＋手動確認。ボタン存在は確認）。
- seed: global-setup で当月の subcontractor_invoices＋items を1件（現場=テスト現場A）投入（冪等）。

## 8. デプロイ順序・後方互換性
1. **DB**: 2テーブル作成（追加のみ・後方互換）。/ship でDB適用ゲート。
2. **functions**: `analyze-invoice`(＋test-) deploy＋`GEMINI_API_KEY` secret（未登録なら登録）。/ship ゲート。
3. **フロント**: admin デプロイ。
- 後方互換: 新規テーブル＋新ページ＋site-reportsへの追記表示のみ。既存集計は不変。

## 9. スコープ外（残課題候補）
- 業者向け公開フォーム（来月予定）＝本テーブルへ vendor が直接入力する導線・認証
- AI解析の精度向上・明細行の現場自動名寄せの強化
