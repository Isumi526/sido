// ============================================================
//  utils/i18n-global.ts
//  setup 外（pure util / PDF生成など useI18n が使えない場所）から翻訳するための
//  グローバル参照。plugins/i18n.client.ts が起動時に setGlobalI18n() で注入する。
//  ※ Vue コンポーネントの setup 内では useI18n() / $t を使うこと。
// ============================================================
type Translator = (key: string, params?: Record<string, unknown>) => string

let _t: Translator | null = null

export function setGlobalTranslator(t: Translator) {
  _t = t
}

// グローバル翻訳。i18n 未初期化時は key をそのまま返す（保険）。
export function gt(key: string, params?: Record<string, unknown>): string {
  if (!_t) return key
  return params ? _t(key, params) : _t(key)
}
