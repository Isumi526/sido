// ============================================================
//  shared/vendor-name.ts  ★単一ソース（admin / EF 共有）
//  協力業者（下請け・商社）の社名の名寄せ（2026-09-04 尾崎さん報告 → 2026-09-20 集計側にも適用）
//
//  ★なぜ: 協力業者マスタは `(株)◯◯` `株式会社◯◯` `㈱◯◯` `◯◯` が混在し（本番 21組45件の重複）、
//   日報の協力業者・請求書の業者名は**名前の文字列**でマスタと結ばれている（日報の subcontractorId は
//   直近90日の309エントリ全てで空・2026-09-05 実測）。完全一致で引くと、表記が違う業者は
//   現場別集計・月次集計から丸ごと落ちる／同じ会社が2行に割れる。
//  ★マスタの社名を `㈱` に統一する（尾崎さん回答 2026-09-05）**前に**この名寄せを集計側へ入れる。
//   入れずに改名すると、過去の日報（`(株)◯◯` と記録済み）がマスタと一致しなくなる。
//
//  ここだけを編集し、`npm run sync:shared` で各アプリの vendor-name.gen.ts を再生成すること。
//  ※ import を持たない自己完結ファイル。
// ============================================================

/**
 * 表記ゆれを吸収した比較キー。NFKC で ㈱→(株)・全角英数→半角 を揃えてから、法人格・略記・記号・空白を落とす。
 * 例: 「株式会社 アサヒ」「(株)アサヒ」「㈱アサヒ」「アサヒ」→ 'アサヒ'（小文字化）
 * ★空文字を返すことがある（「株式会社」だけ等）。空は「照合しない」扱いにすること。
 */
export function normalizeVendorName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKC')                                   // ㈱→(株) / Ａ→A / ｱ→ア
    .replace(/[（(](株|有|合|同|名|資)[）)]/g, '')        // (株)(有) 等の略記
    .replace(/(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|特定非営利活動法人)/g, '')
    .replace(/(御中|様)\s*$/g, '')                        // 請求書の宛名表記が混ざった場合
    .replace(/[\s　・,，.。\-ー－]/g, '')
    .toLowerCase()
}

/**
 * 表記ゆれを吸収してマスタを引く索引。
 *  - 完全一致を最優先（同じ会社でも「別会社として登録している」意図を壊さない）
 *  - 次に正規化一致（1社に決まる時だけ。2社以上に当たる＝重複マスタなので、最初の1件＝並び順の先頭を返す。
 *    重複マスタは統合で解消する前提）
 */
export function buildVendorIndex<T extends { name: string }>(rows: T[]): (name: string | null | undefined) => T | null {
  const exact = new Map<string, T>()
  const byNorm = new Map<string, T>()
  for (const r of rows) {
    if (!exact.has(r.name)) exact.set(r.name, r)
    const n = normalizeVendorName(r.name)
    if (n && !byNorm.has(n)) byNorm.set(n, r)
  }
  return (name) => {
    if (!name) return null
    const t = String(name).trim()
    return exact.get(t) ?? byNorm.get(normalizeVendorName(t)) ?? null
  }
}

/**
 * 「㈱」表記へ統一した社名（尾崎さん回答 2026-09-05: 全社 `㈱` 表記に）。
 *  (株)◯◯ / 株式会社◯◯ / ◯◯株式会社 / ㈱ ◯◯ → ㈱◯◯。有限会社は ㈲、合同会社は ㈾ ではなく（合字が無い）そのまま。
 *  法人格が無い名前はそのまま返す（勝手に法人格を付けない）。
 */
export function toKabuNotation(name: string): string {
  let s = (name ?? '').trim()
  const kabuHead = /^(株式会社|\(株\)|（株）|㈱)\s*/
  const kabuTail = /\s*(株式会社|\(株\)|（株）|㈱)$/
  const yuHead = /^(有限会社|\(有\)|（有）|㈲)\s*/
  const yuTail = /\s*(有限会社|\(有\)|（有）|㈲)$/
  if (kabuHead.test(s)) return '㈱' + s.replace(kabuHead, '').trim()
  if (kabuTail.test(s)) return '㈱' + s.replace(kabuTail, '').trim()
  if (yuHead.test(s)) return '㈲' + s.replace(yuHead, '').trim()
  if (yuTail.test(s)) return '㈲' + s.replace(yuTail, '').trim()
  return s
}
