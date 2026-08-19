// ============================================================
//  drawingQuantity.ts — 図面凡例から取り込んだ確定数量の型と検算（見積Q7）
//
//  ★背景（docs/spec/見積機能_業務フロー認識合わせ_20260727.md §1.10.1）:
//   実施図面を全数解析した結果、床・置床・天井・建具・器具の数量は
//   **設計者が凡例に面積/台数を明記している**ことが分かった。拾う必要がない。
//   例) 床 F-01 21.3㎡ … 計67.4㎡ / 天井 C-01 6.5㎡ … 計71.0㎡ / 紙管 C-05 51本
//
//  ★壁は対象外: 壁の面積はどの表にも無い（仕様のみ）。壁は Q8 の計算機で扱う。
//
//  ★検算が成立する（このファイルの主目的）:
//   天井合計 71.0㎡ ≒ 通り芯 10.2m × 6.95m = 70.9㎡。
//   図面から通り芯寸法も取れるので、**抽出値が妥当かを自動で検算できる**。
//   AIの抽出は間違いうるので、「合計が建物の広さと桁違い」を機械で弾くのが要。
// ============================================================

/** 凡例1行ぶん（床/置床/天井は面積、建具/器具/紙管は台数・本数） */
export type QuantityRow = {
  code: string            // 仕上げコード（F-01 / C-03 / AD-1 / C-05 など）
  // ★code とは別物。code はこの図面の中だけで通じる符号、maker_code は
  //  メーカーが付けた品番（SX-FXCS-LED / SLP314）で、定価・掛率を引く鍵になる。
  //  混ぜると単価が一生引けない（2026-08-19 本番レビューで実際にそうなっていた）。
  maker_code?: string | null
  spec?: string | null    // 仕様（タイルカーペット、岩綿吸音板 など）
  value: number           // 数値（面積㎡ または 台数/本数）
  unit: string            // '㎡' | '台' | '本' | '箇所' など図面の表記どおり
  note?: string | null    // 不確実な場合の備考（AIが「要確認」等を入れる）
}

export type QuantityPart = '床' | '置床' | '天井' | '建具' | '器具' | 'その他'

export type ExtractedQuantities = {
  parts: { part: QuantityPart; rows: QuantityRow[] }[]
  /** 通り芯寸法(m)。検算に使う。読めなければ null */
  gridSpanX?: number | null
  gridSpanY?: number | null
  /** 天井高さ(mm)などの補足。表示のみ */
  ceilingHeights?: string[] | null
}

/** 面積系の部位（合計して検算の対象にできるもの） */
const AREA_PARTS: QuantityPart[] = ['床', '置床', '天井']

export function isAreaPart(part: QuantityPart): boolean {
  return AREA_PARTS.includes(part)
}

/** 指定部位の合計。単位が㎡の行だけを足す（台数と混ぜない） */
export function sumArea(q: ExtractedQuantities, part: QuantityPart): number {
  const g = q.parts.find((p) => p.part === part)
  if (!g) return 0
  const total = g.rows
    .filter((r) => (r.unit ?? '').includes('㎡') || (r.unit ?? '').includes('m2'))
    .reduce((s, r) => s + (Number(r.value) || 0), 0)
  // 図面の面積は小数第1位までなので、浮動小数の誤差を丸めて返す
  return Math.round(total * 10) / 10
}

/** 通り芯から求めた床面積(㎡)。どちらかが無ければ null */
export function gridArea(q: ExtractedQuantities): number | null {
  const x = Number(q.gridSpanX), y = Number(q.gridSpanY)
  if (!x || !y || isNaN(x) || isNaN(y)) return null
  return Math.round(x * y * 10) / 10
}

export type CrossCheck = {
  /** 検算できたか（通り芯が読めない図面では検算不能＝警告ではない） */
  available: boolean
  ceilingTotal: number
  gridArea: number | null
  /** 乖離率（0.05 = 5%）。available=false なら null */
  deviation: number | null
  /** 乖離が許容を超えたか */
  warn: boolean
  message: string
}

/**
 * 天井合計 vs 通り芯面積の検算。
 * ★許容 15%: 天井は梁型・下がり天井・吹抜けで通り芯面積とは元々ぴったり一致しない。
 *   実例(北新宿)は 71.0 vs 70.9 で 0.1% だったが、常にこの精度とは限らないため
 *   「桁違い・部屋1つ分の取りこぼし」を捕まえる幅にしてある。
 *   狭くしすぎると毎回警告が出て誰も見なくなる（オオカミ少年になる）。
 */
export const CROSS_CHECK_TOLERANCE = 0.15

export function crossCheckCeiling(q: ExtractedQuantities): CrossCheck {
  const ceilingTotal = sumArea(q, '天井')
  const ga = gridArea(q)
  if (!ga || !ceilingTotal) {
    return {
      available: false, ceilingTotal, gridArea: ga, deviation: null, warn: false,
      message: !ceilingTotal
        ? '天井の面積が抽出できていないため検算できません。'
        : '通り芯寸法が読み取れなかったため検算できません。図面を確認してください。',
    }
  }
  const deviation = Math.abs(ceilingTotal - ga) / ga
  const pct = (deviation * 100).toFixed(1)
  const warn = deviation > CROSS_CHECK_TOLERANCE
  return {
    available: true, ceilingTotal, gridArea: ga, deviation, warn,
    message: warn
      ? `天井合計 ${ceilingTotal}㎡ が通り芯面積 ${ga}㎡ と ${pct}% 乖離しています。抽出漏れ・二重計上の可能性があるので凡例を確認してください。`
      : `天井合計 ${ceilingTotal}㎡ ≒ 通り芯面積 ${ga}㎡（乖離 ${pct}%）。妥当な範囲です。`,
  }
}

/** 見積明細の初期値に変換する（★確定はしない。人が確認・修正してから採用する） */
export type DraftItem = { name: string; spec: string | null; quantity: number; unit: string; trade: string }

export function toDraftItems(q: ExtractedQuantities): DraftItem[] {
  const out: DraftItem[] = []
  for (const g of q.parts) {
    for (const r of g.rows) {
      if (!r.code && !r.spec) continue
      if (!(Number(r.value) > 0)) continue
      out.push({
        name: [g.part, r.code].filter(Boolean).join(' '),
        spec: r.spec ?? null,
        quantity: Number(r.value),
        unit: r.unit || '㎡',
        trade: g.part,
      })
    }
  }
  return out
}
