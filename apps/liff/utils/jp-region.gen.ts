// ⚠️ AUTO-GENERATED from shared/jp-region.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/jp-region.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/jp-region.ts — 住所文字列から「地方」を判定する（会社予定の地方グルーピング用）
//
//  2026-09-10 SEED 大塚さん「関東地方・中部地方・近畿地方で…地域ごとにまとめて見たい」
//  「愛知県・岐阜県とか47になって細かすぎ…天気予報レベル」（G+0:21:04〜0:21:56）。
//  ★東海は自社拠点（名古屋）なので中部から独立させ先頭に置く（2026-09-12 壁打ち決定）。
//  外部API は使わない。住所の先頭〜数文字に含まれる都道府県名で引く（「名古屋市…」のように
//  県名が省かれた住所も主要市名で拾う）。判定できなければ「未設定」（末尾グループ）。
//
//  ★編集はここだけ。scripts/sync-shared.mjs で各アプリの jp-region.gen.ts へ展開する。
// ============================================================

export type RegionKey = 'tokai' | 'kanto' | 'kansai' | 'hokkaido' | 'tohoku' | 'koshinetsu' | 'chugoku_shikoku' | 'kyushu' | 'unknown'

export interface Region { key: RegionKey; label: string; order: number }

// 並び順: 東海（自社拠点）→ 関東 → 関西 → 残りは北から南 → 未設定
export const REGIONS: Region[] = [
  { key: 'tokai',           label: '東海',         order: 0 },
  { key: 'kanto',           label: '関東',         order: 1 },
  { key: 'kansai',          label: '関西',         order: 2 },
  { key: 'hokkaido',        label: '北海道',       order: 3 },
  { key: 'tohoku',          label: '東北',         order: 4 },
  { key: 'koshinetsu',      label: '甲信越・北陸', order: 5 },
  { key: 'chugoku_shikoku', label: '中国・四国',   order: 6 },
  { key: 'kyushu',          label: '九州・沖縄',   order: 7 },
  { key: 'unknown',         label: '住所未設定',   order: 8 },
]

const PREF: Record<string, RegionKey> = {
  // 東海（愛知・岐阜・三重・静岡）
  '愛知': 'tokai', '岐阜': 'tokai', '三重': 'tokai', '静岡': 'tokai',
  // 関東
  '東京': 'kanto', '神奈川': 'kanto', '千葉': 'kanto', '埼玉': 'kanto', '茨城': 'kanto', '栃木': 'kanto', '群馬': 'kanto',
  // 関西
  '大阪': 'kansai', '京都': 'kansai', '兵庫': 'kansai', '奈良': 'kansai', '滋賀': 'kansai', '和歌山': 'kansai',
  // 北海道・東北
  '北海道': 'hokkaido',
  '青森': 'tohoku', '岩手': 'tohoku', '宮城': 'tohoku', '秋田': 'tohoku', '山形': 'tohoku', '福島': 'tohoku',
  // 甲信越・北陸
  '新潟': 'koshinetsu', '長野': 'koshinetsu', '山梨': 'koshinetsu', '富山': 'koshinetsu', '石川': 'koshinetsu', '福井': 'koshinetsu',
  // 中国・四国
  '鳥取': 'chugoku_shikoku', '島根': 'chugoku_shikoku', '岡山': 'chugoku_shikoku', '広島': 'chugoku_shikoku', '山口': 'chugoku_shikoku',
  '徳島': 'chugoku_shikoku', '香川': 'chugoku_shikoku', '愛媛': 'chugoku_shikoku', '高知': 'chugoku_shikoku',
  // 九州・沖縄
  '福岡': 'kyushu', '佐賀': 'kyushu', '長崎': 'kyushu', '熊本': 'kyushu', '大分': 'kyushu', '宮崎': 'kyushu', '鹿児島': 'kyushu', '沖縄': 'kyushu',
}

// 県名が省かれた住所のための主要市（政令市・県庁所在地）。県名が無い時だけ使う。
const CITY: Record<string, RegionKey> = {
  '名古屋市': 'tokai', '豊田市': 'tokai', '岡崎市': 'tokai', '一宮市': 'tokai', '春日井市': 'tokai', '豊橋市': 'tokai', '岐阜市': 'tokai', '四日市市': 'tokai', '津市': 'tokai', '浜松市': 'tokai', '静岡市': 'tokai',
  '横浜市': 'kanto', '川崎市': 'kanto', '相模原市': 'kanto', 'さいたま市': 'kanto', '千葉市': 'kanto', '船橋市': 'kanto', '水戸市': 'kanto', '宇都宮市': 'kanto', '前橋市': 'kanto',
  '大阪市': 'kansai', '堺市': 'kansai', '京都市': 'kansai', '神戸市': 'kansai', '奈良市': 'kansai', '大津市': 'kansai', '和歌山市': 'kansai',
  '札幌市': 'hokkaido', '仙台市': 'tohoku', '新潟市': 'koshinetsu', '金沢市': 'koshinetsu', '広島市': 'chugoku_shikoku', '岡山市': 'chugoku_shikoku', '福岡市': 'kyushu', '北九州市': 'kyushu', '熊本市': 'kyushu', '那覇市': 'kyushu',
}

/** 住所文字列 → 地方。判定できなければ unknown。 */
export function regionOf(location: string | null | undefined): Region {
  const s = (location ?? '').replace(/\s/g, '')
  if (!s) return REGIONS[REGIONS.length - 1]
  // 先頭に「〒123-4567」が付いていても拾えるよう、先頭 20 文字の範囲で県名を探す
  const head = s.replace(/^〒?\d{3}-?\d{4}/, '').slice(0, 20)
  let key: RegionKey | null = null
  // 「東京都」「大阪府」「北海道」「〇〇県」の順で県名を探す（県名は都道府県サフィックス無しでも一致させる）
  for (const [pref, k] of Object.entries(PREF)) {
    if (head.includes(pref)) { key = k; break }
  }
  if (!key) {
    for (const [city, k] of Object.entries(CITY)) {
      if (head.includes(city)) { key = k; break }
    }
  }
  return REGIONS.find(r => r.key === (key ?? 'unknown')) ?? REGIONS[REGIONS.length - 1]
}
