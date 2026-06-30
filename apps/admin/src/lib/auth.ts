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
// 権限解決が済んだか（解決前にガード判定しないためのフラグ）。
export const roleResolved = ref(false)

// /admin の利用可否: 管理者/事務員、または worker行を持たない純粋adminのみ許可。
//  現場担当者(site_manager)・職人(worker) は弾く。
export const ADMIN_ALLOWED_ROLES = ['admin', 'office']
export const isAdminAllowed = computed(() =>
  !currentRole.value || ADMIN_ALLOWED_ROLES.includes(currentRole.value))

// auth_user_id（=ログインユーザー）に紐づく worker の permission_role を解決。
//  auth_user_id は Supabase auth ユーザー単位で一意のため account 絞り込み不要。
async function resolveRole(user: User | null): Promise<void> {
  roleResolved.value = false
  if (!user) { currentRole.value = null; roleResolved.value = true; return }
  try {
    const { data } = await supabase
      .from('workers').select('permission_role').eq('auth_user_id', user.id).limit(1)
    currentRole.value = (data && (data[0] as any)?.permission_role) ?? null
  } catch {
    currentRole.value = null   // 取得失敗時はロックアウトを避け null(=許可寄り)
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
