-- ============================================================
--  supabase/migrations/20260728000000
--  見積: 原価/客先の分離・粗利率の階層設定・自由記述の工種/分類ヘッダ
--
--  背景: 顧客の現行Excel（見積もり開発0603.xlsx・数式13,593件）を解析した結果、
--   入力の主動線が「原価側だけ入力 → 客先側は数式で生える」構造だった。
--     P列 単価原価 = XLOOKUP(項目名, 単価マスタ)
--     Q列 金額原価 = 数量 × 単価原価
--     I列 客先単価 = Y列（= 原価 ÷ (1 − 粗利率)）  ※既定は粗利20%
--     J列 客先金額 = 数量 × 客先単価
--   現行Webは単価が1本しか無く、原価と客先を分けられていない。
--
--  また Excel は粗利率を数式にハードコード（=X3/0.8）しており、
--  率を変えるには全行の数式を書き換えるしかない。ここをDBで持てるようにする。
--
--  Notion: 見積Q1(3aa0ff81c56b8156822bcf623b782ae4) / 見積Q2(3aa0ff81c56b81e7b7cff7c4f1201c49)
--  設計根拠: docs/spec/見積機能_業務フロー認識合わせ_20260727.md §1.9
--
--  追加のみDDL（後方互換・既存データに影響なし）
-- ============================================================

-- ── 明細: 原価単価（Excel P列）──
--  既存の unit_price は「客先単価」（Excel I列）として据え置く。
--  cost_unit_price が null の既存明細は、従来どおり客先単価のみで扱う。
alter table estimate_items add column if not exists cost_unit_price integer;

-- ── 明細: 工種の自由記述（Excel B列の「■軽鉄工事」等）──
--  既存の trade_id（固定マスタ）は残す。顧客要望は「自由記述＋入力を学習して
--  次回以降に候補表示・予測変換」なので、マスタ選択を強制しない列を足す。
alter table estimate_items add column if not exists trade_name text;

-- ── 明細: 行種別（分類ヘッダ行を明細と同じ表に差し込むため）──
--  Excel では （壁面工事）=部位、■軽鉄工事=工種 を明細行と同じ行に自由挿入している。
--  'item'=通常明細 / 'header'=分類見出し行（数量・単価を持たず金額集計から除外）
alter table estimate_items add column if not exists row_type text not null default 'item';

-- ── 粗利率: アカウント既定（Excel では数式にハードコードされていた 0.8 = 粗利20%）──
--  0〜1 未満の小数で「粗利率」を持つ。見積単価 = 原価 ÷ (1 − margin_rate)
alter table accounts add column if not exists default_margin_rate numeric(5,4) not null default 0.20;

-- ── 粗利率: 見積案件ごとの上書き（null = アカウント既定を使う）──
alter table estimate_projects add column if not exists margin_rate numeric(5,4);
