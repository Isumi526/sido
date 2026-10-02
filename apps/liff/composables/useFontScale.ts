// ============================================================
//  composables/useFontScale.ts
//  作業員アプリの文字の大きさ（標準・大・特大）を人ごとに選べるようにする
//  （2026-10-02 シード要望15「字が小さい」・設計「見やすさと分かりやすさ」II-1・確認事項3=A）。
//
//  ★作業員アプリの文字の大きさは各画面で px 直書き（約970か所）なので、文字だけを変える作りになっていない。
//   画面全体を CSS の zoom で拡大する（ブラウザの拡大と同じく、横幅は画面に合わせて組み直される）。
//   大きくした時に画面の並びが多少変わるのは了承済み（9/29）。
//  ★保存はその端末だけ（localStorage・言語の切り替えと同じ）。管理画面には影響しない。
// ============================================================
export const FONT_SCALE_STORAGE_KEY = 'app_font_scale'
export type FontScale = 'normal' | 'large' | 'xlarge'
export const FONT_SCALES: Record<FontScale, number> = { normal: 1, large: 1.15, xlarge: 1.3 }
export const FONT_SCALE_KEYS = Object.keys(FONT_SCALES) as FontScale[]

export function readFontScale(): FontScale {
  try {
    const v = localStorage.getItem(FONT_SCALE_STORAGE_KEY)
    if (v && (FONT_SCALE_KEYS as string[]).includes(v)) return v as FontScale
  } catch { /* localStorage 不可環境は標準 */ }
  return 'normal'
}

export function applyFontScale(s: FontScale): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.zoom = s === 'normal' ? '' : String(FONT_SCALES[s])
  root.dataset.fontScale = s
}

export function useFontScale() {
  const scale = useState<FontScale>('font_scale', () => (import.meta.client ? readFontScale() : 'normal'))
  function setScale(s: FontScale) {
    scale.value = s
    try { localStorage.setItem(FONT_SCALE_STORAGE_KEY, s) } catch { /* noop */ }
    applyFontScale(s)
  }
  return { scale, setScale, scales: FONT_SCALE_KEYS }
}
