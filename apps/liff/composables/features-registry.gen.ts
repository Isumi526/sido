// ⚠️ AUTO-GENERATED from shared/features.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/features.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/features.ts  ★単一ソース（admin / liff / EF 共有）
//  テナント単位の「使う機能」（機能のインストール／アンインストール・2026-09-19 B-0）
//
//  ★なぜ: 会社によって管理したいものが違う（車両を持たない会社・会議室を予約したい会社…）。
//   設定画面で機能ごとに ON/OFF し、OFF はメニュー・タブ・作業員アプリの導線を隠すだけで
//   データは消さない（ON に戻せば元どおり）。
//
//  ★保存先は settings の key/value（admin lib/features.ts の見積フラグと同じ作り。env ではないので
//   再デプロイ不要・テナントごとに別々のタイミングで切り替えられる）。
//
//  ★既定値（defaultOn）:
//   - 既に全テナントに露出している機能（車両・道具）は **既定 ON**。fail-closed にすると、行を書き忘れた
//     テナントで車両・道具メニューが消える事故になる（設計資料 付録の注意点）。
//   - まだ出していない機能（会議室・見積）は既定 OFF（fail-closed）。
//   取得に失敗した時は既定値に倒す。
//
//  ここだけを編集し、`npm run sync:shared` で各アプリの features.gen.ts を再生成すること。
//  ※ import を持たない自己完結ファイル。
// ============================================================

export type FeatureKey = 'estimate' | 'vehicles' | 'tools' | 'rooms' | 'inventory' | 'estimate_excel'

export type FeatureDef = {
  key: FeatureKey
  /** settings.key（見積は 2026-08-09 からの既存キーを互換で使う） */
  settingKey: string
  label: string
  description: string
  defaultOn: boolean
}

export const FEATURES: FeatureDef[] = [
  {
    key: 'estimate', settingKey: 'estimate_feature_enabled', label: '見積・発注', defaultOn: false,
    description: '「見積・発注」「見積マスタ・単価表」のメニューと、現場まわりの見積書の表示。',
  },
  {
    key: 'vehicles', settingKey: 'feature.vehicles', label: '車両管理', defaultOn: true,
    description: '車両マスタ（車検・保険・修理ログ）と、予定管理の車両タブ。',
  },
  {
    key: 'tools', settingKey: 'feature.tools', label: '道具管理', defaultOn: true,
    description: '道具・保管場所のマスタとQR、持出／返却、予定管理の道具タブ。',
  },
  {
    key: 'rooms', settingKey: 'feature.rooms', label: '会議室・部屋の予約', defaultOn: false,
    description: '会議室などの部屋を登録し、予定管理のタブで時間帯予約する。',
  },
  {
    // 見積Excel連携（2026-09-10 決定・設計書 E-1）: 会社ごとの個別対応＝標準ではない。既定OFF。SEED は無償パイロットで ON。
    // 標準の見積機能（受領見積書のAI読込→単価履歴→横断検索・Web の見積作成・発注書）は estimate のまま。
    key: 'estimate_excel', settingKey: 'estimate_excel_enabled', label: '見積Excel連携（個別対応）', defaultOn: false,
    description: '「見積Excel連携」のメニュー（作業用Excelの書き出し／取込／工種別の生成）。見積・発注が ON の会社にだけ効く個別対応。',
  },
  {
    // 在庫①〜④（2026-09-19 レビュー決定）: ③④が揃うまでベータ＝既定OFF。SEED で ON にして大塚さんに見せる。
    // OFF のあいだは admin「在庫管理」メニュー／ルートと、作業員アプリの「在庫」メニュー／画面を隠す（データは消さない）。
    key: 'inventory', settingKey: 'feature.inventory', label: '在庫管理（ベータ）', defaultOn: false,
    description: '品目マスタと、作業員アプリの「在庫」（引き上げ・持出・入荷を写真つきで記録）。残数把握用で会計在庫ではありません。',
  },
]

export const FEATURE_SETTING_KEYS: string[] = FEATURES.map((f) => f.settingKey)

export type FeatureFlags = Record<FeatureKey, boolean>

export function defaultFeatureFlags(): FeatureFlags {
  const out = {} as FeatureFlags
  for (const f of FEATURES) out[f.key] = f.defaultOn
  return out
}

/** settings の行（key/value）から機能フラグを解決する。無い行は既定値 */
export function resolveFeatureFlags(rows: { key: string; value: string | null }[] | null | undefined): FeatureFlags {
  const out = defaultFeatureFlags()
  const m = new Map((rows ?? []).map((r) => [r.key, r.value]))
  for (const f of FEATURES) {
    const v = m.get(f.settingKey)
    if (v === 'true') out[f.key] = true
    else if (v === 'false') out[f.key] = false
  }
  return out
}

export function featureDef(key: FeatureKey): FeatureDef {
  return FEATURES.find((f) => f.key === key)!
}
