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

### ブランチ運用（A+運用：main一本デプロイ + dev はPC間同期用）

- **テストはローカル**（`npm run dev`）で行う。Preview URL は使わない。
- **`main` に push したときだけ** Vercel 本番デプロイが走る。
- **`dev` は「PC跨ぎの作業途中を同期する場所」**。Vercel のデプロイは無効化済み
  （各アプリの `vercel.json` に `git.deploymentEnabled.dev = false`）なので、
  dev に何回 push してもビルドは走らない＝本番に一切影響しない。

```bash
# ── 普段の開発（1台で完結する場合）──
# ローカルで編集・確認 → 完成したら main に直接 push
git add -A && git commit -m "..."
git push origin main          # ← ここで本番デプロイ1本だけ走る

# ── PCを跨いで作業途中を持ち越す場合 ──
# PC-A: 作業途中を dev に退避（デプロイ走らない）
git checkout dev && git merge main   # or 直接 dev で作業
git push origin dev
# PC-B: 続きを取得
git checkout dev && git pull origin dev
# 完成したら main にマージして本番へ
git checkout main && git merge dev
git push origin main          # ← ここで初めて本番デプロイ
```

※ Vercel は Hobby プランで同時ビルド1本。短時間に何度も push するとキューが詰まる
　ことがあるので「まとめて1回 push」が安全。

### 作業を巻き戻したい場合
```bash
# main を戻したいコミットに巻き戻し（事前に git log でハッシュ確認）
git checkout main
git reset --hard <戻したいコミットハッシュ>
git push origin main --force
```

## Phase別ロードマップ
- Phase 1 ✅ LINE日報→GAS自動転記・Gemini正規化・各種機能
- Phase 1.5 ✅ LINE LIFFフォーム（Nuxt3）・LIFF→GAS連携・Supabase・管理画面
- Phase 2 予定: 月次集計レポート・経費PDF自動生成
- Phase 3 予定: 複数テナント展開
