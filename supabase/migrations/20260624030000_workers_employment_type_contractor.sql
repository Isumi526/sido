-- ============================================================
--  雇用形態(employment_type)に 'contractor'(業務委託) を許可
--  既存 CHECK 制約 (fulltime/parttime のみ) を 'contractor' 込みに更新。
--  許可値を「広げる」だけ＝既存データ('fulltime'/'parttime')は影響なし・後方互換。
-- ============================================================
alter table workers drop constraint if exists workers_employment_type_check;
alter table workers add constraint workers_employment_type_check
  check (employment_type = any (array['fulltime'::text, 'parttime'::text, 'contractor'::text]));
