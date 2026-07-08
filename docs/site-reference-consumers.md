# daily_reports.sites[] の現場参照 — 消費箇所チェックリスト

日報は現場を **`site_id`（権威キー）＋ `siteName`（表示スナップショット）** で持つ。
集計は **`site_id` 優先＋名前フォールバック**でグループ化する（表記ゆれ・現場マージ孤児を1バケットに統合＝再発防止）。
`site_id` を持たない旧データ/フリーテキストは、read時に active 現場マスタへ**正規化名一致**で解決する（`resolveActiveSiteId`）。

**現場参照の集計/表示ロジックを変えたら、以下すべてを確認すること。**

## 解決の単一ソース（ここを直す）
- `apps/liff/utils/siteSimilarity.ts` / `apps/admin/src/lib/siteSimilarity.ts` … `normalizeSiteName` / `resolveActiveSiteId`（**両アプリ同一ロジック**。片方だけ直さない）。
- `apps/admin/src/lib/siteKey.ts` … `resolveSiteRef`（集計キー＋表示名）/ `siteStoredName`。admin集計はこれを使う。
- `scripts/backfill-site-id.mjs` … 既存データへ `site_id` を後付け（正規化名一致・追加のみ・冪等）。normalize/resolve を**上記と同一ロジックで複製**しているので、正規化仕様を変えたら3箇所そろえる。

## 書き込み（site_id を刻む）
- `apps/liff/composables/useExpense.ts` `saveReportById` → `sanitizeSitesForStorage`（保存前に registerNewSites→active取得→`resolveActiveSiteId` で `site_id` 付与）。**日報DB保存の唯一の経路**。
- `apps/admin/src/pages/report-site-relink.vue` `relink`（現場未設定→現場確定時に `site_id` も書く）。
- `apps/admin/src/pages/sites.vue` `doMerge`（マージ時に `sites[].site_id` を統合先へ付け替え＋名称正規化）。

## 集計/表示の読者（site_id 優先でグループ化）
- `apps/admin/src/pages/site-reports.vue` `computeSiteMap`（**現場別集計**・請求行合流も同解決）← 本命
- `apps/admin/src/pages/worker-reports.vue`（作業員×現場の内訳）
- `apps/admin/src/pages/gasoline-allocation.vue`（現場別走行距離の按分基準）
- `apps/admin/src/pages/site-detail.vue`（当現場の日報履歴マッチ＝ site_id 厳密一致 or 正規化名一致）
- `apps/admin/src/pages/index.vue`（月次集計の明細ラベル。金額は費目別なのでラベルのみ）

## 触っていない（名前表示のみ・金額集計しない）
- `apps/admin/src/pages/expenses.vue` / `expenses-daily.vue`（経費行の現場名は表示/フィルタ用）
- `apps/admin/src/pages/reports.vue`（日報ビューの現場名表示）
- edge functions（`_shared/notify.ts` 等）… `siteName` を通知本文/フォルダ名に使うだけ。`site_id` はスプレッドで透過。
- `shared/expense-flatten.ts`（経費行の平坦化。現場は表示名のみで by-site 集計しない）
