# Construction Project プロジェクト 引き継ぎ & 運用ルール

## プロジェクト概要
Sample Construction Co.向け 施工台帳自動化システム

## リポジトリ構成
construction-field-report/
├── apps/
│   ├── liff/          # LINE LIFF 日報入力フォーム（Nuxt3 / Vercel）
│   └── admin/         # 管理画面（未着手）
├── packages/
├── supabase/
├── notion-sync.js     # Notion自動連携スクリプト
└── CLAUDE.md

## 技術スタック
- フロントエンド: Nuxt3 + Vue3 + TypeScript / Vercel
- 認証: LINE LIFF SDK
- バックエンド: Google Apps Script (GAS) / clasp管理
- DB予定: Supabase

## GAS開発フロー
```bash
cd apps/gas && clasp push
# デプロイはGASエディタで新バージョン作成
```

## 🔄 Notion自動連携ルール（必ず守ること）

### セットアップ（初回のみ）
```bash
export NOTION_API_KEY="secret_xxxxxxxxxxxx"
echo 'export NOTION_API_KEY="secret_xxxxxxxxxxxx"' >> ~/.zshrc
source ~/.zshrc
```

### タスク完了時は必ずNotionに登録する
```bash
# 基本（Sample Construction Co.・完了）
node notion-sync.js "やったこと" --memo "詳細"

# ステータス指定
node notion-sync.js "作業中の機能" --status 進行中

# 全力AIラボ案件
node notion-sync.js "やったこと" --project ailab --memo "詳細"
```

### 登録タイミング
- 機能実装完了 → 完了
- clasp push & デプロイ完了 → 完了
- 着手したが中断 → 進行中

## Notion DB情報
- タスクDB ID: REMOVED_NOTION_DB_ID
- Sample Construction Co.: REMOVED_NOTION_PROJECT_ID
- 全力AIラボ: REMOVED_NOTION_AILAB_ID

## ローカル開発フロー

```bash
# ローカルで起動
cd apps/liff && npm run dev
# → http://localhost:3000 で確認（LIFF認証スキップ・テスターユーザーで動作）
```

### ブランチ運用（本番に影響させない）
```bash
# 開発は dev ブランチで行う
git checkout dev

# 本番に出す準備ができたら main にマージ
git checkout main
git merge dev
git push origin main
```

- `main` に push → Vercel 本番に自動デプロイ
- `dev` に push → Vercel Preview URL のみ（本番に影響なし）

### 今日の作業を巻き戻したい場合
```bash
# 1. 今の状態を dev に保存
git checkout -b dev
git push origin dev

# 2. main を戻したいコミットに巻き戻し
git checkout main
git reset --hard <戻したいコミットハッシュ>
git push origin main --force
```

## Phase別ロードマップ
- Phase 1 ✅ LINE日報→GAS自動転記・Gemini正規化・各種機能
- Phase 1.5 🔄 LINE LIFFフォーム（Nuxt3）・LIFF→GAS連携
- Phase 2 予定: Supabase・管理画面
