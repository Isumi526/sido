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

### 集計（flatten）★単一ソース：`shared/expense-flatten.ts` だけを編集
- [ ] `shared/expense-flatten.ts` — `flattenReportExpenses`/`flattenGasolineItems`/`expenseDisplayCategory`（品名）/`expenseAccountCategory`（勘定科目）/`EXPENSE_ACCOUNT_OPTIONS` の正本
- [ ] 編集後は **`npm run sync:shared`** で `apps/admin/src/lib/expense-flatten.gen.ts` と `apps/liff/composables/expense-flatten.gen.ts` を再生成する（**.gen.ts は直接編集禁止**・`scripts/sync-shared.mjs`）
  - admin からは `apps/admin/src/lib/expenses.ts`（re-exportシム）経由、liff からは `~/composables/expense-flatten.gen` を直接 import

### 表示・集計（admin）
- [ ] `apps/admin/src/pages/expenses.vue` — 月次経費（精算モーダル明細・印刷/PDF）
- [ ] `apps/admin/src/pages/expenses-daily.vue` — 経費 日毎集計（科目=勘定科目・内訳あり）
- [ ] `apps/admin/src/pages/reports.vue` — 日報一覧の経費明細・領収書リンク表示
- [ ] `apps/admin/src/pages/index.vue` — ダッシュボードの経費合計（カテゴリ別 addExp）
- [ ] `apps/admin/src/pages/site-reports.vue` — 現場別のコスト計算・明細表示

### 表示（LIFF）
- [ ] `apps/liff/pages/history.vue` — 日報履歴の経費サマリ
- [ ] `apps/liff/pages/expense/download.vue`・`expense/print.vue` — 経費PDF（申請書）。**download.vue は申請前インライン編集の書き戻しあり**（`saveRow` → `useExpense.patchExpenseItem` が `srcSiteIndex/srcKey/srcIndex` で明細を辿って保存）。列・編集対象フィールドを増やす時は `patchExpenseItem` の patch 対象も確認

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

## gasoline_items（本日のガソリン代・実費）※flatten非経由・各ページで直接読む
- 書き込み: report.vue ガソリンカード / createGasolineItem(useReport) / **saveReportById の gasItems whitelist（未知フィールドは落ちる＝新フィールド追加時は必ずここに追加）** / loadEditData 復元(report.vue)
- 読み: useExpense.getExpenseRowsFromReportsById 手組み行 / expenses.vue / expenses-daily.vue / gasoline-allocation.vue(yenのみ) / index.vue(yenのみ)
- フィールド: yen/payee/registrationNumber/**liters/fuelType(regular|diesel)**/tategae/fileUrls
- 注意: gasoline_items はスキーマレスJSONB。新フィールドは①型 ②createGasolineItem ③report.vue入力 ④loadEditData復元 ⑤saveReportById whitelist ⑥各表示行 の6箇所を必ず直す（silent-drop注意）。距離按分(distanceKm/dieselKm)とは別系統。
