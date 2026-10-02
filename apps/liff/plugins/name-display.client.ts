// ============================================================
//  plugins/name-display.client.ts — テンプレートの $nm(名前)（2026-10-02 II-2）
//  英語表示の時だけ、名前を読み仮名からローマ字で出す。中身は composables/useNameDisplay.ts。
//  ★i18n.client.ts の後に読み込まれる（プラグインは名前順）。
// ============================================================
import type { Ref } from 'vue'

export default defineNuxtPlugin((nuxtApp) => {
  const localeRef = nuxtApp.$i18nLocale as Ref<string> | undefined
  const { load, nm } = useNameDisplay()
  const locale = () => String(localeRef?.value ?? 'ja')

  // 英語にした時に読み仮名を取りに行く。身元の確認がまだで失敗した時は少し待ってやり直す
  let tries = 0
  async function ensure() {
    if (locale() !== 'en') return
    try { await load() } catch {
      if (++tries <= 5) setTimeout(ensure, 3000 * tries)
    }
  }
  watch(() => locale(), (l) => { if (l === 'en') { tries = 0; ensure() } }, { immediate: true })

  nuxtApp.vueApp.config.globalProperties.$nm = (name: string | null | undefined) => nm(name, locale())
})

declare module 'vue' {
  interface ComponentCustomProperties {
    /** 名前を表示用に（英語表示で読み仮名があればローマ字） */
    $nm: (name: string | null | undefined) => string
  }
}
