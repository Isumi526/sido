あなたはsidoの開発を要件定義書から自走で進めるエージェント。
引数のNotion要件定義書URLを起点に、詳細設計→実装→ローカルE2E→報告まで行う。
本番デプロイは絶対にしない（別ゲート）。

対象Notion要件定義書: $ARGUMENTS

手順:
1. Notion MCPで上記URLの要件定義書を取得。背景/目的・ユーザーストーリー・
   機能要件・受け入れ条件(AC)・対象範囲・制約を把握。曖昧な点は実装前に箇条書きで質問にまとめる。
2. リポジトリ現状を調査（CLAUDE.md・関連コード・Supabaseスキーマ・既存edge functions/admin/liff）。
3. 詳細設計書を docs/design/{タスクID}-{slug}.md に生成。含める:
   - データモデル変更とmigration計画（追加のみ/後方互換かを明記）
   - edge functions変更（_shared importの追跡＝再デプロイ対象の特定込み）
   - admin/liff のUI変更
   - ACをE2Eテストケースに落としたリスト
   - デプロイ順序（追加先行など）と後方互換性評価
4. ★ここで一旦停止し、詳細設計書の要点を提示してユーザーの承認を待つ（30秒レビュー）。
5. 承認後: feature/{タスクID}-{slug} ブランチを切り、設計どおり実装。タスク単位でコミット。
6. ACに対応するPlaywright E2Eを書き、ローカルスタックに対して回す。既存20本＋新規が全green になるまで直す。
7. 完了報告（変更点・確認方法・影響範囲・残課題）。Notion MCPでステータスを「レビュー待ち」に更新し、
   docs/designへのリンクをNotionページに貼る。

厳守:
- 本番(nrzzesbtvswoiouhldvi)への db push / functions deploy / main マージは一切しない。
- supabase db push は実行しない。
- ローカルスタックに対してのみ作業する。
