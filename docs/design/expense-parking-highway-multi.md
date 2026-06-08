# 詳細設計: 駐車場代・高速代を 日×現場ごとに複数登録（明細ごと領収書）

> エピック: 日報送信 / Notion: 日報送信者が駐車場代、高速代を日×現場ごとに複数登録できる
> 関連正典: [`docs/spec/expense.md`](../spec/expense.md)（経費の用語・集計）
> ステータス: 要件定義済み → 設計

## 1. 背景 / 目的
現状、駐車場代・高速代は **車両(vehicle)ごとに各1件**（`vehicles[].parkingYen` / `highwayYen`）しか入力できない。
実務では1日×1現場で複数の駐車場代・高速代が発生し、**領収書も別々**になるケースがある。
そこで駐車場代・高速代を **現場ごとに複数明細**として登録でき、**各明細に個別の領収書**を添付できるようにする。

### ユーザー判断（確定済み）
- **複数化の単位**: 現場単位で独立（車両から切り離し、電車・その他と同じ「＋追加」リスト）
- **領収書**: 明細ごとに個別添付（各駐車場代・高速代が自分の領収書を持つ）

## 2. 受け入れ条件(AC)
- [ ] 1日報の1現場で、駐車場代を **複数明細** 入力でき（金額・個人建て替え・領収書）、「＋追加」「✕削除」できる
- [ ] 同様に高速代を **複数明細** 入力でき、各明細に **ETCカード** を選べる
- [ ] 各駐車場代・高速代明細に **個別の領収書（JPEG/PDF・複数可）** を添付できる
- [ ] 送信後、admin 経費明細で各明細が **1行ずつ** 展開され、**その明細の領収書**が紐づいて表示される
- [ ] 既存日報（旧形式 `vehicles[].parkingYen/highwayYen`）も従来どおり表示・集計される（後方互換）
- [ ] LIFF履歴（history）に複数の駐車場代・高速代が表示される

## 3. データモデル（JSONのみ・DBスキーマ変更なし）
経費は `daily_reports.sites[]`（JSONB）配下の `expenses` に格納。**マイグレーション不要**（追加フィールドのみ）。

### 3-1. 型追加（`apps/liff/types/index.ts`）
```ts
// 明細＋個別領収書を持つ行（駐車場代・その他系の共通形）
export interface ExpenseFileLineItem {
  label?: string
  yen?: number
  tategae?: boolean
  registrationNumber?: string
  files?: File[]        // 送信前（アップロード用・JSONには載せない）
  fileUrls?: string[]   // Storage URL（保存・編集ロード・集計で使用）
}
// 高速代は ETC カードを併せ持つ
export interface HighwayLineItem extends ExpenseFileLineItem {
  etcCard?: string
}

export interface Expenses {
  // …既存…
  vehicles: VehicleExpense[]   // 既存（ガソリン/軽油/ETC）。parkingYen/highwayYen は後方互換で残すが新規入力はしない
  parkings?: ExpenseFileLineItem[]  // ★新規: 現場ごとの駐車場代（複数）
  highways?: HighwayLineItem[]      // ★新規: 現場ごとの高速代（複数）
  // …既存 trains/others/hotel… はそのまま
}
```
- `VehicleExpense.parkingYen/highwayYen/parkingTategae/highwayTategae/etcCard` は**型としては残す**（旧データ読取のため）。新規入力フォームからは外す。
- `parkings`/`highways` は `site.expenses` 直下（電車 `trains` と同じ階層）。

### 3-2. 後方互換の原則
- **旧データ**: `vehicles[].parkingYen/highwayYen` を集計・通知・履歴で**引き続き読む**（マイグレーションしない）。
- **新データ**: `expenses.parkings[]/highways[]` を読む。両系統を**併存**で集計（重複しない：旧は車両配下、新は現場直下）。

