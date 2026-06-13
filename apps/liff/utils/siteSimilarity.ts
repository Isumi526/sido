// ============================================================
//  lib/siteSimilarity.ts
//  現場名の重複検知ヘルパー。新規現場を追加する際、既存に「似た」名前が
//  あれば気づかせて重複登録（集計の分離）を防ぐ。
//  正規化: NFKC（全角→半角）→ 記号/空白除去 → カタカナ→ひらがな → 小文字。
//  判定: 完全一致／部分一致（包含）／編集距離が短い、のいずれか。
// ============================================================
export function normalizeSiteName(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .replace(/[\s　・,，、。.\-_/／()（）「」『』【】]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // カナ→ひらがな
    .toLowerCase()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/**
 * input に「似た」既存現場名を最大 limit 件返す。
 * @param input    入力中の新規現場名
 * @param existing 既存現場名リスト
 * @param excludeExact 自分自身（編集中の元名）を除外したい場合に渡す
 */
export function findSimilarSiteNames(
  input: string,
  existing: string[],
  excludeExact?: string,
  limit = 5,
): string[] {
  const ni = normalizeSiteName(input)
  if (ni.length < 2) return []
  const exExact = excludeExact ? normalizeSiteName(excludeExact) : null
  const hits: { name: string; score: number }[] = []
  for (const name of existing) {
    const nn = normalizeSiteName(name)
    if (!nn) continue
    if (exExact && nn === exExact) continue // 編集中の自分自身は除外
    let score: number | null = null
    if (nn === ni) score = 0                                   // 完全一致（最重要）
    else if (nn.includes(ni) || ni.includes(nn)) score = 1     // 部分一致
    else {
      const d = levenshtein(ni, nn)
      const thr = Math.max(1, Math.floor(Math.min(ni.length, nn.length) * 0.34))
      if (d <= thr) score = 2
    }
    if (score !== null) hits.push({ name, score })
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.name)
}
