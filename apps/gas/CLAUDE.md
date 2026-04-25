# apps/gas — GAS (Google Apps Script) コード

## 概要
Sample Construction Co.の施工台帳システムのバックエンド。
LINE Messaging API の webhook 受信・GASスプレッドシート転記・LIFF日報フォームの処理を担う。

## デプロイ方法

```bash
# GASから最新コードを取得
npm run gas:pull        # ルートから実行
cd apps/gas && clasp pull  # または直接

# GASに反映
npm run gas:push
cd apps/gas && clasp push
```

> **注意**: `clasp push` は即座に本番反映される。LINEのwebhookも同じスクリプトが処理しているため、
> doPost / doGet を壊すと本番のLINE通知が止まる。必ず動作確認してからpushすること。

## ファイル構成

```
apps/gas/
├── .clasp.json          # claspプロジェクト設定（scriptId）
├── appsscript.json      # GASマニフェスト（clasp pullで自動生成）
├── CLAUDE.md            # このファイル
└── *.gs / *.js          # GASソースコード（clasp pullで取得）
```

## アーキテクチャ

### エントリーポイント

| 関数 | 用途 |
|------|------|
| `doPost(e)` | LINE webhookの受信 + LIFFフォーム送信(`action: submitReport`)の振り分け |
| `doGet(e)`  | LIFFアプリからのマスタデータ取得(`action: getMaster`) |

### 主要な処理フロー

**LINE webhook (`doPost`)**
1. `e.postData.contents` をパース
2. `body.action === 'submitReport'` なら `handleLiffReport(body)` へ
3. それ以外は LINE Events を処理（メッセージ返信など）

**LIFF日報受信 (`handleLiffReport`)**
1. `body.sites[]` をループ
2. 対象の現場シートを特定 or 作成
3. 作業員を転記（工場/事務所列 or 現場列 — `workerRole` で判定）
4. 経費を転記
5. LINEグループに通知メッセージを送信

**マスタ取得 (`doGet`)**
- `?action=getMaster` で現場名・作業員・下請け業者・車両一覧を返す
- 作業員には `role: 'factory' | 'site'` を含める（LIFFの絞り込みで使用）

### スプレッドシート構造

- **設定シート**: 現場名・作業員・下請け業者のマスタ一覧
- **日報シート**: 日付ごとに1列、作業員工数・経費・下請けを転記
  - 工場/事務所作業員列（上段）
  - 現場作業員列（下段）
  - 経費: 車両名・ガソリン走行距離・軽油走行距離・駐車場・高速・電車・ゴミ工場・ゴミ現場・ホテル・その他・接待費

## 重要な制約・注意点

- **CORS**: GASはCORSヘッダーを自由に設定できない。LIFFからのPOSTは `mode: 'no-cors'` + `Content-Type: text/plain` で対応。レスポンスは読めない（opaque response）
- **GETはJSONP不可**: `$fetch` でGET可能だが、エラー時はLIFF側でフォールバックデータを使用
- **デプロイ**: コードを変更しても「新しいデプロイ」または「デプロイを管理→バージョン更新」しないとWebApp URLに反映されない。`clasp push` だけでは不十分な場合あり
- **ログ**: `console.log` → GASの「実行数」から確認。または `Logger.log` + `clasp logs`

## LIFF ↔ GAS 連携仕様

### submitReport ペイロード
```json
{
  "action": "submitReport",
  "date": "2025-04-25",
  "sender": "田中太郎",
  "senderId": "Uxxxxxxxx",
  "sites": [
    {
      "siteName": "BLH名古屋",
      "workers": [
        { "workerName": "アリフ", "workerRole": "site", "days": 1.0, "overtime": 0 }
      ],
      "expenses": {
        "vehicle": "ハイエース",
        "distanceKm": 120,
        "dieselKm": 0,
        "parkingYen": 500,
        "highwayYen": 1200
      },
      "subcontractors": [
        { "subcontractorName": "VendorA", "count": 2 }
      ]
    }
  ],
  "note": "特記事項"
}
```

### getMaster レスポンス
```json
{
  "sites": ["BLH名古屋", "ギフト桜ステージ", ...],
  "workers": [
    { "name": "今井", "unitPrice": 30000, "role": "factory" },
    { "name": "アリフ", "unitPrice": 20000, "role": "site" }
  ],
  "subcontractors": ["VendorA", ...],
  "vehicles": ["ハイエース", ...]
}
```
