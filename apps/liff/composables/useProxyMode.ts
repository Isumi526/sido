// ============================================================
//  composables/useProxyMode.ts
//  代理入力モード管理
//
//  代理操作者（can_proxy = true）が他作業員に成り代わって
//  日報・経費などをその作業員として送信できる機能。
//  代理先はLINE未登録の作業員も含む全作業員から選択可。
//  セッション中のみ有効（タブを閉じると解除）。
// ============================================================

export interface ProxyWorker {
  id:           string   // workers.id
  name:         string   // workers.name
  worker_role:  'factory' | 'site'
  line_user_id: string | null  // users.line_user_id（LINE未登録ならnull）
}

const SESSION_KEY = 'sido_proxy_target'

export const useProxyMode = () => {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()

  // グローバル状態（全ページ共有）
  const proxyTarget = useState<ProxyWorker | null>('proxy_target', () => {
    if (import.meta.server) return null
    try {
      const stored = sessionStorage.getItem(SESSION_KEY)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  const allWorkers = useState<ProxyWorker[]>('proxy_all_workers', () => [])

  // 代理中かどうか
  const isProxyMode = computed(() => proxyTarget.value !== null)

  // 全作業員を取得（代理先選択用）
  // workers テーブル全員 + LINE登録済みなら line_user_id も付与
  async function fetchAllWorkers(selfWorkerId?: string | null) {
    const accountId = await getAccountId()
    if (!accountId) return

    const [{ data: workersData }, { data: usersData }] = await Promise.all([
      supabase
        .from('workers')
        .select('id, name, role')
        .eq('account_id', accountId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('users')
        .select('worker_id, line_user_id')
        .eq('account_id', accountId)
        .not('worker_id', 'is', null),
    ])

    // worker_id → line_user_id のマップ
    const lineUserMap = new Map<string, string>(
      (usersData ?? []).map((u: any) => [u.worker_id, u.line_user_id])
    )

    allWorkers.value = ((workersData ?? []) as any[])
      .filter(w => w.id !== selfWorkerId)  // 自分自身は除外
      .map(w => ({
        id:           w.id,
        name:         w.name,
        worker_role:  w.role as 'factory' | 'site',
        line_user_id: lineUserMap.get(w.id) ?? null,
      }))
  }

  // 代理先を設定
  function setProxy(worker: ProxyWorker) {
    proxyTarget.value = worker
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(worker)) } catch {}
  }

  // 代理解除
  function clearProxy() {
    proxyTarget.value = null
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
  }

  return {
    proxyTarget:   readonly(proxyTarget),
    allWorkers:    readonly(allWorkers),
    isProxyMode,
    fetchAllWorkers,
    setProxy,
    clearProxy,
  }
}
