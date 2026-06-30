# 注文書/見積PDF 署名URL移行（expense-receipts → admin-docs）stage-2 実行プラン

> **作成**: 2026-06-28（CC・実機コード監査ベース）
> **対象チケット**: 「e) expense-receipts 公開URLに署名URLパターンを横展開」
> **stage-1（済・PR#40）**: admin-docs 非公開バケット＋storageポリシー＋`purchase_orders.pdf_bucket`/`estimates.pdf_bucket` 列（既定 `expense-receipts`）＋ `apps/admin/src/lib/docUrl.ts`（`resolveDocUrl(path, bucket)`＝bucket別に公開URL/署名URL出し分け・dual-read）。
> **このstage-2**: 管理者発行物（注文書/見積PDF）の**全消費箇所をバケット対応(dual-read)にし、新規アップロードを admin-docs(非公開)へ**移す。

## ⚠️ なぜ「専用ユニット・一括・本番スモーク必須」か
注文書PDFは **業者メール添付** と **業者の注文書承諾(accept/change_accept)時の PDFハッシュ証跡** に使われる。1箇所でも bucket 解決を誤ると、**本番で「注文書メールに添付が付かない」「業者が注文書を承諾できない」**＝顧客影響の業務停止。よって全消費箇所を漏れなく同時対応し、本番スモーク（メール添付・業者承諾・PDF表示）まで一括で確認する。

## 安全な段階性（後方互換）
`resolveDocUrl(path,'expense-receipts')` ≡ 従来の `getPublicUrl`、EFの `from(pdf_bucket ?? 'expense-receipts').download()` も既存行（pdf_bucket='expense-receipts'）では従来と同一挙動。よって：
- **Step A（全消費箇所を dual-read 化）= 非破壊**（既存データは挙動不変）。
- **Step B（新規uploadを admin-docs へ＋pdf_bucket='admin-docs'）= 活性化**。
- A→B の順で入れる。Aだけ先行 shipしても本番は無変化（安全）。**Bは A がデプロイ・検証された後**に入れると、万一の取りこぼしが Step A 検証で顕在化せず…を避けられる（A+B同時でも可だが、その場合は新bucket経路のE2E必須）。

## 消費箇所マップ（file:line・対応）

### ① アップロード（Step B：admin-docs へ＋pdf_bucket セット）
- `apps/admin/src/pages/purchase-orders.vue:456-459` — PO PDF upload → `admin-docs`＋`pdf_bucket='admin-docs'`
- `apps/admin/src/pages/estimate-builder.vue:752`（見積）・`:824`（発注書） → 同上
- `apps/admin/src/pages/estimates.vue:249`（見積アップロード） → 同上
- ※ `subcontractor-portal/index.ts` の upload（署名画像 :344/:489、業者見積 :410/:456）は**業者操作＝expense-receipts のまま**（移行対象外）。

### ② admin 表示/DL（Step A：getPublicUrl → resolveDocUrl(path, pdf_bucket)）
- `purchase-orders.vue:302`（PDF）・`:199`（署名画像）
- `estimate-builder.vue:687`
- `estimates.vue:142`
- `site-reports.vue:383`（`from('expense-receipts').getPublicUrl(e.pdf_path)` → `resolveDocUrl(e.pdf_path, e.pdf_bucket)`／select に `pdf_bucket` 追加）

### ③ メールEF添付（Step A：pdf_bucket 出し分け）
- `supabase/functions/_shared/purchase-order-mail.ts:116` — `svc.storage.from(order.pdf_bucket ?? 'expense-receipts').download(order.pdf_path)`（order取得selectに `pdf_bucket` 追加）
- `supabase/functions/_shared/estimate-mail.ts:85` — 同様に出し分け。**注意**: 送信元は `estimate_sends.pdf_path` のスナップショット。bucket を知るには **`estimate_sends.pdf_bucket` 列を追加（追加のみDDL）し送信時に記録** するのが確実（estimates結合で代用も可だが、送信時点と乖離しうる）。推奨＝列追加。
- `_shared/change-order-mail.ts` — PDFを参照しない（テキスト＋URLのみ）＝対応不要。

### ④ portal 配信（Step A：pdf_bucket 出し分け）
- `subcontractor-portal/index.ts:551-553`（resolve時PDF URL返却・getPublicUrl）→ `order.pdf_bucket==='admin-docs'` なら `createSignedUrl`、else `getPublicUrl`
- `:496`（accept時 PDFハッシュ計算 download）→ `from(order.pdf_bucket ?? 'expense-receipts')`
- `:351-352`（change_accept時 PDFハッシュ計算 download）→ 同上
- ※ これらの order select に `pdf_bucket` を追加。

### ⑤ migration（追加のみ）
- `estimate_sends.pdf_bucket text default 'expense-receipts'` を追加（estimate-mail の確実な出し分け用）。`purchase_orders/estimates.pdf_bucket` は stage-1 で追加済。

## 実行手順（推奨）
1. migration: `estimate_sends.pdf_bucket` 追加（local適用）。
2. Step A（全consumerをdual-read化）: ②admin表示5箇所・③メールEF2本・④portal3箇所。各select/downloadに `pdf_bucket` を通す。**この時点では挙動不変**。
3. Step B（活性化）: ①admin upload5箇所を admin-docs＋`pdf_bucket='admin-docs'`、estimate送信時に `estimate_sends.pdf_bucket='admin-docs'` 記録。
4. E2E（新bucket経路）: pdf_bucket='admin-docs' の PO/見積を作り、(a)admin表示が署名URLで開く (b)PO mail添付がadmin-docsからdownloadできる (c)業者accept/ハッシュがadmin-docsで通る (d)portal resolveが署名URLを返す、を検証。既存（expense-receipts）行の回帰も。
5. RLS監査（migration差分）＋Gemini二重レビュー(runs=2-3)。
6. /ship：**本番スモーク必須**＝新規POを1件作って 業者宛（自分宛・隔離）にメール→添付PDFが開く／承諾フロー→PDFハッシュ通る／portal表示、を本番で確認。ロールバック=コードrevert（admin-docs列・bucketは残してOK＝既定expense-receiptsで従来動作）。

## ロールバック
- Step A/B のコードを revert すれば全consumerが従来の `expense-receipts` 公開URLに戻る（pdf_bucket列・admin-docsバケットは残置で無害）。既存PDFは常に公開バケットに残るため失われない。
