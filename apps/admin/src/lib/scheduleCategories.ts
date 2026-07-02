// ============================================================
//  lib/scheduleCategories.ts
//  予定管理カテゴリマスタ（schedule_categories）の共有ヘルパ（#A）。
//   - カレンダー(calendar.vue)と管理画面(schedule-categories.vue)で共用。
//   - 既定5カテゴリは「無ければ作る」方式で account に seed（旧ハードコード CATEGORY_COLORS 相当）。
// ============================================================
import { supabase } from './supabase'
import { getAccountId } from './account'

export type ScheduleCategory = {
  id: string
  account_id: string | null
  key: string
  label: string
  color: string
  sort_order: number
  active: boolean
}

// 旧ハードコード互換の既定カテゴリ（label は日本語・色は従来の CATEGORY_COLORS）。
export const DEFAULT_SCHEDULE_CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'work',     label: '勤務',   color: '#06C755' },
  { key: 'off',      label: '休み',   color: '#94a3b8' },
  { key: 'training', label: '研修',   color: '#f59e0b' },
  { key: 'meeting',  label: '会議',   color: '#3b82f6' },
  { key: 'other',    label: 'その他', color: '#8b5cf6' },
]

// アカウントのカテゴリを取得。1件も無ければ既定5件を seed してから返す（初回自動整備）。
export async function loadScheduleCategories(accountId?: string): Promise<ScheduleCategory[]> {
  const acc = accountId ?? (await getAccountId())
  const { data } = await supabase.from('schedule_categories')
    .select('id, account_id, key, label, color, sort_order, active')
    .eq('account_id', acc).order('sort_order').order('created_at')
  let rows = (data ?? []) as ScheduleCategory[]
  if (!rows.length) {
    const seed = DEFAULT_SCHEDULE_CATEGORIES.map((c, i) => ({ ...c, account_id: acc, sort_order: i, active: true }))
    await supabase.from('schedule_categories').upsert(seed, { onConflict: 'account_id,key' })
    const { data: after } = await supabase.from('schedule_categories')
      .select('id, account_id, key, label, color, sort_order, active')
      .eq('account_id', acc).order('sort_order').order('created_at')
    rows = (after ?? []) as ScheduleCategory[]
  }
  return rows
}

// key→color / key→label の早見マップを作る（フォールバック色つき）。
export function colorMap(cats: ScheduleCategory[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const c of cats) m[c.key] = c.color
  return m
}
export function labelMap(cats: ScheduleCategory[]): Record<string, string> {
  const m: Record<string, string> = {}
  for (const c of cats) m[c.key] = c.label
  return m
}
export const FALLBACK_CATEGORY_COLOR = '#94a3b8'
