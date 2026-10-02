// ============================================================
//  plugins/font-scale.client.ts — 起動時に、この端末で選んだ文字の大きさを当てる（II-1・composables/useFontScale.ts）
// ============================================================
import { applyFontScale, readFontScale } from '~/composables/useFontScale'

export default defineNuxtPlugin(() => {
  applyFontScale(readFontScale())
})
