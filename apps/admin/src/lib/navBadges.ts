// ============================================================
//  navBadges.ts — ナビの未処理件数バッジの共有ストア
//  App.vue が描画し、各処理画面（承認/紐付け）が処理後に refreshNavBadges() を呼ぶ。
//  これで同一ルート上で処理してもリロードせずバッジが即更新される。
// ============================================================
import { ref } from 'vue'
import { supabase } from './supabase'
import { getAccountId } from './account'

export const editApprovalCount    = ref(0)  // 日報編集の許可申請(pending)
export const siteUnsetCount       = ref(0)  // 現場未設定の日報(直近90日)
export const overtimePendingCount = ref(0)  // 残業申請(pending)

export async function refreshNavBadges() {
  const accountId = await getAccountId()
  if (!accountId) { editApprovalCount.value = 0; siteUnsetCount.value = 0; overtimePendingCount.value = 0; return }
  // 許可申請: pending件数（DBカウント）
  const { count } = await supabase.from('report_edit_grants')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('status', 'pending')
  editApprovalCount.value = count ?? 0
  // 残業申請: pending件数（DBカウント）
  const { count: otCount } = await supabase.from('overtime_requests')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId).eq('status', 'pending')
  overtimePendingCount.value = otCount ?? 0
  // 現場未設定: 直近90日の日報の sites JSON に siteName='__unset__' が含まれる数（relink画面と同窓）
  const since = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
  const { data: reps } = await supabase.from('daily_reports')
    .select('sites').eq('account_id', accountId).gte('date', since)
  let unset = 0
  for (const rep of (reps ?? []) as any[]) {
    const arr = Array.isArray(rep.sites) ? rep.sites : []
    for (const site of arr) if (site?.siteName === '__unset__') unset++
  }
  siteUnsetCount.value = unset
}
