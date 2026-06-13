// ============================================================
//  plugins/i18n.client.ts
//  vue-i18n を Nuxt(SPA) に組み込む。@nuxtjs/i18n は使わず最小構成。
//  - legacy:false（Composition API）/ globalInjection で template の $t を有効化
//  - 既定ロケールは ja。localStorage('app_locale') に保存した選択を復元
//  - 未翻訳キーは fallbackLocale(ja) に自動フォールバック
// ============================================================
import { createI18n } from 'vue-i18n'
import messages, { SUPPORTED_LOCALES } from '~/i18n/messages'
import { setGlobalTranslator } from '~/utils/i18n-global'

export const LOCALE_STORAGE_KEY = 'app_locale'

export default defineNuxtPlugin((nuxtApp) => {
  let initial = 'ja'
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) initial = saved
  } catch { /* localStorage 不可環境は ja */ }

  const i18n = createI18n({
    legacy: false,
    globalInjection: true,
    locale: initial,
    fallbackLocale: 'ja',
    messages,
    missingWarn: false,
    fallbackWarn: false,
  })

  nuxtApp.vueApp.use(i18n)

  // setup 外（util / PDF生成）からも翻訳できるようグローバル参照を注入
  setGlobalTranslator((key, params) =>
    params ? i18n.global.t(key, params) : i18n.global.t(key),
  )
})
