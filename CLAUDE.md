# プロジェクト 引き継ぎ & 運用ルール

## プロジェクト概要
内装施工会社向け 施工台帳自動化システム

## リポジトリ構成
```
/
├── apps/
│   ├── liff/          # LINE LIFF 日報入力フォーム（Nuxt3 / Vercel）
│   └── admin/         # 管理画面（Vite + Vue3 / Vercel）
├── packages/
├── supabase/
└── CLAUDE.md
```

## 技術スタック
- フロントエンド: Nuxt3 + Vue3 + TypeScript / Vercel
- 認証: LINE LIFF SDK
- バックエンド: Google Apps Script (GAS) / clasp管理
- DB: Supabase

## GAS開発フロー
```bash
cd apps/gas && clasp push
# デプロイはGASエディタで新バージョン作成
```

## ローカル開発フロー

```bash
# LIFF
cd apps/liff && npm run dev
# → http://localhost:3000 で確認（LIFF認証スキップ・テスターユーザーで動作）

# 管理画面
cd apps/admin && npm run dev
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
- Phase 1.5 ✅ LINE LIFFフォーム（Nuxt3）・LIFF→GAS連携・Supabase・管理画面
- Phase 2 予定: 月次集計レポート・経費PDF自動生成
- Phase 3 予定: 複数テナント展開
