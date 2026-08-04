// 一覧の並び順をユーザーごとに覚える（user_list_orders）。
//
// ★方針: 保存した順序は「ヒント」であって「全量」ではない。
//  保存に無い項目は既定順のまま後ろに続ける＝**新しく増えた現場が消えない**。
//  保存に残っている消えた項目は無視する＝**古い名前でズレない**。
//  ここを「保存した配列をそのまま表示する」にすると、現場が増えた瞬間に見えなくなる。
import { supabase } from './supabase'
import { getAccountId } from './account'

/** 保存済みの並び順を取り出す。未保存・未ログインなら空配列 */
export async function loadListOrder(listKey: string): Promise<string[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('user_list_orders')
    .select('item_keys')
    .eq('auth_user_id', user.id).eq('list_key', listKey)
    .maybeSingle()
  if (error) { console.warn('[listOrder] 読み込み失敗:', error.message); return [] }
  const keys = (data as any)?.item_keys
  return Array.isArray(keys) ? keys.filter((k: unknown) => typeof k === 'string') : []
}

/** 並び順を保存する（1ユーザー×1一覧＝1行を上書き） */
export async function saveListOrder(listKey: string, itemKeys: string[]): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const accountId = await getAccountId()
  if (!accountId) return false
  const { error } = await supabase.from('user_list_orders').upsert({
    account_id: accountId,
    auth_user_id: user.id,
    list_key: listKey,
    item_keys: itemKeys,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'auth_user_id,list_key' })
  if (error) { console.warn('[listOrder] 保存失敗:', error.message); return false }
  return true
}

/**
 * 既定順の一覧に、保存された並び順を被せる。
 * @param items    既定順（例: 五十音順）で並んだ表示キー
 * @param order    保存された並び順（部分集合でよい）
 * @returns order にあるものを order の順で先頭に、残りを既定順のまま後ろに
 */
export function applyListOrder(items: string[], order: string[]): string[] {
  if (!order.length) return items
  const set = new Set(items)
  const head = order.filter((k) => set.has(k))     // 消えた項目は無視
  const headSet = new Set(head)
  const tail = items.filter((k) => !headSet.has(k)) // 新しく増えた項目は既定順で後ろ
  return [...head, ...tail]
}

/** 配列内の要素を1つ前/後ろへ動かした新しい配列を返す（範囲外は何もしない） */
export function moveItem(items: string[], index: number, delta: number): string[] {
  const to = index + delta
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items
  const next = [...items]
  const [x] = next.splice(index, 1)
  next.splice(to, 0, x)
  return next
}
