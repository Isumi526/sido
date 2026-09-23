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
import { FEATURE_SETTING_KEYS, defaultFeatureFlags, resolveFeatureFlags } from './features-registry.gen'
import type { FeatureKey, FeatureFlags } from './features-registry.gen'

/** 日報の音声入力。優先順位を下げて一旦全アカウントOFF（2026-08-30） */
export const FEATURE_KEY_VOICE_INPUT = 'voice_input_enabled'

export const voiceInputEnabled = ref(false)
/** テナントの「使う機能」（2026-09-19 B-0・shared/features.ts の登録簿。車両・道具は既定ON） */
export const liffFeatures = ref<FeatureFlags>(defaultFeatureFlags())
export function isLiffFeatureEnabled(key: FeatureKey): boolean { return liffFeatures.value[key] === true }
/** 解決済みか（解決前に出してしまわないため。未解決のうちは OFF 扱い） */
export const liffFeaturesResolved = ref(false)

/**
 * 1セッション1回だけ読む（メニュー用）。AppNav／ホームが毎ページ mount するたびに settings を叩かない。
 * 明示的に読み直したい画面（設定変更直後など）は loadLiffFeatures() を直接呼ぶ。
 */
let _loadOnce: Promise<void> | null = null
export function ensureLiffFeaturesLoaded(): Promise<void> {
  if (!_loadOnce) _loadOnce = loadLiffFeatures().catch(() => {})
  return _loadOnce
}

export async function loadLiffFeatures(): Promise<void> {
  liffFeaturesResolved.value = false
  try {
    const supabase = useSupabase()
    const { getAccountId } = useAccount()
    const accountId = await getAccountId()
    if (!accountId) { voiceInputEnabled.value = false; liffFeatures.value = defaultFeatureFlags(); return }
    const { data, error } = await supabase
      .from('settings').select('key, value')
      .eq('account_id', accountId).in('key', [FEATURE_KEY_VOICE_INPUT, ...FEATURE_SETTING_KEYS])
    if (error) throw error
    const rows = (data ?? []) as { key: string; value: string | null }[]
    voiceInputEnabled.value = rows.find((r) => r.key === FEATURE_KEY_VOICE_INPUT)?.value === 'true'
    liffFeatures.value = resolveFeatureFlags(rows)
  } catch (e) {
    console.error('[features] 機能フラグを取得できませんでした:', e)
    voiceInputEnabled.value = false   // フェイルクローズ
    liffFeatures.value = defaultFeatureFlags()
  } finally {
    liffFeaturesResolved.value = true
  }
}
