// ============================================================
//  utils/romaji.ts — 読み仮名をローマ字にする（2026-10-02 設計「見やすさと分かりやすさ」II-2・要望16）
//
//  英語表示の時に、現場名・業者名・作業区分・作業員名を読み仮名からローマ字で出す。
//  インドネシア語・ベトナム語の作業員さんも、ローマ字なら読める。
//
//  ★決まった規則で変える（AI は使わない）。同じ読み仮名からは必ず同じ綴りになる。
//  ★ヘボン式。設計書の例「山田内装 → Yamada Naisou」に合わせ、「おう」「うう」は伸ばさずに書く（ou・uu）。
//   長音の「ー」は書かない（ノート → Noto）。「ん」はいつも n。小さい「っ」は次の子音を重ねる（ch は tch）。
//  ★読み仮名に英字が入っている時（名前の一部が英語）はそのまま残す。
//  ★名前そのものが英字の部分（TANAKA・nowhere 北新宿 の nowhere）は、読み仮名より名前の綴りを優先する
//   （ノーウェア → Nowea より nowhere の方が正しい）。漢字と英字が1語に混ざる名前（麻布台ヒルズRB）は読み仮名だけで出す
//   （読み仮名に英字の読みが入っているかを見分けられず、足すと二重になる＝ABC内装 → ABC Ebishinaisou）。
// ============================================================

const BASE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
}

/** 2文字の組み合わせ（拗音・外来音） */
const COMBO: Record<string, string> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she', じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', てゅ: 'tyu', でゅ: 'dyu',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso', くぁ: 'kwa', ぐぁ: 'gwa',
  いぇ: 'ye',
}

/** カタカナ → ひらがな（ヴ・ヵヶ も含む） */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

function capitalize(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w
}

/** 読み仮名の1語をローマ字に（小文字のまま） */
function romanizeWord(kana: string): string {
  const s = toHiragana(kana)
  let out = ''
  let sokuon = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === 'っ') { sokuon = true; continue }
    if (ch === 'ー' || ch === '〜' || ch === '～') continue
    let r = COMBO[s.slice(i, i + 2)]
    if (r) i++
    else r = BASE[ch]
    if (r === undefined) {
      // 仮名以外（英数字・記号）はそのまま残す
      sokuon = false   // 重ねる子音が無い「っ」（記号の前など）は書かない
      out += ch
      continue
    }
    if (sokuon) {
      out += r.startsWith('ch') ? 't' : (/^[bcdfghjklmpqrstvwxyz]/.test(r) ? r[0] : '')
      sokuon = false
    }
    out += r
  }
  return out
}

/** 名前の区切り（半角・全角の空白、中黒） */
const SEP = /[\s　・]+/

/** 法人の種類（読み仮名には普通入らないので、名前と読み仮名の語を揃える前に外す） */
const LEGAL_FORMS = /[（(](株|有|同|合|資|名|社)[）)]|㈱|㈲|株式会社|有限会社|合同会社|合資会社|合名会社/g

const isLatin = (w: string) => /^[\x21-\x7e]+$/.test(w)
const hasKanaOrKanji = (w: string) => /[぀-ヿ㐀-鿿]/.test(w)

/** 読み仮名をローマ字に（語ごとに頭を大文字）。仮名が1つも無ければ null */
export function romanizeKana(kana: string | null | undefined): string | null {
  const k = (kana ?? '').normalize('NFKC').trim()
  if (!k || !/[぀-ヿ]/.test(k)) return null
  return k.split(SEP).filter(Boolean).map(w => capitalize(romanizeWord(w))).join(' ')
}

/**
 * 英語表示で出す名前。
 *  - 名前が英字だけ → 名前のまま（TANAKA）
 *  - 読み仮名が無い → null（呼ぶ側は日本語の名前のまま出す＝確認事項5=A・AI の仮は使わない）
 *  - 名前と読み仮名の語の数が同じ → 語ごとに、名前が英字の語は名前の綴り、それ以外は読み仮名のローマ字
 *  - それ以外 → 読み仮名のローマ字
 */
export function romanizeName(name: string | null | undefined, kana: string | null | undefined): string | null {
  const n = (name ?? '').normalize('NFKC').replace(LEGAL_FORMS, ' ').trim()
  if (n && !hasKanaOrKanji(n)) return n.split(SEP).filter(Boolean).join(' ')
  const k = (kana ?? '').normalize('NFKC').trim()
  if (!k || !/[぀-ヿ]/.test(k)) return null
  const nw = n.split(SEP).filter(Boolean)
  const kw = k.split(SEP).filter(Boolean)
  if (nw.length === kw.length) {
    return kw.map((w, i) => isLatin(nw[i]) ? nw[i] : capitalize(romanizeWord(w))).join(' ')
  }
  return romanizeKana(k)
}


/** 名前を引く時の鍵（空白の違い・全角半角の違いで引き損ねないように） */
export function nameKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFKC').replace(/[\s　]+/g, ' ').trim()
}
