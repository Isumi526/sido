// vue-i18n の globalInjection($t など)を template / コンポーネントで型解決させる
import type { ComposerTranslation } from 'vue-i18n'

declare module 'vue' {
  interface ComponentCustomProperties {
    $t: ComposerTranslation
    $d: (value: number | Date, ...args: unknown[]) => string
    $n: (value: number, ...args: unknown[]) => string
  }
}

export {}
