# /run — 自走 ＋ 全自動テストゲート ＋ ディスパッチャ（統合版）

> **更新履歴**
> - 2026-06-14 統合再設計：自走ループ＋自動テストゲート（動的検出）＋ディスパッチャを1本に集約。
>   旧 `--advance` / `AUTO_ADVANCE` 分岐、および過去改訂の dangling 参照を削除。handoff（ship.md / next.md）は不変。

CLAUDE.md「自走ポリシー」に従い、**自プロジェクト（`.env` の `BACKLOG_PROJECT_ID`＝案件 relation で絞った page_id のみ）**のバックログを、毎ループ最優先の1件ずつ **実装→自動テストゲート→レビュー待ち** へ進める単一ループ。**キュー枯渇まで自走**（残予算では止めない）。技術・手続き判断は既定ポリシーで自決し、**人間の業務判断だけ要回答にパーク**（止まらず次へ）。**唯一の人間ゲートは本番反映（push / deploy / ship）**。run 末尾で**ディスパッチャ**が「決断の瞬間」だけ通知する。

- 前提資産: バックログ data_source `a7f5a28f-22af-4bc1-a512-4d427a934f31`（Notion-Version `2025-09-03`）。
  ステータス: 未整理→要回答→要件定義済み→進行中→レビュー待ち→本番待ち→完了（＋保留）。
  プロパティ: `優先順位`(緊急/高/中/低) / `リスク`(🔴高/🟡中/🟢低 Select) / `土台`(Checkbox) / `案件名`(relation) / `エピック`(=shipグループ Select)。

引数: `$ARGUMENTS`
- `--dry-run` … 盤面と各件の遷移予定・各ゲートの実行有無・ディスパッチャ通知予定を提示のみ（Notion更新・コード変更・通知・ブランチ・migration適用・テスト実行を一切しない）。副作用ゼロ。
- `--max-items=N` / `--max-minutes=M` … **残置（通常停止には使わない）**。デバッグ用に手動で区切りたい時だけ。
- 通常停止は「キュー枯渇」、回路遮断は `MAX_WALL=180分` と「連続前進ゼロ K=3」のみ（§4/§5）。

人ボール/承認の文面は CLAUDE.md「人ボール報告の必須フォーマット（結論ファースト）」に従う。

---

## /run 統合フロー（自 page_id 内・キュー枯渇まで）

### 0. 自己修復（ループ前に1回）
自案件で「🤖AI実行中」タグが残っているものを全部外す（前回クラッシュの取り残し）。`--dry-run` は列挙のみ。

### 0.5 プリフライト（検証で使う dev/stack が local 接続か assert）
E2E/DB検証を使う前に**毎回**、起動中の dev/stack が **local 接続**かを確認する：配信 anon key == local の `sb_publishable…` か。`eyJ…`＝本番JWT を検出したら**検証を止め**、`.env.local` で **local 起動/再起動**してから回す。**本番に対して E2E を絶対に走らせない**（本番データ汚染・破壊防止）。
例: `curl -s localhost:3000/ | grep -oE 'sb_publishable_[A-Za-z0-9]{6}|eyJ[A-Za-z0-9]{6}'` が cloud なら停止→`supabase start` / `npm run dev`（local）で起動。Docker が落ちていれば起動する。聞かない。

### 1. 進行中（再開可能なCC痕跡あり）を先に完了
featureブランチ/設計書/🤖タグ のいずれかがある進行中を再開：実装→自動テストゲート(§3b)→devマージ→レビュー待ち(§3d)。痕跡が無い＝人手の進行中は触らない。

### 2. 未整理の棚卸し（速い・実装しない）
各件を判定し、1件処理ごとに盤面先頭へ戻る：
- **(a) 業務判断が必要**（業務ルール/要件が曖昧・本文が空/不足）→ **要回答**化（A/B/C＋推奨）し**パーク**、止まらず次へ。
- **(b) 要件化可能** → 薄いストーリー＋AC＋scope を書き、**優先度**を付与して **要件定義済み**。

