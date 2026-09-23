// ⚠️ AUTO-GENERATED from shared/work-category-primary.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/work-category-primary.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/work-category-primary.ts — 主系区分（現場の固定勤務時刻を使う区分）の特定（A-4・2026-09-20）
//  正本はここ。`npm run sync:shared` で admin / LIFF に配布する。
//  ★名前（'現場作業'）で特定しない。work_categories.uses_site_hours=true の行が主系。
//   フラグが1つも無いテナント（migration 前のキャッシュ等）だけ名前で fallback する。
// ============================================================
export type PrimaryCandidate = { id: string; name: string; usesSiteHours?: boolean | null; uses_site_hours?: boolean | null }

const LEGACY_PRIMARY_NAME = '現場作業'

/** 主系区分（無ければ null） */
export function primaryWorkCategory<T extends PrimaryCandidate>(list: readonly T[] | null | undefined): T | null {
  const arr = list ?? []
  const flagged = arr.find((c) => c.usesSiteHours === true || c.uses_site_hours === true)
  if (flagged) return flagged
  if (arr.some((c) => c.usesSiteHours != null || c.uses_site_hours != null)) {
    // フラグを持つデータなのに true が無い＝主系なし（名前では判定しない）
    return arr.find((c) => c.name === LEGACY_PRIMARY_NAME) ?? null
  }
  return arr.find((c) => c.name === LEGACY_PRIMARY_NAME) ?? null
}

export function isPrimaryWorkCategory<T extends PrimaryCandidate>(c: T, list: readonly T[] | null | undefined): boolean {
  const p = primaryWorkCategory(list)
  return !!p && p.id === c.id
}
