// ⚠️ AUTO-GENERATED from shared/usage-features.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/usage-features.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/usage-features.ts — 効果測定（機能別の利用回数）の計測キー登録簿
//
//  正本はここ。`npm run sync:shared` で admin / LIFF / EF に *.gen.ts として配布する。
//  「効果測定」画面（admin usage-report.vue）のラベルはこの登録簿から出すので、
//  計測を足す時は **キーをここに追加してから** 呼び出し側で logFeatureUsage(key) を1行足す。
//
//  ★2026-09-20（効果測定の計測を主要機能全体へ広げる）: 見積2箇所 → 主要機能全体へ。
//   - admin は authenticated で feature_usage_events に直接 INSERT（RLS: INSERT/SELECT のみ）
//   - LIFF（LINE作業員は Supabase JWT を持たない）は EF `usage-log` 経由で service_role が INSERT
//     ＝ authenticated 前提の INSERT ポリシーに依存しない。身元は resolveCaller（JWT / LINE ID token / ローカル用）で
//     サーバ側が解決し、クライアントが名乗る account_id / worker_id は受け取らない
//   - 追記専用（anon 全権剥奪・authenticated は UPDATE/DELETE 不可）は変えない
// ============================================================

/** 機能キー → 表示ラベル。group は「効果測定」画面の見出し */
export const USAGE_FEATURES = {
  // 見積・発注・請求
  estimate_created:               { label: '見積作成',               group: '見積・発注' },
  estimate_sent:                  { label: '見積書発行',             group: '見積・発注' },
  purchase_order_issued:          { label: '注文書発行',             group: '見積・発注' },
  subcontractor_invoice_registered: { label: '協力業者の請求書登録', group: '見積・発注' },
  // 日報
  report_submitted:               { label: '日報送信',               group: '日報' },
  report_edited:                  { label: '日報編集',               group: '日報' },
  report_history_viewed:          { label: '日報履歴の閲覧',         group: '日報' },
  report_edit_decided:            { label: '日報編集の承認/却下',    group: '日報' },
  // 出退勤
  punch_recorded:                 { label: '打刻',                   group: '出退勤' },
  punch_correction_requested:     { label: '打刻修正の申請',         group: '出退勤' },
  punch_correction_decided:       { label: '打刻修正の承認/却下',    group: '出退勤' },
  overtime_requested:             { label: '残業申請',               group: '出退勤' },
  overtime_decided:               { label: '残業申請の承認/却下',    group: '出退勤' },
  // 経費
  receipt_ai_analyzed:            { label: '領収書AI解析',           group: '経費' },
  personal_expense_submitted:     { label: '個人経費の申請',         group: '経費' },
  distance_overage_decided:       { label: '距離超過の承認/却下',    group: '経費' },
  expense_doc_issued:             { label: '経費書類の発行',         group: '経費' },
  // AI
  ai_help_asked:                  { label: 'AIヘルプの質問',         group: 'AI' },
  // 現場・スケジュール
  site_created:                   { label: '現場登録',               group: '現場・スケジュール' },
  schedule_created:               { label: '予定の登録',             group: '現場・スケジュール' },
  schedule_viewed:                { label: '予定の閲覧（作業員）',   group: '現場・スケジュール' },
  site_chat_posted:               { label: '現場チャット投稿',       group: '現場・スケジュール' },
  // 在庫・道具
  inventory_moved:                { label: '在庫の移動記録',         group: '在庫・道具' },
  tool_checked_out:               { label: '道具の持出',             group: '在庫・道具' },
  tool_returned:                  { label: '道具の返却',             group: '在庫・道具' },
} as const

export type UsageFeatureKey = keyof typeof USAGE_FEATURES
export const USAGE_FEATURE_KEYS = Object.keys(USAGE_FEATURES) as UsageFeatureKey[]

/** 後方互換: 旧 FEATURE_KEYS（key → label）の形 */
export const USAGE_FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(USAGE_FEATURES).map(([k, v]) => [k, v.label]),
)
export function isUsageFeatureKey(k: unknown): k is UsageFeatureKey {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(USAGE_FEATURES, k)
}
