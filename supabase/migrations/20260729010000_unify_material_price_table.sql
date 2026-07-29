-- ============================================================
--  supabase/migrations/20260729010000
--  見積R28: 材料マスタを廃止し、商社単価表に一本化する（第1段: 単価表を自己完結させる）
--
--  背景（2026-07-29 ユーザー通しレビュー・第3回）:
--   「材料マスターを廃止し、商社単価表に一本化」
--   材料マスタ(estimate_materials)は明細を保存するたびに自動登録される作りで、
--   作業内容（壁面外周LGS間仕切り等＝商品ではないもの）まで材料として溜まっていた。
--   管理する場所が2つある状態も含めて整理する。
--
--  ★なぜ単価表側に列を足すのか
--   estimate_material_prices は品名も品番も持たず、必ず material_id を辿って
--   材料マスタから表示していた（estimate-masters.vue の単価一覧）。
--   このままでは材料マスタを外せない。単価表が自分で名乗れるようにするのが先。
--   取込差分(estimate_price_revisions)は既に code/name/unit を自前で持っているので、
--   その列構成をそのまま単価表へ持ち込む形にする。
--
--  ★material_id は消さずに残す
--   estimate_items.material_id は FK(RESTRICT) で既存データが繋がっている。
--   ここで消すと過去の見積が壊れる。新規で作らなくするだけにして、
--   既存の紐付けはそのまま生かす（段階的移行）。
--
--  Notion: R28
--  追加のみDDL（後方互換・既存データに影響なし）
-- ============================================================

-- ── 単価表が自分で品番・品名・単位を持つ（材料マスタを辿らなくても表示できる）──
alter table estimate_material_prices add column if not exists product_code text;
alter table estimate_material_prices add column if not exists item_name    text;
alter table estimate_material_prices add column if not exists unit         text;

-- ★material_id は新規登録では使わなくなるので null を許す。
--   （既存行の値はそのまま残す＝過去の紐付けを壊さない）
alter table estimate_material_prices alter column material_id drop not null;

-- ── 既存の単価行に、材料マスタから品番・品名・単位を写す（表示が消えないように）──
update estimate_material_prices p
set product_code = coalesce(p.product_code, m.code),
    item_name    = coalesce(p.item_name, m.name),
    unit         = coalesce(p.unit, m.unit)
from estimate_materials m
where m.id = p.material_id
  and (p.product_code is null or p.item_name is null or p.unit is null);

-- 品番・品名からの逆引き（候補表示と名寄せで使う）
create index if not exists est_mat_prices_code_idx on estimate_material_prices(account_id, product_code);
create index if not exists est_mat_prices_name_idx on estimate_material_prices(account_id, item_name);

-- ── 取込差分にも「どのファイルから来たか」を実際に記録する ──
--  source_file は定義だけで未使用だった。一括承認の単位（この取込ぶんをまとめて承認）と、
--  商社名の推測材料（ファイル名に商社名が入っていることが多い）に使う。
comment on column estimate_price_revisions.source_file is
  '取込元のファイル名。一括承認の単位と商社名の推測に使う（R28）';
