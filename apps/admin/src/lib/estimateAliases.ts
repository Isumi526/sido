// ============================================================
//  estimateAliases.ts — 見積項目の名寄せ「これ＝これ」（E-3・2026-09-20）
//  大塚さん「天井下地組…天井LGS下地組って書くので」→ 表記A（業者の書き方）＝代表名B（自社の正式名称）を
//  人が登録し、単価履歴を代表名に寄せる。テーブル estimate_name_aliases（2026-09-09 追加・RLS 自テナント）。
//  ★AI の候補提示は後回し（手動のみ）。誤って寄せると金額が直接狂うため、確定は人が行う。
//  ★業者跨ぎで同じ alias を使う（テナント内で alias は一意）。
// ============================================================
import { supabase } from './supabase'

export type NameAlias = { id: string; alias: string; work_name: string; confirmed_at: string }

const norm = (s: unknown) => String(s ?? '').trim()

export async function loadAliases(accountId: string): Promise<NameAlias[]> {
  const { data, error } = await supabase.from('estimate_name_aliases')
    .select('id, alias, work_name, confirmed_at').eq('account_id', accountId).order('work_name').order('alias')
  if (error) throw error
  return (data ?? []) as NameAlias[]
}

/** alias（表記）→ work_name（代表名）。代表名自身が別の alias になっている連鎖は1段だけ辿る */
export function aliasMapOf(list: NameAlias[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const a of list) { const k = norm(a.alias); const v = norm(a.work_name); if (k && v && k !== v) m.set(k, v) }
  for (const [k, v] of m) { const next = m.get(v); if (next && next !== k) m.set(k, next) }
  return m
}

export function canonicalName(name: string, map: Map<string, string>): string {
  const n = norm(name)
  return map.get(n) ?? n
}

export async function addAlias(accountId: string, alias: string, workName: string, confirmedBy: string | null): Promise<void> {
  const a = norm(alias), w = norm(workName)
  if (!a || !w) throw new Error('表記と代表名を入力してください')
  if (a === w) throw new Error('表記と代表名が同じです')
  const { error } = await supabase.from('estimate_name_aliases')
    .upsert({ account_id: accountId, alias: a, work_name: w, confirmed_by: confirmedBy, confirmed_at: new Date().toISOString() }, { onConflict: 'account_id,alias' })
  if (error) throw error
}

export async function removeAlias(accountId: string, id: string): Promise<void> {
  // ★RLS があっても account_id で絞る（他テナントの行に触れない・Gemini 指摘 2026-09-20）
  const { error } = await supabase.from('estimate_name_aliases').delete().eq('id', id).eq('account_id', accountId)
  if (error) throw error
}
