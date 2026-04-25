***REMOVED***

Sample Construction Co.の施工台帳自動化システム

## プロジェクト構成

```
construction-field-report/
├── apps/
│   ├── liff/          # LINE LIFF 日報入力フォーム（Nuxt3）
│   └── admin/         # 管理画面（今後開発予定）
├── packages/
│   ├── types/         # 共通型定義（TypeScript）
│   └── utils/         # 共通ユーティリティ関数
├── supabase/
│   └── migrations/    # DBマイグレーション（今後追加予定）
└── docs/              # 設計ドキュメント
```

## 技術スタック

| 役割 | 技術 |
|------|------|
| フロントエンド | Nuxt3 + Vue3 + TypeScript |
| ホスティング | Vercel |
| 認証 | LINE LIFF |
| バックエンド（現在）| Google Apps Script |
| バックエンド（予定）| Supabase |
| 通知 | LINE Messaging API |

## ロードマップ

### Phase 1（現在）✅
- LIFF日報入力フォーム
- GAS経由でスプシ転記 + LINE通知

### Phase 2（次）
- Supabaseへのデータ保存
- マスタデータのDB管理化（現場・作業員・業者）
- 月次集計・レポート自動生成

### Phase 3（将来）
- 管理画面（`apps/admin`）
- 複数テナント対応（他社展開）
- 請求書管理との統合

## セットアップ

### LIFF アプリ

```bash
cd apps/liff
cp .env.example .env.local
# .env.local を編集して各種IDを設定

npm install
npm run dev
```

### 必要な環境変数

| 変数名 | 説明 |
|--------|------|
| `NUXT_PUBLIC_LIFF_ID` | LINE DevelopersのLIFF ID |
| `NUXT_PUBLIC_GAS_URL` | GAS WebhookのデプロイURL |
| `NUXT_PUBLIC_APP_ENV` | `development` or `production` |

## デプロイ

```bash
# Vercelにデプロイ（apps/liff をルートとして設定）
cd apps/liff
npx vercel --prod
```

Vercel Dashboard で以下の環境変数を設定：
- `NUXT_PUBLIC_LIFF_ID`
- `NUXT_PUBLIC_GAS_URL`
- `NUXT_PUBLIC_APP_ENV=production`
***REMOVED***