## 4. LIFF UI（`apps/liff/pages/report.vue` ＋ `composables/useReport.ts`）

### 4-1. 交通経費セクションの再構成（`siteUsage[si].vehicle==='あり'` 内）
現在の「車両」ブロックから 単一の駐車/高速 入力を外し、**車両ありの時だけ表示する複数明細サブ項目**を
車両ブロック内（vehicleFiles の下）に新設する。

> UI判断: 車両に乗っていない（車両=なし / 乗合い）なら駐車場代・高速代は発生しない。よって
> **駐車場代・高速代は「車両=あり」のときのみ表示**（`siteUsage[si].vehicle === 'あり'` の template 内に配置）。
> データモデルは現場単位（`site.expenses.parkings[]/highways[]`）のまま＝車両ごとの入れ子にはしない。

- **車両ブロック**（既存）: `vehicleName / ガソリン(distanceKm) / 軽油(dieselKm)` のみ残す。
  旧 `駐車場（円）/高速代（円）` の ExpenseField と車両単位の ETCカード select を**削除**（ETCは高速代明細へ移設）。
- **駐車場代サブ項目**（`車両=あり` 内）: 「＋追加 / ✕」で複数行。各行: `ExpenseField(yen,tategae) ＋ per-item ファイル入力`。
- **高速代サブ項目**（同上）: 各行に **ETCカード select**（既存の7枚カード選択UIを流用）。
- 初期0行＋「＋追加」ボタンのみ（任意入力）。
- **クリア**: `setUsage` で車両を `なし`/`乗合い` にした時、`parkings/highways` を空配列にクリア（隠れデータを送信しない）。

### 4-2. composable（`useReport.ts`）
- `createFileLineItem()` / `createHighwayItem()` を追加（`{ yen: undefined, tategae:false, files:[], ... }`）。
- `addParking(si)/removeParking(si,i)` `addHighway(si)/removeHighway(si,i)` を `trains` と同型で追加。
- `loadEditData`（report.vue 650-705行）: 既存の `...(site.expenses ?? {})` スプレッドで `parkings/highways/fileUrls` は自動復元。
  デフォルトに `parkings: []`, `highways: []` を補完（未定義時）。

### 4-3. per-item 領収書アップロード（`useReport.ts` 136-182行＝FILE_CATEGORIES ループの後に追記）
- 既存の `uploadExpenseFiles(...)` を再利用。category を細分化して衝突回避:
  - 駐車場: `category = 'parking_' + i`、`parkings[i].files → parkings[i].fileUrls`
  - 高速代: `category = 'highway_' + i`、`highways[i].files → highways[i].fileUrls`
- ストレージ規則（バケット `expense-receipts`、パス `{slug}/{YM}/{half}/{date}_{sender}_{site}/{category}_{n}.{ext}`）は既存関数のまま。

### 4-4. GAS送信ペイロード（`useReport.ts` 240-256行 `stripFiles`）
- `stripFiles` を拡張: `parkings/highways` 各要素から `files` を除去（`fileUrls` は残す）。
  既存の `vehicleFiles` 等トップレベルキー除去に加え、配列を map して `files` を落とす。
- `stripEmpty` は空配列・undefined を再帰除去（既存）。空の `parkings/highways` はそのまま落ちる。

## 5. admin / 集計・表示（`apps/admin/src/lib/expenses.ts` ＋ LIFF `composables/useExpense.ts`）
`flattenReportExpenses`（admin 73-110行）と `getExpenseRowsFromReportsById`（liff）に **同一の追記**:
```ts
// 旧形式（後方互換・据え置き）: vehicles[].parkingYen / highwayYen をこれまで通り展開
// 新形式（追加）:
for (const p of (exp.parkings || [])) {
  if (p.yen) rows.push({ date, category: '駐車代', siteName, amount: p.yen,
                         fileUrls: p.fileUrls, tategae: !!p.tategae })
}
for (const h of (exp.highways || [])) {
  if (h.yen) rows.push({ date, category: '高速代', siteName, amount: h.yen, note: h.etcCard || '',
                         fileUrls: h.fileUrls, tategae: !!h.tategae })
}
```
- 領収書は **take-once 不要**（各明細が自分の `fileUrls` を持つ）。admin `expenses.vue` の領収書表示（📎リンク）はそのまま機能。
- admin 側は `lib/expenses.ts` の純関数追記のみ。`expenses.vue` の表示ロジックは無改修。

