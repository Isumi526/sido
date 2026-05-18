// ============================================================
//  middleware/auth.global.ts
//  全ページで LIFF 認証 + 承認チェックを行う
// ============================================================

// パブリックページ（チェックをスキップ）
const PUBLIC_PATHS = ['/register', '/pending']

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  if (PUBLIC_PATHS.includes(to.path)) return

  const liff    = useLiff()
  const expense = useExpense()

  await liff.init()

  const userId = liff.profile.value?.userId
  if (!userId) return // LIFF が LINE ログインにリダイレクト済み

  const user = await expense.getUser(userId)
  if (!user)             return navigateTo('/register')
  if (!user.is_approved) return navigateTo('/pending')
})
