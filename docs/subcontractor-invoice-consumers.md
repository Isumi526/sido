# 下請け請求（subcontractor_invoices / _items）の消費箇所チェックリスト

`subcontractor_invoice_items.amount` の**意味は請求書ごとに変わる**。

| `subcontractor_invoices.tax_mode` | `items.amount` の意味 |
|---|---|
| `exclusive`（既定・従来） | 税抜 |
| `inclusive`（ポータル請求は常にこれ） | 税込 |

`tax_mode` は**ヘッダ側にしか無い**。items を単独で読むクエリは
`subcontractor_invoices(tax_mode)` を join しないと amount の意味が判定できない。

**計算は必ず `apps/admin/src/lib/invoiceTax.ts` を通す**（同じ規則を2か所に書くと必ずズレる）。

- `netAmountOf(item, mode)` … 行単位の税抜額。**原価集計はこれ**（請求書をまたいで内税/外税が混ざるため）
- `netTotalOf(items, mode)` / `taxTotalOf` / `grossTotalOf` … 1枚ぶんの合計（請求書画面用）
- `normalizeTaxMode(v)` … 不明値は従来挙動の `exclusive` に寄せる

## 消費箇所（amount を金額として使う所）

| 場所 | 何をしている | 必要な扱い |
|---|---|---|
| `apps/admin/src/pages/index.vue`（月次集計） | 商社/業者の**原価**に合算・明細モーダル | `netAmountOf`（税抜） |
| `apps/admin/src/pages/site-reports.vue`（現場別集計） | 日表の【請求】行 → `shoshaCost`/`gyoshaCost` → 月計・業者別内訳・CSV/ZIP出力 | `netAmountOf`（税抜） |
| `apps/admin/src/pages/subcontractor-invoices.vue`（一覧） | 「請求金額(税込)」列 | `grossTotalOf`（税込） |
| `apps/admin/src/pages/subcontractor-invoices.vue`（モーダル） | 税抜計／消費税／税込 | `netTotalOf` / `taxTotalOf` / `grossTotalOf` |
| `apps/admin/src/pages/subcontractor-invoices.vue`（注文書の残額） | 注文書の税込額と突き合わせ | 税込（`grossTotal`）で比較 |
| `supabase/functions/subcontractor-portal` | 請求を作る側。**常に `tax_mode='inclusive'`＋`tax_rate=10`**（業者には税込で提示しているため） | 書き込み側 |
| `supabase/functions/analyze-invoice` | PDFから `tax_mode` を推定して返す（DBには書かない） | 判定側 |

## 区分（商社/業者）の分岐
原価の列分けは `subcontractors.category === '商社'` のみ商社、**それ以外（業者・未区分）は業者**。
`index.vue` と `site-reports.vue` で必ず同じ規則にする（片方だけ変えると突き合わせが合わなくなる）。

## E2E
- `tests/e2e/admin.invoice-tax-mode.spec.ts` … 請求書画面（一覧列・モーダル合計・保存後の復元）
- `tests/e2e/admin.invoice-tax-mode-aggregation.spec.ts` … **集計に幾ら乗るか**（内税=税抜で積む／外税は据え置き）
- `tests/e2e/admin.subcontractor-invoices.spec.ts` … 請求登録→一覧→現場別集計→月次集計の通し

★請求書画面だけを見る spec は集計側のバグを素通りする（実際に見逃した）。
amount の扱いを変えたら**集計側の spec も必ず足す**。
