# 詳細設計: 領収書AI解析を 駐車場代・高速代・電車 に流用

> エピック: 日報送信 / Notion: 日報送信者が車両、電車経費を領収書のAI解析を使って登録できる
> 既存基盤: `analyze-receipt`（Gemini）＋`useReceiptAnalysis`（ホテル等で使用中）
> 関連: [`expense-parking-highway-multi.md`](./expense-parking-highway-multi.md)（駐車/高速の明細ごと領収書）

## 1. 背景 / 目的
ホテル等で使っている領収書AI解析（画像→`{label, yen, invoiceNumber}` 抽出）を、**駐車場代・高速代・電車**の
領収書にも流用し、金額（電車は区間も）を自動入力できるようにする。手入力の手間と打ち間違いを減らす。

### ユーザー判断（確定済み）
- **対象**: 駐車場代・高速代・電車（**ガソリン/軽油は対象外**＝往復km×単価計算で金額欄が無く、領収書と不整合）
- **電車の領収書**: 現状「電車欄に共通1アップロード」→ **明細ごと領収書＋AI解析に統一**（駐車/高速と同じ）

## 2. 受け入れ条件(AC)
- [ ] 駐車場代の各明細で、領収書を添付→「✨AI解析」で**金額**が自動入力される
- [ ] 高速代の各明細で、領収書を添付→「✨AI解析」で**金額**が自動入力される（ETCカードは手動のまま）
- [ ] 電車が**明細ごとに領収書**を持ち、各明細で「✨AI解析」→**区間(ラベル)＋金額**が自動入力される
- [ ] 解析後はトースト「解析成功！目視でも必ず確認してください」を表示（既存挙動を踏襲）
- [ ] 既存日報（電車の旧・共通領収書 `trainUrls`）も従来どおり集計・表示される（後方互換）
- [ ] 送信後、admin 経費明細・LINE通知・履歴が従来どおり（電車は明細ごと領収書が紐づく）

## 3. データモデル（JSONのみ・DBスキーマ変更なし）

### 3-1. 型（`apps/liff/types/index.ts`）
電車を明細ごと領収書に統一。`ExpenseFileLineItem`（既存：label/yen/tategae/files/fileUrls）を流用。
```ts
export interface Expenses {
  // …
  trains: ExpenseFileLineItem[]   // ← LineItem[] から変更（label/yen/tategae＋files/fileUrls）
  trainFiles?: File[]             // 旧・共通（後方互換のため型は残すが新規未使用）
  trainUrls?: string[]            // 旧・共通（後方互換で集計が読む）
  // parkings/highways は既存（ExpenseFileLineItem / HighwayLineItem）
}
```
- `others` は `LineItem[]` のまま（今回対象外）。
- DBは `daily_reports.sites` JSON。**マイグレーション不要**。

### 3-2. 後方互換
- 旧電車データ: `trains[]`（label/yen）＋共通 `trainUrls`。新規: `trains[].fileUrls`（明細ごと）。
- 集計は「`tr.fileUrls` があれば使う、無ければ旧 `trainUrls` を take-once」で両系統を読む。

## 4. LIFF UI（`report.vue` ＋ `useReport.ts`）

### 4-1. AI解析ボタン（駐車・高速・電車の各明細）
ホテルの `.btn-ai` パターンを流用：領収書を選択（`item.files?.length`）したら「✨AI解析」ボタンを表示。
```html
<button class="btn-ai" :disabled="receipt.loading.value === `${si}-parking-${pi}`"
        @click="analyzeReceipt(si, 'parking', pi)">✨ AI解析</button>
```
- 駐車場代（`parkings[pi]`）/高速代（`highways[hi]`）: 既存の per-item ファイル欄に追加。
- 電車（`trains[ti]`）: **共通 trainFiles 欄を廃止**し、各電車行に「区間入力＋金額＋per-item ファイル＋AI解析」を配置
  （駐車/高速と同じ `.lineitem-card` 構成）。

