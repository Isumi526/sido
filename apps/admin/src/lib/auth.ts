// ============================================================
//  lib/auth.ts
//  Supabase Auth 認証状態管理 ＋ 権限(permission_role)解決
// ============================================================
import { ref, computed } from 'vue'
import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export const currentUser = ref<User | null>(null)
// 現在のログインユーザーの permission_role。worker行が無い純粋adminは null。
export const currentRole = ref<string | null>(null)
// ログインユーザーに紐づく worker.id（自分の非公開予定の判定に使う）
export const currentWorkerId = ref<string | null>(null)
// 権限解決が済んだか（解決前にガード判定しないためのフラグ）。
export const roleResolved = ref(false)

// /admin の利用可否: 管理者/事務員/現場管理者、または worker行を持たない純粋adminのみ許可。
//  現場管理者(site_manager)は現場登録等のため admin を使う（ただし時給と出面勤怠の人件費は canViewHourlyWage で非表示）。
//  職人(worker) は弾く。
export const ADMIN_ALLOWED_ROLES = ['admin', 'office', 'site_manager']
export const isAdminAllowed = computed(() =>
  !currentRole.value || ADMIN_ALLOWED_ROLES.includes(currentRole.value))

// 日当単価・人件費・現場原価（原価計算の設定値）の閲覧可否: admin/office/site_manager/純admin(role=null)。
//  ＝ これらは「機密」ではなく原価計算の設定値のため、admin を使える全ロールに見せる（2026-07-03 仕様変更）。
//  ※worker は isAdminAllowed で弾かれるため、ここに来る＝全員可。
export const canViewWages = computed(() => isAdminAllowed.value)

// 時給（実賃金の値）と 出面勤怠(出面勤怠ページの人件費) の閲覧可否: admin/office/純admin(role=null) のみ。
//  site_manager は不可。＝ 時給（wage_type='hourly' の unit_price 実値）と、時給から算出する出面勤怠の
//   人件費を site_manager から隠す（日当単価/人件費/現場原価は canViewWages で全員に見せる）。
//  ※role=null は「worker行の無い純粋admin＝オーナー」を想定し許可。
export const canViewHourlyWage = computed(() =>
  !currentRole.value || currentRole.value === 'admin' || currentRole.value === 'office')

// auth_user_id（=ログインユーザー）に紐づく worker の permission_role を解決。
//  auth_user_id は Supabase auth ユーザー単位で一意のため account 絞り込み不要。
async function resolveRole(user: User | null): Promise<void> {
  roleResolved.value = false
  if (!user) { currentRole.value = null; currentWorkerId.value = null; roleResolved.value = true; return }
  try {
    const { data } = await supabase
      .from('workers').select('id, permission_role').eq('auth_user_id', user.id).limit(1)
    currentRole.value = (data && (data[0] as any)?.permission_role) ?? null
    currentWorkerId.value = (data && (data[0] as any)?.id) ?? null
  } catch {
    currentRole.value = null   // 取得失敗時はロックアウトを避け null(=許可寄り)
    currentWorkerId.value = null
  } finally {
    roleResolved.value = true
  }
}

/** アプリ起動時に一度呼ぶ。セッションを復元し、変更を監視する */
export async function initAuth(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  currentUser.value = session?.user ?? null
  await resolveRole(currentUser.value)

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser.value = session?.user ?? null
    void resolveRole(currentUser.value)
  })
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
