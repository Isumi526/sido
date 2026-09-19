// ⚠️ AUTO-GENERATED from shared/site-status.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/site-status.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/site-status.ts  ★単一ソース（admin / liff / EF 共有）
//  現場の5段階ステータス（2026-09-19 A-1・設計 docs/spec/現場ステータス・リソース予定_認識合わせ_20260919.html）
//
//  ・語彙（コード⇄表示名・並び順・色）
//  ・「画面キー → その画面に出すステータス集合」の表（1-4 表示マトリクス）
//    ★各画面はここをキーで引く。マトリクスを直したい時はこの表の1行を変えれば全アプリに効く
//     （画面側に集合を直書きしない）。
//  ・ステータス別の必須項目（1-3）
//
//  ここだけを編集し、`npm run sync:shared` で各アプリの site-status.gen.ts を再生成すること。
//  ※ import を持たない自己完結ファイル（各アプリへそのままコピーされるため）。
// ============================================================

export type SiteStatus = 'estimating' | 'ordered' | 'in_progress' | 'completed' | 'lost'

/** 遷移順（一覧の並び・タブの並びに使う） */
export const SITE_STATUS_ORDER: SiteStatus[] = ['estimating', 'ordered', 'in_progress', 'completed', 'lost']

export const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
  estimating: '見積中',
  ordered: '受注',
  in_progress: '着工',
  completed: '完了',
  lost: '失注',
}

/** 「進行中」＝ sites.active=true に相当する集合（DBトリガ sites_sync_status_active と同じ定義） */
export const SITE_OPEN_STATUSES: SiteStatus[] = ['estimating', 'ordered', 'in_progress']

export function isSiteStatus(v: unknown): v is SiteStatus {
  return typeof v === 'string' && (SITE_STATUS_ORDER as string[]).includes(v)
}
export function isOpenSiteStatus(s: SiteStatus | null | undefined): boolean {
  return !!s && SITE_OPEN_STATUSES.includes(s)
}

/** 新規作成時の初期値（❓4=A）: 管理画面＝受注、作業員アプリ（現場名だけで作る）＝着工 */
export const SITE_STATUS_DEFAULT_ADMIN: SiteStatus = 'ordered'
export const SITE_STATUS_DEFAULT_LIFF: SiteStatus = 'in_progress'

// ──────────────────── 1-4 表示マトリクス ────────────────────
//  default = 既定で出す（●）／ optional = 切替で出せる（○）。書いていないものは出さない（－）。
//  キーは「画面」単位。同じ意味の画面（admin と LIFF の日報現場選択など）は同じキーを使う。
export type SiteScreenKey =
  | 'site_master'          // #1  現場マスタ一覧（タブは別途）
  | 'report_site_picker'   // #2/#12 日報一覧・日報編集・LIFF日報 の現場プルダウン
  | 'schedule_site_picker' // #3/#14 予定（従業員）の現場候補
  | 'process_gantt'        // #4/#15 工程管理（会社予定・月ビュー）
  | 'site_aggregation'     // #5/#6 現場別集計・ダッシュボード・出面・ガソリン按分・経費（集計系）
  | 'chat_list'            // #7/#17 チャット一覧・現場チャット
  | 'estimate_site_picker' // #8  見積・発注の現場選択
  | 'subcontractor_invoice'// #9  協力業者請求・未入金
  | 'report_relink'        // #10 現場未設定の紐付け
  | 'tool_destination'     // #11 道具の持出先
  | 'checkin_site_picker'  // #13 出退勤の現場選択
  | 'liff_site_list'       // #16 現場情報一覧
  | 'personal_expense_site'// #18 現場に紐づかない経費の現場選択

export const SITE_SCREEN_STATUSES: Record<SiteScreenKey, { default: SiteStatus[]; optional: SiteStatus[] }> = {
  site_master:           { default: ['estimating', 'ordered', 'in_progress'], optional: ['completed', 'lost'] },
  report_site_picker:    { default: ['ordered', 'in_progress'],               optional: ['estimating', 'completed'] },
  schedule_site_picker:  { default: ['estimating', 'ordered', 'in_progress'], optional: [] },
  process_gantt:         { default: ['ordered', 'in_progress'],               optional: ['estimating', 'completed'] },
  site_aggregation:      { default: ['in_progress', 'completed'],             optional: ['ordered'] },
  chat_list:             { default: ['estimating', 'ordered', 'in_progress'], optional: ['completed'] },
  estimate_site_picker:  { default: ['estimating', 'ordered', 'in_progress'], optional: ['lost'] },
  subcontractor_invoice: { default: ['in_progress', 'completed'],             optional: ['ordered'] },
  report_relink:         { default: ['ordered', 'in_progress'],               optional: ['completed'] },
  tool_destination:      { default: ['ordered', 'in_progress'],               optional: ['estimating'] },
  checkin_site_picker:   { default: ['ordered', 'in_progress'],               optional: ['estimating'] },
  liff_site_list:        { default: ['ordered', 'in_progress'],               optional: ['estimating', 'completed'] },
  personal_expense_site: { default: ['in_progress'],                          optional: ['ordered'] },
}

/** 画面に出すステータス集合。showOptional=true で「他の現場を表示」トグルON相当 */
export function siteStatusesForScreen(key: SiteScreenKey, showOptional = false): SiteStatus[] {
  const m = SITE_SCREEN_STATUSES[key]
  return showOptional ? [...m.default, ...m.optional] : [...m.default]
}

// ──────────────────── 1-3 ステータス別の必須項目 ────────────────────
export type SiteRequiredField = 'name' | 'location' | 'period_start' | 'period_end' | 'responsible_worker_id'

export const SITE_REQUIRED_FIELDS: Record<SiteStatus, SiteRequiredField[]> = {
  estimating:  ['name'],
  ordered:     ['name', 'location', 'period_start', 'responsible_worker_id'],
  in_progress: ['name', 'location', 'period_start', 'responsible_worker_id'],
  completed:   ['name', 'location', 'period_start', 'period_end', 'responsible_worker_id'],
  lost:        ['name'],
}

export const SITE_REQUIRED_FIELD_LABEL: Record<SiteRequiredField, string> = {
  name: '現場名',
  location: '住所',
  period_start: '工期（開始日）',
  period_end: '工期（終了日）',
  responsible_worker_id: '責任者',
}

/**
 * そのステータスで未入力の必須項目を返す（表示名）。
 *  ★オフィス・工場（kind≠site）は住所・工期を求めない（現行踏襲）。
 */
export function missingSiteFields(
  status: SiteStatus,
  site: { name?: string | null; location?: string | null; period_start?: string | null; period_end?: string | null; responsible_worker_id?: string | null; kind?: string | null },
): SiteRequiredField[] {
  const isSite = (site.kind ?? 'site') === 'site'
  return SITE_REQUIRED_FIELDS[status].filter((f) => {
    if (!isSite && (f === 'location' || f === 'period_start' || f === 'period_end')) return false
    const v = site[f]
    return !(typeof v === 'string' ? v.trim() : v)
  })
}

/**
 * 工期から「次のステータスにしますか？」の提案（❓3=A: 自動では変えず目印だけ）。
 *  受注 かつ 開始日 ≤ 今日 → 着工／ 着工 かつ 終了日 < 今日 → 完了
 */
export function suggestNextSiteStatus(
  site: { status: SiteStatus; period_start?: string | null; period_end?: string | null },
  today: string,
): SiteStatus | null {
  if (site.status === 'ordered' && site.period_start && site.period_start <= today) return 'in_progress'
  if (site.status === 'in_progress' && site.period_end && site.period_end < today) return 'completed'
  return null
}
