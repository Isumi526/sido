// ============================================================
//  i18n/messages.ts
//  locales/<lang>/<namespace>.json を Vite glob で集約し、
//  { ja: { <namespace>: {...} }, en: {...} } の messages を組み立てる。
//  画面ごとに JSON を分けることで、画面追加時の衝突を避ける（1画面=1ファイル）。
// ============================================================
type Dict = Record<string, unknown>

const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Dict }
>

export const SUPPORTED_LOCALES = ['ja', 'en'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

const messages: Record<string, Record<string, Dict>> = { ja: {}, en: {} }

for (const path in modules) {
  // path 例: './locales/ja/report.json'
  const m = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!m) continue
  const [, lang, ns] = m
  if (!messages[lang]) messages[lang] = {}
  messages[lang][ns] = modules[path].default
}

export default messages