### 3. 要件定義済みを実装（優先 緊急>高>中>低、同率は作成古い順）
1件取り、`進行中`＋🤖タグにして：
- **a. 実装**：既存パターン（近い画面/関数/テスト）に準拠。タスクに「**決定と理由**」を1行記録。追加のみDDL（ADD COLUMN/CREATE TABLE/CREATE INDEX 等）は **作成＋local適用**（`db reset` 等）。**本番適用はしない**。
- **b. 【自動テストゲート】今存在する自動テストを“全部”通す（動的検出・ハードコードしない／§テストゲート参照）**。緑でなければ **blocked**（ステータス=保留＋失敗内容を記録・🤖外す）→ 次へ（run 全体は止めない）。
- **c. preview/staging が構成済みなら**そこへデプロイし同じスイートを再実行（**無ければスキップ**）。
- **c'. 【独立AIレビュー（自動テストゲート緑の後・レビュー待ち昇格の直前に1回）】**：`node scripts/independent-review.mjs --ticket-id <pageId> --ticket-file <要件md>` を実行（Claude非依存の Gemini が `.kody/rules/` ＋ チケット要件で diff をレビュー）。**findings サマリ（🔴critical/high・verdict）を d の 📋ダイジェストに含める**。**🔴critical があれば対象チケットに「要人間verdict」フラグ**（スクリプトが Notion callout＋通知）。`GEMINI_REVIEW_API_KEY` 未設定なら**そのアイテムは独立レビューをスキップした旨を📋に明記**（gate扱いにはしない＝blockしない）。**/run が `--dry-run` の時は `independent-review.mjs` も `--dry-run`** で呼ぶ（Notion更新せず標準出力のみ）。
- **d. 全緑で昇格**：`リスク`(🔴/🟡/🟢 Select) と `土台`(該当 Checkbox=true) を**プロパティに直接セット**し、本文に **📋レビューダイジェスト**（§ダイジェスト・**c' の独立レビュー結果を含む**）を書いて、ステータス=**レビュー待ち**・🤖外す。🔴critical の「要人間verdict」フラグは **§6 ディスパッチャが既存どおり拾う**。
- **e. 本番に触れない**。dev 未push前提で積む。**review→本番待ち昇格はしない**（人間が行う）。

### 4. 主停止（枯渇＝正常終了）
**未整理=0 かつ 要件定義済みに「実装可能な残り」が無い**（全件が レビュー待ち / 本番待ち / 要回答 / blocked(保留) / 完了 に収束）まで回り切る。**レビュー待ち・本番待ちは何件溜まっても停止理由にしない**。

### 5. バックストップ（異常時のみ・回路遮断）
**連続前進ゼロ K=3**（3連続 blocked 等）／**壁時計 MAX_WALL=180分**／**プラン枠で落ちた** 時のみ安全停止。停止時は**枯渇か異常かを明記**。API課金へ勝手に流れる動作はしない。

### 6. ディスパッチャ自動発火（フロー最後に1回・枯渇/バックストップ どちらで止まっても）
停止理由（枯渇 or 異常）に関わらず、**フローの最後に `node scripts/dispatcher.mjs`（非dry-run）を1回だけ呼ぶ**。
- 二重起動は **flock でガード済み**（手動実行や別 /run と被っても安全＝後発は即終了）。
- **delta-only**：プルーン＋dedup により、**新規トランジションが無ければ無音**（送信ゼロ）。新しくレビュー待ち/要回答に入った分・差し戻し再入だけが通知される。
- `--dry-run` 時はディスパッチャも `--dry-run` で呼ぶ（送信・state更新なし・発火予定のみ表示）。

```
selfHeal()                                    # 0
preflightAssertLocal()                        # 0.5（検証を使う前に毎回）
finishResumableInProgress()                   # 1
groomInbox()                                  # 2 : (a)要回答パーク / (b)要件化
noProgress = 0
while implementableReady():                   # 3 / 4(枯渇で抜ける)
    if elapsed()>=MAX_WALL(180m) or noProgress>=3: break        # 5
    item = top(緊急>高>中>低, 同率は作成古い順)
    setInProgress(item)+🤖
    implement(item)                           # 3a（決定理由1行・追加DDLはlocal適用）
    if needsBizDecision: parkAsAnswer(A/B/C+推奨); notify; 🤖外す; noProgress=0; continue
    if !runAllAutoGates(item):                # 3b 動的検出・全部実行
        block(item, failLog); 🤖外す; noProgress+=1; continue
    if previewConfigured(): deployPreview(); runAllAutoGates(item, onPreview)   # 3c（無ければskip）
    setRiskProp(item); setDodaiProp(item); writeReviewDigest(item)              # 3d プロパティ＆📋
    setReviewWaiting(item); 🤖外す; noProgress=0
run(`node scripts/dispatcher.mjs`)            # 6 末尾で1回・非dry（flockガード済・delta-only＝新規なければ無音）
report(枯渇 or 異常 / 盤面 / レビュー待ち(🔴🟡🟢・🧱土台) / blocked / 要回答パーク / 本番ゲート待ち)
```

---

## 自動テストゲートの動的検出（ハードコードしない＝有るものを全部）
**特定のテストを名指ししない。実在するゲートを毎回スキャンして全実行**する。将来 ビジュアル/メール・LINE検証/synthetic が足されても、命名規約に沿えば**自動で取り込まれる**。