### 4-2. `analyzeReceipt` 拡張（`report.vue`）
```ts
async function analyzeReceipt(
  si: number,
  field: 'hotelFiles'|'leopalaceFiles'|'otherFiles'|'entertainmentFiles'|'parking'|'highway'|'train',
  index?: number,
) { … }
```
- file 取得元を分岐: parking→`parkings[index].files[0]`、highway→`highways[index].files[0]`、train→`trains[index].files[0]`。
- loading キー: `${si}-${field}-${index}`。
- 流し込み:
  - parking: `parkings[index].yen = result.yen`
  - highway: `highways[index].yen = result.yen`（etcCard は触らない）
  - train: `trains[index].label = result.label`（区間）／`trains[index].yen = result.yen`
- 既存4カテゴリの分岐は不変。

### 4-3. composable（`useReport.ts`）
- `createTrain()`：`{ label:'', yen:undefined, tategae:false, files:[] }`（`createLineItem` から差し替え）。
- `createSite`/`setUsage(train,なし)`/`loadEditData` の trains 初期化を `createTrain()` に。
- per-item アップロード（既存 parking/highway ループ）に `{items: trains, prefix:'train'}` を追加。
- `FILE_CATEGORIES` から `trainFiles`（共通）を**除外**（旧読み取りは維持・新規アップロードは per-item へ）。
- `stripFiles`：`trains` も `files` 除去対象に追加。

### 4-4. 保存サニタイズ（`useExpense.saveReportById`）
`sanitizeSitesForStorage` の `stripItemFiles` 対象に `trains` を追加（既存 parkings/highways と同様）。

## 5. 集計・通知・履歴（後方互換）
- **flatten**（`admin/lib/expenses.ts` ＋ `liff/useExpense.ts`）: 電車行の `fileUrls` を
  `tr.fileUrls ?? takeTrainUrls()`（新=明細ごと／旧=共通 take-once）で解決。駐車/高速は既存どおり。
- **通知**（`_shared/notify.ts`）: 領収書フォルダリンク判定 `hasItemFiles` に `trains[].fileUrls` を追加。
- **履歴**（`history.vue`）: 電車表示は label/yen で不変。

## 6. Edge Function（`analyze-receipt`）
- **プロンプト改良（追記のみ・他カテゴリに無害）**: `label` の説明に
  「電車の乗車券・領収書なら乗車区間を『A〜B』の形式で」を追記。既存の店名/施設名抽出は維持。
- **config.toml 追加**（現在未登録）:
  ```toml
  [functions.analyze-receipt]
  verify_jwt = false
  ```
- ⚠ 本番反映時は `analyze-receipt` の再デプロイが必要（`--no-verify-jwt`）。/ship 対象。

## 7. AC → E2E（Playwright）
AI解析は外部API（Gemini）依存のため、**`page.route` で `**/analyze-receipt` をスタブ**して決定的に検証する。
`tests/e2e/liff.ai-receipt.spec.ts`:
1. 駐車場代: 明細にファイル添付→AI解析（スタブが`{yen:1200}`）→**金額1200が入る**。
2. 高速代: 同様に金額が入る。
3. 電車: 明細ごとにファイル添付→AI解析（スタブ`{label:'名古屋〜大阪', yen:6600}`）→**区間と金額が入る**。
4. 電車が明細ごと領収書（per-item ファイル欄＋AI解析ボタン）になっていること。
- 併せて、電車 per-item 領収書の**保存往復**（送信→`daily_reports.trains[].fileUrls`/files除去→編集復元）を
  既存 `liff.parking-highway-multi` の往復テストに倣って1ケース追加。

## 8. デプロイ順序・後方互換
1. DB migration: なし。
2. Edge Function: `analyze-receipt` 再デプロイ（プロンプト改良）。後方互換（出力スキーマ不変）。
3. フロント: liff（入力・AI）＋admin（集計の電車 fileUrls 対応）。新旧フロント順不同で安全。
- ロールバック可（電車の旧共通領収書も読めるまま・データ破壊なし）。

## 9. スコープ外（残課題候補）
- ガソリン/軽油のAI解析（金額ベース化 or リットル抽出は別設計）。
- 駐車/高速/電車への登録番号(インボイス)保存（現状これらは登録番号欄を持たない）。
- 複数領収書を1明細にまとめた時の合算解析（現状は先頭ファイルを解析）。
