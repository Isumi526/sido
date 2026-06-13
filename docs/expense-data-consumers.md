# 経費データ（daily_reports.sites[].expenses）を読む/書く全箇所 — 変更時チェックリスト

> **目的**：経費のJSON構造（`vehicles/parkings/highways/trains/others/entertainments/hotel*/leopalace*/garbage*` 等）や
> 「明細ごと領収書（files/fileUrls）」「単一⇔複数（スカラー⇔配列）」を変える時、
> **フォームだけ直して下流（admin集計・通知・PDF・履歴・差分）を直し漏れる**事故を防ぐ。
> 構造を変えたら、**下の全項目を必ず確認**すること。

経費は `daily_reports.sites[]` の各要素 `.expenses`（JSONB）に入る。DBスキーマは無いので **migration不要**だが、その分**読む側のコードが正本**＝下記を全部更新する必要がある。

## ✅ 変更時チェックリスト（全部見る）

### 書き込み（LIFF日報フォーム）
- [ ] `apps/liff/pages/report.vue` — 入力UI・ハンドラ（handle*File）・`analyzeReceipt`（AI解析）・`setUsage`（なしクリア）・`reconstructExpenseUsage`/`loadEditData`（編集ロード＋**旧形式マイグレーション**）
- [ ] `apps/liff/composables/useReport.ts` — `createSite`初期化・add/remove・`stripFiles`(GAS/通知payload)・per-itemアップロード(`perItemGroups`)
- [ ] `apps/liff/composables/useExpense.ts` — `saveReportById`/`sanitizeSitesForStorage`（保存前のFile除去）
- [ ] `apps/liff/types/index.ts` — `Expenses`/`LineItem`等の型

### 集計（flatten）★重複2本：両方直す
- [ ] `apps/admin/src/lib/expenses.ts` `flattenReportExpenses` → admin月次経費（expenses.vue）が使用
- [ ] `apps/liff/composables/useExpense.ts` `getExpenseRowsFromReportsById` → **経費PDF**（liff `expense/print.vue`・`expense/download.vue`）が使用
  - ※この2つは**同一ロジックの手動コピー**。片方だけ直すとPDFと管理画面の金額がズレる。→ 恒久対策は一本化（バックログ「経費平坦化ロジックのLIFF/admin重複をpackagesへ共通化」）

### 表示・集計（admin）
- [ ] `apps/admin/src/pages/reports.vue` — 日報一覧の経費明細・領収書リンク表示
- [ ] `apps/admin/src/pages/index.vue` — ダッシュボードの経費合計（カテゴリ別 addExp）
- [ ] `apps/admin/src/pages/site-reports.vue` — 現場別のコスト計算・明細表示

### 表示（LIFF）
- [ ] `apps/liff/pages/history.vue` — 日報履歴の経費サマリ

### 通知・差分
- [ ] `supabase/functions/_shared/notify.ts` — 日報送信のLINEメッセージ本文（`buildReportMessage`）。**Edge Function＝変更時は functions deploy 必須**
- [ ] `apps/liff/utils/diffReport.ts` — 日報編集の差分通知（notify-edit）

### レガシー（現役なら確認）
- [ ] `apps/gas/コード.js` — 旧GAS経路（現在はEF主経路だが残存）

## スカラー⇔配列を変える時の追加注意（金額の二重/過少計上）
`entertainment`（単一）→`entertainments`（配列）のような変更では：
- **新形式優先・無ければ旧スカラー**で読む（`配列に金額があればそれ／無ければスカラー`）→ 二重計上を防ぐ
- **編集ロード時に旧スカラー→配列へ移行＋スカラーをクリア**（`report.vue loadEditData`）→ 再保存での二重化を防ぐ
- 集計系（admin index/site-reports/flatten×2・notify・history・diff）は**全部**この後方互換を入れる

## 検証
- `npm run typecheck`（apps/liff）／admin は `any` 型のため型では落ちないので**目視必須**
- 本番反映前に、admin月次集計・ダッシュボード・現場別の**金額合計**が新旧データで合うか確認
