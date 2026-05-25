// ============================================================
//  composables/useProxyMode.ts
//  代理入力モード管理
//
//  管理画面でAさんの代理人にBさんとCさんを設定（worker_proxies テーブル）
//  BさんとCさんのLIFFにAさんが選択肢として表示され、Aさんとして操作できる
//  セッション中のみ有効（タブを閉じると解除）
// ============================================================

export interface ProxyWorker {
  id:           string        // workers.id（代理先）
  name:         string
  worker_role:  'factory' | 'site'
  line_user_id: string | null // LINE未登録ならnull
}

const SESSION_KEY = 'sido_proxy_target'

export const useProxyMode = () => {
  const supabase = useSupabase()
  const { getAccountId } = useAccount()

  // グローバル状態（全ページ共有）
  const proxyTarget  = useState<ProxyWorker | null>('proxy_target', () => {
    if (import.meta.server) return null
    try {
      const stored = sessionStorage.getItem(SESSION_KEY)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  // 自分が代理人として登録されている作業員一覧
  const proxyTargets = useState<ProxyWorker[]>('proxy_targets', () => [])

  const isProxyMode  = computed(() => proxyTarget.value !== null)
  const canProxy     = computed(() => proxyTargets.value.length > 0)

  // 自分のworker_idを元に、worker_proxies.proxy_operator_id = 自分 の作業員を取得
  async function fetchProxyTargets(myWorkerId: string | null | undefined) {
    if (!myWorkerId) { proxyTargets.value = []; return }
    const accountId = await getAccountId()
    if (!accountId) return

    // worker_proxies から自分が代理人になっている worker_id を取得
    const [{ data: proxyRels }, { data: usersData }] = await Promise.all([
      supabase
        .from('worker_proxies')
        .select('worker_id')
        .eq('proxy_operator_id', myWorkerId)
        .eq('account_id', accountId),
      supabase
        .from('users')
        .select('worker_id, line_user_id')
        .eq('account_id', accountId)
        .not('worker_id', 'is', null),
    ])

    const workerIds = (proxyRels ?? []).map((r: any) => r.worker_id as string)
    if (workerIds.length === 0) { proxyTargets.value = []; return }

    const { data: workersData } = await supabase
      .from('workers')
      .select('id, name, role')
      .in('id', workerIds)
      .eq('active', true)
      .order('name')

    const lineUserMap = new Map<string, string>(
      (usersData ?? []).map((u: any) => [u.worker_id, u.line_user_id])
    )

    proxyTargets.value = ((workersData ?? []) as any[]).map(w => ({
      id:           w.id,
      name:         w.name,
      worker_role:  w.role as 'factory' | 'site',
      line_user_id: lineUserMap.get(w.id) ?? null,
    }))
  }

  function setProxy(worker: ProxyWorker) {
    proxyTarget.value = worker
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(worker)) } catch {}
  }

  function clearProxy() {
    proxyTarget.value = null
    try { sessionStorage.removeItem(SESSION_KEY) } catch {}
  }

  return {
    proxyTarget:       readonly(proxyTarget),
    proxyTargets:      readonly(proxyTargets),
    isProxyMode,
    canProxy,
    fetchProxyTargets,
    setProxy,
    clearProxy,
  }
}
