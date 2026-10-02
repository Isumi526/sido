// ============================================================
//  useNameDisplay — 英語表示の時、名前を読み仮名からローマ字で出す（2026-10-02 設計「見やすさと分かりやすさ」II-2）
//
//  対象は現場名・業者名（元請け・協力業者）・作業区分・作業員名。テンプレートでは $nm(名前) で使う。
//   - 日本語表示 → 名前のまま
//   - 英語表示   → 読み仮名があればローマ字（utils/romaji.ts の決まった規則）。無ければ名前のまま（確認事項5=A）
//  ★表示だけ変える。保存する値・集計・日報の siteName は日本語の名前のまま（ここで変えた文字列を保存に使わない）。
//  ★名前で引く。日報に残っている現場名（スナップショット）も同じ名前なら英語で出る。
//  ★読み仮名は英語表示の時だけ取りに行く（日本語表示の人には余計な通信をさせない）。
// ============================================================
import { useI18n } from 'vue-i18n'
import { romanizeName, nameKey } from '~/utils/romaji'

const CACHE_KEY = 'app_name_readings'
const CACHE_TTL = 30 * 60 * 1000

export function useNameDisplay() {
  /** 名前の鍵 → ローマ字 */
  const roman = useState<Record<string, string>>('name_roman', () => ({}))
  const loaded = useState<boolean>('name_roman_loaded', () => false)

  function build(rows: [string, string][]) {
    const m: Record<string, string> = {}
    for (const [name, kana] of rows) {
      const r = romanizeName(name, kana)
      if (r) m[nameKey(name)] = r
    }
    roman.value = m
  }

  let inflight: Promise<void> | null = null
  /** 読み仮名を読み込む（キャッシュがあればまずそれで出し、裏で新しくする） */
  function load(): Promise<void> {
    if (inflight) return inflight
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const { rows, ts } = JSON.parse(raw)
        if (Array.isArray(rows)) { build(rows); loaded.value = true }
        if (Date.now() - ts < CACHE_TTL) return Promise.resolve()
      }
    } catch { /* 読めなければ取りに行く */ }
    inflight = useMaster().fetchReadings()
      .then((rows) => {
        build(rows)
        loaded.value = true
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rows, ts: Date.now() })) } catch { /* noop */ }
      })
      .finally(() => { inflight = null })
    return inflight
  }

  /** 表示する名前。英語でない時・読み仮名が無い時は名前のまま */
  function nm(name: string | null | undefined, locale: string): string {
    const n = name ?? ''
    if (locale !== 'en' || !n) return n
    return roman.value[nameKey(n)] ?? n
  }

  return { roman, loaded, load, nm }
}

/** setup の中（script）で使う形。テンプレートでは $nm を使う */
export function useNm() {
  const { locale } = useI18n({ useScope: 'global' })
  const { nm } = useNameDisplay()
  return (name: string | null | undefined) => nm(name, String(locale.value))
}
