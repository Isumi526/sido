// ============================================================
//  lib/auth.ts
//  Supabase Auth 認証状態管理
// ============================================================
import { ref } from 'vue'
import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

export const currentUser = ref<User | null>(null)

/** アプリ起動時に一度呼ぶ。セッションを復元し、変更を監視する */
export async function initAuth(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  currentUser.value = session?.user ?? null

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser.value = session?.user ?? null
  })
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