## 6. LINE通知（Edge Function `supabase/functions/_shared/notify.ts buildReportMessage`）
- 本番のLINE通知は **edge function `submit-report`** が `buildReportMessage` で生成（GAS `コード.js` は旧経路で未使用）。
- `vehicles` ループ（旧 parking/highway 読取）は**残す**。追加で `exp.parkings/exp.highways` をループして
  `駐車¥… / 高速¥…`（ETC併記）を通知本文に追記。
- 領収書フォルダリンク判定（`hasFiles`）に `parkings[].fileUrls / highways[].fileUrls` を含める。
- ⚠ **デプロイ**: edge function 変更のため `/ship` で `--no-verify-jwt` 付きで本番 deploy 対象。GASは無改修。
- なお日報本体は `useExpense.saveReportById` が `daily_reports.upsert({sites})` で永続化。保存前に
  `sanitizeSitesForStorage` で File[] を除去（既存 `*Files` ＋ 新 `parkings/highways[].files`）。

## 7. LIFF履歴（`apps/liff/pages/history.vue` `expenseLines` 231-241行）
- `vehicles` の旧 parking/highway 表示は残し、`exp.parkings/exp.highways` の表示を追記（金額の一覧）。

## 8. AC → E2E（Playwright）
LIFF は dev モード（`dev-user-id`・認証不要）。`tests/e2e/liff.report.spec.ts` / `liff.expense.spec.ts` を参考に
`tests/e2e/liff.parking-highway-multi.spec.ts` を新設:
1. 日報フォームで交通経費=あり → **駐車場代を2行**追加し金額入力 → 「＋追加 / ✕削除」が機能（UI挙動）
2. **高速代を2行**追加し金額＋ETCカード選択 → 行が独立して保持される
3. （可能なら）送信 → admin `/expenses` で当該日×現場の駐車代・高速代が**複数行**展開される
   - admin 集計は `flattenReportExpenses` の純関数。E2Eが重い場合は、まず**入力UIの複数行挙動**を必須緑とし、
     送信→admin反映は seed 投入（`daily_reports.sites` に新形式JSONを直接 upsert）→ admin表示の確認で代替する。
- 後方互換: 旧形式 `vehicles[].parkingYen` を含む seed を admin で開き、従来通り1行表示されることを確認。

## 9. デプロイ順序・後方互換
1. **DBマイグレーション**: なし（JSON構造の追加のみ）。
2. **フロント**: liff（入力）＋admin（集計）を main にマージ → Vercel。後方互換のため**順不同で安全**
   （新 liff が旧 admin に送っても、旧 admin は新フィールドを無視。新 admin は旧データも読む）。
3. **GAS**: LINE通知の駐車/高速複数表示は `clasp push`＋エディタ手動デプロイ（別ゲート・任意）。未反映でも
   日報データ・admin集計には影響なし（通知本文の網羅性のみ）。
- **ロールバック安全**: 新フィールドは旧コードから無視されるだけ。データ破壊なし。

## 10. スコープ外（残課題候補）
- ガソリン代・軽油代の明細ごと領収書化（今回は駐車/高速のみ）。
- 旧 `vehicles[].parkingYen/highwayYen` の新形式への一括マイグレーション（不要・併存で対応）。
- 経費PDF（`generateExpensePdf`）は領収書URLを埋め込まない既存仕様のまま（変更なし）。
