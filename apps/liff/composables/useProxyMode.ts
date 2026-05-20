// ============================================================
//  composables/useProxyMode.ts
//  代理入力モード管理
//
//  代理操作者（can_proxy = true）が他ユーザーに成り代わって
//  日報・経費などをそのユーザーとして送信できる機能。
//  セッション中のみ有効（タブを閉じると解除）。
// ============================================================
import type { User } from '~/types'

const SESSION_KEY = 'sido_proxy_target'

export const useProxyMode = () => {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()

  // グローバル状態（全ページ共有）
  const proxyTarget  = useState<User | null>('proxy_target', () => {
    if (import.meta.server) return null
    try {
      const stored = sessionStorage.getItem(SESSION_KEY)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  const allUsers = useState<User[]>('proxy_all_users', () => [])

  // 代理中かどうか
  const isProxyMode = computed(() => proxyTarget.value !== null)

  // 実効ユーザー（代理中は代理先、それ以外は自分）
  function effectiveUser(self: User | null): User | null {
    return proxyTarget.value ?? self
  }

  // 全ユーザーを取得（代理先選択用）
  async function fetchAllUsers() {
    const accountId = await getAccountId()
    if (!accountId) return
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('account_id', accountId)
      .order('real_name')
    allUsers.value = (data ?? []) as User[]
  }

  // 代理先を設定
  function setProxy(user: User) {
    proxyTarget.value = user
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
  }

  // 代理解除
  function clearProxy() {
    proxyTarget.value = null
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
  }

  return {
    proxyTarget:  readonly(proxyTarget),
    allUsers:     readonly(allUsers),
    isProxyMode,
    effectiveUser,
    fetchAllUsers,
    setProxy,
    clearProxy,
  }
}
