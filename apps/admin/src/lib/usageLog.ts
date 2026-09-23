// ============================================================
//  apps/admin/src/lib/usageLog.ts
//  GENLINKS の効果測定（機能別の利用状況）用の軽量ロガー（2026-08-27運用者選択）。
//  外部アナリティクス(PostHog/Amplitude等)は導入しない方針のため、自前の
//  feature_usage_events テーブルへ直接INSERTする（RLSで自テナントのみ）。
//
//  ★2026-09-20: 主要機能全体へ計測を広げた。キーは shared/usage-features.ts に追加してから使う
//   （集計画面のラベル/見出しと対応させるため）。LIFF 側は EF `usage-log` 経由（useUsageLog.ts）。
//
//  ★失敗しても機能側の処理は止めない（計測はベストエフォート）。
// ============================================================
import { supabase } from './supabase'
import { getAccountId } from './account'
import { currentWorkerId } from './auth'
import { USAGE_FEATURE_LABELS, type UsageFeatureKey } from './usage-features.gen'

// ★キーの登録簿は shared/usage-features.ts が正本（admin/LIFF/EF 共通・2026-09-20）
export const FEATURE_KEYS: Record<string, string> = USAGE_FEATURE_LABELS
export type FeatureKey = UsageFeatureKey

export async function logFeatureUsage(key: FeatureKey): Promise<void> {
  try {
    const accountId = await getAccountId()
    await supabase.from('feature_usage_events').insert({ account_id: accountId, worker_id: currentWorkerId.value, feature_key: key })
  } catch {
    // 計測失敗は機能に影響させない（ベストエフォート）
  }
}
