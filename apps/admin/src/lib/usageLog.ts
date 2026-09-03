// ============================================================
//  apps/admin/src/lib/usageLog.ts
//  GENLINKS の効果測定（機能別の利用状況）用の軽量ロガー（2026-08-27運用者選択）。
//  外部アナリティクス(PostHog/Amplitude等)は導入しない方針のため、自前の
//  feature_usage_events テーブルへ直接INSERTする（RLSで自テナントのみ）。
//
//  ★このMVPで計測しているのは代表的な2機能のみ（見積作成・見積書PDF発行）。
//   他の機能へ計測を広げる時は、呼び出し箇所で logFeatureUsage(key) を1行
//   足すだけでよい。key は下記 FEATURE_KEYS に追加してから使うこと
//   （集計画面のラベル表示と対応させるため）。
//
//  ★失敗しても機能側の処理は止めない（計測はベストエフォート）。
// ============================================================
import { supabase } from './supabase'
import { getAccountId } from './account'

export const FEATURE_KEYS = {
  estimate_created: '見積作成',
  estimate_sent: '見積書発行',
} as const
export type FeatureKey = keyof typeof FEATURE_KEYS

export async function logFeatureUsage(key: FeatureKey): Promise<void> {
  try {
    const accountId = await getAccountId()
    await supabase.from('feature_usage_events').insert({ account_id: accountId, feature_key: key })
  } catch {
    // 計測失敗は機能に影響させない（ベストエフォート）
  }
}
