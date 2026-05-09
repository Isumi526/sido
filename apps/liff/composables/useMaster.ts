// ============================================================
//  apps/liff / composables/useMaster.ts
//  マスタデータ取得
//  優先順: Supabase → GAS → フォールバック（ハードコード）
// ============================================================
import type { MasterData } from '~/types'

const FALLBACK: MasterData = {
  sites: [],
  workers: [
    // 工場・事務所
    { name: '今井',   unitPrice: 30000, role: 'factory' },
    { name: '伊藤',   unitPrice: 23000, role: 'factory' },
    { name: '野村',   unitPrice: 23000, role: 'factory' },
    { name: '毛利',   unitPrice: 20000, role: 'factory' },
    { name: '鵜飼',   unitPrice: 20000, role: 'factory' },
    { name: '相馬',   unitPrice: 20000, role: 'factory' },
    { name: 'Worker07', unitPrice: 20000, role: 'factory' },
    { name: '前田',   unitPrice: 20000, role: 'factory' },
    { name: 'ジェイ', unitPrice: 20000, role: 'factory' },
    { name: 'ヌル',   unitPrice: 20000, role: 'factory' },
    { name: 'デデ',   unitPrice: 20000, role: 'factory' },
    { name: 'アチェ', unitPrice: 20000, role: 'factory' },
    { name: '平床',   unitPrice: 20000, role: 'factory' },
    { name: '作長',   unitPrice: 20000, role: 'factory' },
    // 現場
    { name: '大塚',       unitPrice: 30000, role: 'site' },
    { name: '小島',       unitPrice: 30000, role: 'site' },
    { name: '山本',       unitPrice: 20000, role: 'site' },
    { name: 'Worker18',       unitPrice: 20000, role: 'site' },
    { name: 'Worker19', unitPrice: 20000, role: 'site' },
    { name: 'アリフ',     unitPrice: 20000, role: 'site' },
    { name: 'Worker21',   unitPrice: 20000, role: 'site' },
    { name: 'ハイ',       unitPrice: 20000, role: 'site' },
    { name: 'ガイ',       unitPrice: 20000, role: 'site' },
    { name: '辻',         unitPrice: 20000, role: 'site' },
    { name: '佐藤',       unitPrice: 20000, role: 'site' },
    { name: 'さや',       unitPrice: 20000, role: 'site' },
    { name: '片岡',       unitPrice: 20000, role: 'site' },
    { name: 'Worker28',       unitPrice: 20000, role: 'site' },
    { name: '浅野',       unitPrice: 23000, role: 'site' },
    { name: '横井',       unitPrice: 20000, role: 'site' },
    { name: '白石',       unitPrice: 23000, role: 'site' },
    { name: '香田',       unitPrice: 20000, role: 'site' },
    { name: 'Worker33',       unitPrice: 20000, role: 'site' },
    { name: 'Worker34',       unitPrice: 20000, role: 'site' },
    { name: 'テストユーザー', unitPrice: 0, role: 'site' },
  ],
  subcontractors: ['VendorA', 'VendorB', 'VendorC', 'VendorD', 'VendorE', 'VendorF', 'VendorG', 'VendorH'],
  vehicles: ['ハイエース', 'キャラバン', 'プロボックス', 'その他'],
}

const CACHE_KEY = 'sido_master_cache'
const CACHE_TTL = 30 * 60 * 1000 // 30分

function loadCache(): MasterData | null {
  if (import.meta.server) return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}

function saveCache(data: MasterData) {
  if (import.meta.server) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
  } catch { /* quota超過等は無視 */ }
}

export const useMaster = () => {
  const config = useRuntimeConfig()
  const cached = loadCache()
  const master = useState<MasterData>('master', () => cached ?? FALLBACK)
  const loading = useState<boolean>('master-loading', () => false)

  async function fetch(force = false) {
    // キャッシュが有効で強制更新でなければスキップ
    if (!force && loadCache()) {
      _fetchFromSupabase().catch(() => _fetchFromGas().catch(() => {}))
      return
    }

    loading.value = true
    try {
      await _fetchFromSupabase()
    } catch {
      await _fetchFromGas().catch(() => {})
    }
    loading.value = false
  }

  async function _fetchFromSupabase() {
    const supabase  = useSupabase()
    const { getAccountId } = useAccount()
    const accountId = await getAccountId()
    if (!accountId) throw new Error('account not found')

    const [sitesRes, workersRes, subsRes, vehiclesRes] = await Promise.all([
      supabase.from('sites').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('workers').select('id, name, role, unit_price').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('subcontractors').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('vehicles').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
    ])

    if (workersRes.error) throw workersRes.error

    const data: MasterData = {
      sites:          (sitesRes.data    ?? []).map(r => r.name),
      workers:        (workersRes.data  ?? []).map(r => ({ id: r.id, name: r.name, role: r.role as 'factory' | 'site', unitPrice: r.unit_price })),
      subcontractors: (subsRes.data     ?? []).map(r => r.name),
      vehicles:       (vehiclesRes.data ?? []).map(r => r.name),
    }

    master.value = data
    saveCache(data)
    console.log('[Master] Supabaseから取得:', data.sites.length, '現場', data.workers.length, '作業員')
  }

  async function _fetchFromGas() {
    if (!config.public.gasUrl) return
    const res = await $fetch<MasterData>(
      config.public.gasUrl + '?action=getMaster',
      { method: 'GET' }
    )
    if (res.sites?.length || res.workers?.length) {
      master.value = res
      saveCache(res)
      console.log('[Master] GASから取得:', res.sites?.length, '現場')
    }
  }

  /** 現場名を Supabase に保存（新規 or 既存は upsert で吸収） */
  async function saveSite(name: string) {
    if (!name.trim()) return
    try {
      const supabase  = useSupabase()
      const { getAccountId } = useAccount()
      const accountId = await getAccountId()
      await supabase
        .from('sites')
        .upsert({ name: name.trim(), account_id: accountId }, { onConflict: 'name,account_id' })
      // ローカルのマスタにも即時追加（重複チェック）
      if (!master.value.sites.includes(name.trim())) {
        master.value = { ...master.value, sites: [...master.value.sites, name.trim()].sort((a, b) => a.localeCompare(b, 'ja')) }
        saveCache(master.value)
      }
    } catch (e) {
      console.warn('[Master] saveSite 失敗:', e)
    }
  }

  return {
    master:          readonly(master),
    loading:         readonly(loading),
    fetch,
    saveSite,
    siteNames:           computed(() => master.value.sites.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    workerNames:         computed(() => master.value.workers.map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    factoryWorkerNames:  computed(() => { const ws = master.value.workers; const hasRole = ws.some(w => w.role); return ws.filter(w => !hasRole || w.role === 'factory').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja')) }),
    siteWorkerNames:     computed(() => { const ws = master.value.workers; const hasRole = ws.some(w => w.role); return ws.filter(w => !hasRole || w.role === 'site').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja')) }),
    subcontractorNames:  computed(() => master.value.subcontractors.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    vehicleNames:        computed(() => master.value.vehicles),
  }
}