検出順（存在するものだけ実行・無ければskip）:
1. **typecheck / build**: 各 `apps/*/package.json` と root の scripts から `typecheck` / `build` を実行（vue-tsc / vite build / nuxt typecheck 等が有れば）。
2. **テストscript**: root と `apps/*` の `package.json` scripts のうち **`/^test/` に一致するもの全部**（`test`, `test:e2e`, `test:unit`, 将来の `test:visual` / `test:email` / `test:synthetic` 等）を実行。
3. **Playwright**: `playwright.config.*` があれば、定義された **projects を全部**（`--project=admin` `--project=liff` …）。関係する spec は特に緑を明示。
4. 検証が DB/E2E を要するものは **§0.5 プリフライトで local を保証**してから実行。
- いずれかが緑でない → そのアイテムは **blocked**（§3b）。落ちた script 名と要約を記録。
- 「3回直しても緑にできない」ものも blocked（サイズの問題ではない＝失敗）。

---

## 📋 レビューダイジェスト（レビュー待ちへ移す時＝必須）
当該ページに**必ず**以下を書く（既存 reviewer note は置き換える）。バッチレビュー成立のための情報。

### 1. 本文に「📋レビューダイジェスト」callout
- **変更概要**(1〜2行・何を/どこに) / **リスク根拠** / **依存**（土台: 後続の件名・page_id ／ 乗っかり先行: 既マージ依存元） / **手動確認点**（E2Eで拾えない所だけ＝英語表現/UX/通知本文/金額表示 等） / **推奨shipグループ**（= `エピック`）。
### 2. プロパティに直接セット（タグ/本文では代替しない）
- **`リスク`(Select)** = 🔴高 / 🟡中 / 🟢低（基準: **高**=schema/migration・共有util・データモデル・認証/RLS・課金・外部送信／**中**=複数画面・複数ファイルの機能追加／**低**=自己完結UI・文言・単一トグル）。
- **`土台`(Checkbox)** = 後続の未着手/要件定義済みが依存するなら true。
### 3. 土台は「都度レビュー推奨」
- `土台`=true は通知＆サマリに「⚠️これは土台（後続N件依存）。早めにレビュー推奨」を1行。

---

## ディスパッチャ（決断の瞬間だけ通知）
- **`scripts/dispatcher.mjs`** に独立実装。/run 末尾から呼ぶ＋**単体実行も可**（`node scripts/dispatcher.mjs [--dry-run]`）。
- 判定材料は既存プロパティのみ（ステータス/リスク/土台/優先度/案件/エピック）。配信は既存 LINE human-in-the-loop（`notify-humanball.mjs`／本番ゲートも通知。PRマージ承認とは別 kind・別文面で混線させない）。
- **dedup 必須**：`scripts/.dispatcher-state.json`（git管理外）に「通知済キー＝page_id:trigger:状態スナップショット」を保存。状態が変わらない限り**再送しない**。**per-item スパム禁止＝1ダイジェストに集約**（土台の即時のみ個別）。
- **緩急**: 🧱土台/🔴=即時、🟡/🟢=バッチ。

トリガー:
1. **🧱土台がレビュー待ち入り** →【即】「🧱土台『X』レビュー待ち・後続N件依存・今レビュー推奨」。
2. **レビューバッチ準備**（土台以外のレビュー待ちが閾値超 or 🔴≥3 or 定例）→「レビュー可: 🔴a/🟡b/🟢c、要対応ビューへ」。
3. **shipウィンドウ**：あるエピックの該当が**全て本番待ち** かつ env前提充足 →「shipクラスタ『○○』準備OK（M件・env✓）push/ship可」。
   - env前提＝各ダイジェストの「env前提」記載を本番で **presence check**（取得不能/不足なら**不足項目を明示**して env✗）。
4. **要回答（業務判断）** → まとめて「判断待ちN件: ①…②…（A/B/C＋推奨）」。
5. **異常/停止** →「drain停止: 理由・残件」。

```
# dispatcher.mjs（擬似コード）
rows = queryDataSource(案件=BACKLOG_PROJECT_ID)            # 2025-09-03 / data_source a7f5...
state = load('.dispatcher-state.json')                     # 既通知キー
review = rows.where(status==レビュー待ち)
# 1) 土台×レビュー待ち（即時・個別）
for it in review.where(土台==true):
    k = key(it,'dodai'); if k not in state: notify(即,『🧱土台「it.name」…後続依存…今レビュー推奨』); state.add(k)
# 2) レビューバッチ（土台以外）
leaf = review.where(土台==false)
if leaf.count>=THRESH or leaf.where(risk==🔴).count>=3:
    k = batchKey(leaf); if k not in state: notify(バッチ,『レビュー可 🔴a/🟡b/🟢c』); state.add(k)
# 3) shipウィンドウ（エピック単位）
for epic, items in rows.groupBy(エピック):
    actionable = items.where(status in [本番待ち,レビュー待ち,進行中,...])  # 完了/保留除く
    if actionable.nonEmpty and actionable.all(status==本番待ち):
        env = presenceCheckProdEnv(digestEnvOf(items))     # 不足なら✗＋項目
        k = shipKey(epic,items); if k not in state: notify(ship,『shipクラスタ epic 準備OK M件 env{✓/✗:...}』); state.add(k)
# 4) 要回答（まとめて1通）
ans = rows.where(status==要回答); if changed(ans, state): notify(まとめ,『判断待ちN件 ①…②… A/B/C+推奨』)
# 5) 異常停止（run から理由を受けて）
if stopReason==異常: notify(『drain停止: 理由・残件』)
save(state)
```

