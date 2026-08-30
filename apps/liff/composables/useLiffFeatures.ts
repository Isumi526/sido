// ============================================================
//  useLiffFeatures — LIFF側の機能フラグ（アカウント単位・settings の key/value）
//
//  ★admin の lib/features.ts と同じ作法にそろえる:
//   - env ではなく DB(settings)。解禁のたびに再デプロイしたくない／テナントごとに
//     別々のタイミングで出したいため。
//   - **未設定は OFF（fail-closed）**。取得に失敗した時も OFF に倒す。
//     事故で未完成の機能が作業員に出るより、見えない方を選ぶ。
//
//  ★モジュールスコープの共有ref。画面ごとに読み直さない（useNotifBadge と同じパターン）。
// ============================================================
import { ref } from 'vue'

/** 日報の音声入力。優先順位を下げて一旦全アカウントOFF（2026-08-30） */
export const FEATURE_KEY_VOICE_INPUT = 'voice_input_enabled'

export const voiceInputEnabled = ref(false)
/** 解決済みか（解決前に出してしまわないため。未解決のうちは OFF 扱い） */
export const liffFeaturesResolved = ref(false)

export async function loadLiffFeatures(): Promise<void> {
  liffFeaturesResolved.value = false
  try {
    const supabase = useSupabase()
    const { getAccountId } = useAccount()
    const accountId = await getAccountId()
    if (!accountId) { voiceInputEnabled.value = false; return }
    const { data, error } = await supabase
      .from('settings').select('value')
      .eq('account_id', accountId).eq('key', FEATURE_KEY_VOICE_INPUT).maybeSingle()
    if (error) throw error
    voiceInputEnabled.value = (data as { value?: string } | null)?.value === 'true'
  } catch (e) {
    console.error('[features] 機能フラグを取得できませんでした:', e)
    voiceInputEnabled.value = false   // フェイルクローズ
  } finally {
    liffFeaturesResolved.value = true
  }
}
