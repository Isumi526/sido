# GENLINKS 紹介用 LP（最小限・2026-09-27）

大塚さんが同業のオーナーに話す時の補足資料。設計書: Notion「設計：GENLINKS 紹介用 LP（最小限）」。

- 静的な 1 ページ（ビルド不要）。`index.html` と `img/`。
- 公開先: https://genlinks.app/（www は genlinks.app へ転送・仮の https://genlinks-lp.vercel.app/ も同じもの）— Vercel プロジェクト `stism/genlinks-lp`。**git 連携していない**（main に入れても自動デプロイされない）。
  出す時はこのフォルダを作業用の場所へコピーし、そこで `vercel link --project genlinks-lp --scope stism` → `vercel deploy --prod --scope stism`（リポジトリの中に `.vercel` を作らない）。
- 検索に載せない（`noindex`）。LINE で送った時の画像は `img/og.png`。
- アプリの画面は撮影用の架空の会社（株式会社サンプル内装・ローカル環境だけ）で撮ったもの。実際のお客様のデータは使わない。