---

## 唯一の人間ゲート
- **本番反映（remote push / 本番デプロイ / ship）のみ**。CCは明示OKまで実行しない。
- **review→本番待ち 昇格も人間**（CCは昇格させない）。`ship.md` は従来どおり **本番待ち のみ**拾う（未レビューは構造上拾えない）。
- それ以外（実装・local検証・migrationのlocal適用・devマージ・レビュー待ち移動）は自走でOK。dev は未push・本番影響なし前提で自由に積む（`vercel.json` で dev デプロイ無効）。

## 自走ポリシー（聞かない・自決して記録）
- **検証環境**: ローカルスタック（Docker/`supabase start`）を自分で起動。落ちていたら起動（§0.5）。
- **技術選定/スコープ**: 既存パターン準拠＋「決定と理由」1行記録。
- **要件の曖昧さ**: 設計メモ・既存コードから意図が一意なら (b) 確定。一意に決まらない**業務判断だけ**要回答（A/B/C＋推奨）。

## 冪等・安全
- 各フェーズは前段完了分だけ前進。1ループで同一 page_id を二度処理しない。自 page_id 以外は対象外。
- ゲート/終端（要回答・レビュー待ち・本番待ち・保留・完了）は触らない・**ディスパッチャも dedup で再通知しない**。
- 破壊的操作（ファイル削除等）は実行前に確認。**自分の生成物でない残骸（macOS " 2" 複製等）は触らない**。本番DB削除は人間ゲート。
- 課金: プラン枠で落ちる前提。勝手に API 課金へ流れる動作はしない。

## DRY_RUN 動作確認手順（副作用ゼロ）
1. 未整理を数件置く（材料十分な1件・本文空/曖昧な1件）。要件定義済みも数件（緊急/高/低・1件は `土台`=true）。
2. `/run --dry-run` → 盤面と「(b)→要件化／(a)→要回答」「要件定義済み→実装→**自動ゲート実行予定の一覧**→レビュー待ち」の遷移予定、付与予定の リスク/土台、**ディスパッチャが出す予定の通知**（土台即時／レビューバッチ／ship／要回答）を提示。Notion/コード/通知/テストは一切実行しない。
3. `node scripts/dispatcher.mjs --dry-run` → 現盤面から各トリガーの発火予定だけ列挙（送信しない・state更新しない）。
4. 実行（flagなし）で、数件がレビュー待ちに積まれ・🔴/🧱土台に対し**即時通知**、🟢leaf は**バッチ**に溜まることを確認。再 `/run` で**再通知されない**（dedup）ことを確認。

## 通知（フロー2：既存 LINE human-in-the-loop に1通）
この実行でそのゲートに“入れた”時だけ1通（既存パーク分は再通知しない）。本番ゲート（push/ship待ち）も通知。PRマージ承認（`ship承認`）とは別 kind・別文面で混線させない。
```bash
node scripts/notify-humanball.mjs --kind 要回答     --task "<タスク名>" --detail "<A/B/C＋推奨を1〜2行>" [--url "<session>"]
node scripts/notify-humanball.mjs --kind レビュー待ち --task "<タスク名>" --detail "実装完了・devマージ済み。<リスク/土台>。<PR/ブランチ>" [--url "<session>"]
# ディスパッチャは scripts/dispatcher.mjs が上記スクリプト経由で配信（kind: 土台/レビュー可/shipクラスタ/判断待ち/drain停止）
```

## 厳守
- 本番反映（push / deploy / db push / ship）は人間の明示OKまで実行しない。review→本番待ち昇格もしない。それ以外は自走。
- 人ボール化（要回答）は人の回答まで再着手しない（同じ問いでループしない）。
- リスク/土台は必ず **Select/Checkbox プロパティ値**に入れる（本文・独自タグで代替しない）。
- 「🤖AI実行中」タグは着手で付け、レビュー待ち/要回答/blocked/中断で必ず外す。原則同時1件。
- `--dry-run` は副作用ゼロ。いつでも中断可能。
