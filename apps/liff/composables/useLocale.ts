// ============================================================
//  composables/useLocale.ts
//  現在ロケールの取得／切替（localStorage 永続化）。
//  言語スイッチャー等から setLocale('en') で切り替える。
// ============================================================
import { useI18n } from 'vue-i18n'
import { LOCALE_STORAGE_KEY } from '~/plugins/i18n.client'
import type { AppLocale } from '~/i18n/messages'
import { SUPPORTED_LOCALES } from '~/i18n/messages'

export function useLocale() {
  const { locale } = useI18n({ useScope: 'global' })

  function setLocale(l: AppLocale) {
    locale.value = l
    try { localStorage.setItem(LOCALE_STORAGE_KEY, l) } catch { /* noop */ }
  }

  return { locale, setLocale, locales: SUPPORTED_LOCALES }
}
