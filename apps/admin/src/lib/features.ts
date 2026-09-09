// ============================================================
//  lib/features.ts
//  機能フラグ（アカウント単位）— settings テーブルの key/value で持つ
//
//  ★なぜ env ではなく DB なのか（2026-08-09）:
//   見積もり機能は 8/19 に大塚さんと本番で通しテストするまで露出させない。
//   env フラグだと解禁のたびに再デプロイが要り、当日に Vercel を触ることになる。
//   settings なら該当アカウントの1行を true にするだけで切り替わり、
//   テナントごとに別々のタイミングで解禁できる（既存の notify_report_enabled と同じ作り）。
//
//  ★未設定は OFF（fail-closed）。見積もりは一度も本番に出ていないので既定OFFで矛盾しない。
//   取得に失敗した時も OFF に倒す＝事故で未完成機能が露出するより、見えない方を選ぶ。
//
//  ★lib/featureFlags.ts とは別物なので注意（名前が近い）:
//   featureFlags.ts = ビルド時の定数（HIDE_LINE_SECTIONS 等・切替に再デプロイが要る）
//   features.ts     = 実行時のアカウント単位フラグ（settings 由来・再デプロイ不要）
// ============================================================
import { ref, computed, watch } from 'vue'
import { supabase } from './supabase'
import { getAccountId } from './account'
import { currentUser, canViewManagementPages, isOwnSite } from './auth'

/** 見積もり機能（見積・発注/見積マスタ/材料抽出）を出すか */
export const estimateEnabled = ref(false)
/** フラグの解決が済んだか（解決前にルートガードが判定して素通ししないため） */
export const featuresResolved = ref(false)

export const FEATURE_KEY_ESTIMATE = 'estimate_feature_enabled'

/**
 * 見積もり系の画面・導線を出せるか。
 *  経営系ページの権限（admin/office/純オーナー）に加えて、機能フラグONが要る。
 *  ★見積への「抜け道」（現場別集計のPDF同梱・現場マスタの見積書欄・現場詳細の見積カード）も
 *   これで塞ぐ。canViewManagementPages のままだとフラグOFFでも見積データに届いてしまう。
 */
export const canViewEstimates = computed(() => canViewManagementPages.value && estimateEnabled.value)

/**
 * 現場に紐づく見積書を「この現場について」見せてよいか。
 *  ★現場管理者の所有権モデル（2026-07-31方針・2026-09-05 Step2）:
 *   経営系ロール(canViewEstimates)に加え、自分が責任者の現場なら見積書を見せる
 *   （Q3=金額・見積書は「見せない」が既定だったが、"自分の"現場に限っては
 *    オーナー同等にフル閲覧可＝所有軸モデルの中核）。
 *   フラグOFF(estimateEnabled=false)なら誰にも見せない＝機能フラグが最優先で効く。
 */
export function canViewEstimatesForSite(responsibleWorkerId: string | null | undefined): boolean {
  if (!estimateEnabled.value) return false
  return canViewManagementPages.value || isOwnSite(responsibleWorkerId)
}

/** settings から機能フラグを読む。ログイン前・取得失敗時は OFF のまま。 */
export async function loadFeatures(): Promise<void> {
  featuresResolved.value = false
  try {
    if (!currentUser.value) { estimateEnabled.value = false; return }
    const accountId = await getAccountId()
    const { data, error } = await supabase
      .from('settings').select('value')
      .eq('account_id', accountId).eq('key', FEATURE_KEY_ESTIMATE).maybeSingle()
    if (error) throw error
    estimateEnabled.value = (data as { value?: string } | null)?.value === 'true'
  } catch {
    estimateEnabled.value = false   // フェイルクローズ
  } finally {
    featuresResolved.value = true
  }
}

/** featuresResolved になるまで待つ（router guard 用） */
export function waitForFeaturesResolved(): Promise<void> {
  if (featuresResolved.value) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(featuresResolved, (v) => { if (v) { stop(); resolve() } })
  })
}

// ログインユーザーが変わったら読み直す（テナント切替・ログアウトに追従）
watch(currentUser, () => { void loadFeatures() }, { immediate: false })
