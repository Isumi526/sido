# 下請け業者の詳細登録・検索機能

Notion: 「下請け管理、検索機能 / 下請け業者の詳細登録・検索機能」（高）

## 背景・目的
下請け業者は作業員が個別に探して依頼しており、情報共有が口頭ベースで機会損失に
つながっている。業者情報を登録・共有し、他の作業員が検索・連絡できる仕組みを作る。

## 現状（着手時点）
- **DB層は構築済み**: `supabase/migrations/20260530000001_subcontractor_details.sql` が
  既に適用済み。`subcontractors` に詳細列（representative_name / mobile_phone /
  office_phone / email / service_areas[] / registered_by / is_deleted / deleted_by /
  deleted_at）、および `subcontractor_trade_types`・`trade_type_presets`（11プリセット投入済み）・
  `subcontractor_comments`・`subcontractor_edit_logs`（action: create/update/delete/restore/merge）を追加済み。
- **UI層は未着手**: 上記の詳細列・関連テーブルはどの画面にも露出していない。
  既存 `apps/admin/src/pages/subcontractors.vue` は name / category / unit_price のみのCRUD。

→ よって本機能は「UIの実装」が残作業。

## フェーズ分割
DBが揃っているため、自走テストしやすい admin から着手する。

- **Phase 1（admin・本ブランチ）**: 管理画面で業者の詳細を登録・編集・検索・論理削除/復元・
  編集履歴閲覧・重複マージができる。E2E は admin プロジェクトで自動起動・検証可能。
- **Phase 2（LIFF・別ユニット）**: 作業員が LIFF から登録・工種/エリア/フリーワード検索・
  コメント投稿・電話/メールのタップ連絡を行える。コメント本人制限・編集ログ記録もここで。

## 対応エリアの扱い（仕様の未決定事項への対応）
Notion の「未決定事項：対応エリアの具体的な選択肢」について、本実装では
**自由入力タグ方式**を採用する（admin Phase 1）。工種の「プリセット＋自由追加」と
同じ思想で、エリアは text[] に自由なタグを積む。LIFF（Phase 2）で検索 UX 向上のため
都道府県プリセットの datalist 補助を追加する想定。**業務側でエリアの確定リストが必要に
なった場合に再検討**（この前提は本ドキュメントに明記し、決め打ちしない）。

---

## Phase 1（admin）要件

### ユーザーストーリー
管理者として、下請け業者の詳細情報（連絡先・工種・対応エリア）を登録・編集し、
工種/エリア/フリーワードで検索でき、誤登録は論理削除して必要なら復元でき、
重複業者をマージでき、編集履歴を確認できる。これにより業者情報を一元管理できる。

### 受け入れ条件（AC）
- **AC1 詳細編集**: 業者の編集モーダルで 代表者名・代表者携帯・会社電話・メール・
  対応エリア（タグ）・工種（プリセットから複数選択＋自由追加）を登録・更新できる。
  保存すると一覧・詳細に反映される。
- **AC2 検索/絞り込み**: 一覧上部で フリーワード（業者名/代表者名）・工種・対応エリアで
  絞り込める。複数条件は AND。
- **AC3 論理削除/復元**: 業者を論理削除（is_deleted=true）でき、既定では一覧から消える。
  「削除済みを表示」トグルで削除済みを表示し、復元できる。
- **AC4 編集履歴**: 各業者の編集履歴（create/update/delete/restore/merge と日時）を
  詳細から確認できる。更新・削除・復元・マージ時に `subcontractor_edit_logs` に記録する。
- **AC5 重複マージ**: 同名/類似の2業者を選び、一方へ統合（詳細列は統合先優先で欠損のみ補完、
  工種は和集合、コメント・請求は統合先へ付け替え）し、もう一方を論理削除する。マージを履歴記録する。

### スコープ（Phase 1）
- `apps/admin/src/pages/subcontractors.vue` を拡張（詳細フィールド・検索・削除/復元・履歴・マージ）。
- 編集ログ書き込みは admin の操作者（worker）で記録。admin 操作者の worker_id 取得は
  既存の account/auth から解決（取得できない場合は null 許容）。
- DB マイグレーションは新規不要（既存列を使用）。

### スコープ外（Phase 1）
- LIFF 作業員向け UI（Phase 2）。
- コメントの投稿/本人制限（コメントは LIFF 起点のため Phase 2。admin では参照のみ可とする）。

### E2E（admin プロジェクト）
`tests/e2e/admin.subcontractor-detail.spec.ts`
- AC1: 業者追加→詳細（代表者名・エリア・工種）編集→一覧/詳細に反映。
- AC2: 工種で絞り込み→該当のみ表示。
- AC3: 論理削除→一覧から消える→削除済み表示で復元。
- （AC4/AC5 は UI 経由のスモークで確認。詳細は手動/Phase 2 で補強）
- 後始末: REST で作成した業者・関連行を削除。

---

## Phase 2（LIFF 作業員）実装完了（2026-06-10）

`apps/liff/pages/subcontractors/index.vue` を新設。ホーム（メニューグリッド）と
ドロワー（AppNav）に「下請け業者」導線を追加。

### 実装した受け入れ条件
- **登録/編集**: 業者名・区分・代表者名・代表者携帯・会社電話・メール・対応エリア（タグ）・
  工種（プリセット11種＋自由追加）を登録/更新。create/update を `subcontractor_edit_logs`
  に記録（`edited_by` = 作業員 worker_id）。新規は `registered_by`、削除は `deleted_by` を付与。
- **検索**: フリーワード（業者名/代表者名）・工種・対応エリアで AND 絞り込み（admin と同ロジック）。
- **論理削除**: `is_deleted=true`。一覧から消える。**復元は管理者のみ**（admin Phase 1 のまま、
  LIFF には復元 UI を出さない＝決定事項どおり）。
- **コメント**: `subcontractor_comments` に投稿・本人のみ編集/削除（`worker_id` で本人判定）・
  他作業員のコメントは参照可。
- **タップ連絡**: 電話は `tel:`、メールは `mailto:` のネイティブ連携。
- **対応エリア**: 自由入力タグ＋都道府県 datalist 補助（検索 UX 向上）。

### E2E
`tests/e2e/liff.subcontractors.spec.ts`（liff プロジェクト・dev モード, Worker 01）
- AC1 登録→一覧反映 / AC2 フリーワード・工種・エリア絞り込み / AC3 編集→反映 /
  AC4 コメント投稿・本人編集/削除 / AC5 電話/メールのタップ連絡リンク / AC6 論理削除→一覧から消える。
- 全 6 件緑。liff 本番 build 成功。後始末は REST で作成業者・関連行を削除。

→ Phase 1（admin）・Phase 2（LIFF）ともに完了。タスク「下請け管理、検索機能」は本番待ち。
