// ============================================================
//  apps/liff / composables/useMaster.ts
//  マスタデータ取得
//  優先順: Supabase → GAS → フォールバック（空）
// ============================================================
import type { MasterData } from '~/types'

const FALLBACK: MasterData = {
  sites:          [],
  contractors:    [],
  workers:        [{ name: 'テストユーザー', role: 'site' }],
  subcontractors: [],
  vehicles:       ['ハイエース', 'キャラバン', 'プロボックス', 'その他'],
}

const CACHE_KEY = 'app_master_cache'
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

    const [sitesRes, contractorsRes, workersRes, subsRes, vehiclesRes, siteSubsRes] = await Promise.all([
      supabase.from('sites').select('id, name, contractor_id, default_start_time, default_end_time').eq('active', true).eq('account_id', accountId).order('name_kana', { nullsFirst: false }).order('name'),
      supabase.from('contractors').select('id, name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('workers').select('id, name, role').eq('active', true).eq('account_id', accountId).order('sort_order'),  // unit_price は取得しない（anon公開キーで他人の時給がliffに降りないように・#4）
      supabase.from('subcontractors').select('id, name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('vehicles').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      supabase.from('site_subcontractors').select('site_id, subcontractor_id').eq('account_id', accountId),
    ])

    if (workersRes.error) throw workersRes.error

    // 現場名 → 元請け名 のマップ（紐付け済みの現場のみ）。日報の現場絞り込みに使う。
    const contractorById = Object.fromEntries((contractorsRes.data ?? []).map((c: any) => [c.id, c.name]))
    const siteContractors: Record<string, string> = {}
    const siteIds: Record<string, string> = {}
    const siteNameById: Record<string, string> = {}
    const siteWorkTimes: Record<string, { start: string | null; end: string | null }> = {}
    for (const s of (sitesRes.data ?? []) as any[]) {
      if (s.contractor_id && contractorById[s.contractor_id]) siteContractors[s.name] = contractorById[s.contractor_id]
      siteIds[s.name] = s.id
      siteNameById[s.id] = s.name
      if (s.default_start_time || s.default_end_time) {
        siteWorkTimes[s.name] = { start: (s.default_start_time ?? null)?.slice(0, 5) ?? null, end: (s.default_end_time ?? null)?.slice(0, 5) ?? null }
      }
    }
    // 現場名 → 紐づく下請け業者名[]（site_subcontractors join）。未紐付け現場は未収録＝全件にフォールバック。
    const subNameById = Object.fromEntries(((subsRes.data ?? []) as any[]).map(r => [r.id, r.name]))
    const siteSubcontractors: Record<string, string[]> = {}
    for (const link of (siteSubsRes.data ?? []) as any[]) {
      const sName = siteNameById[link.site_id]; const subName = subNameById[link.subcontractor_id]
      if (!sName || !subName) continue
      ;(siteSubcontractors[sName] ??= []).push(subName)
    }

    const data: MasterData = {
      sites:          (sitesRes.data       ?? []).map(r => r.name),
      contractors:    (contractorsRes.data ?? []).map(r => r.name),
      workers:        (workersRes.data     ?? []).map(r => ({ id: r.id, name: r.name, role: r.role as 'factory' | 'site' })),
      subcontractors: (subsRes.data        ?? []).map(r => r.name),
      vehicles:       (vehiclesRes.data    ?? []).map(r => r.name),
      siteContractors,
      siteSubcontractors,
      siteIds,
      siteWorkTimes,
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

  // 新規マスタ保存は呼び出し側（useReport）で完了を await し失敗を検知するため、
  //  エラーは握りつぶさず throw する。ローカル state/cache への反映は upsert 成功後のみ。
  /** 現場名を Supabase に保存（新規 or 既存は upsert で吸収） */
  async function saveSite(name: string) {
    if (!name.trim()) return
    const supabase  = useSupabase()
    const { getAccountId } = useAccount()
    const accountId = await getAccountId()
    if (!accountId) throw new Error('account not found')
    const { error } = await supabase
      .from('sites')
      .upsert({ name: name.trim(), account_id: accountId }, { onConflict: 'name,account_id' })
    if (error) throw error
    if (!master.value.sites.includes(name.trim())) {
      // 読み仮名は未知のため末尾に追加（並びは次回fetchでname_kana順に再構成される）
      master.value = { ...master.value, sites: [...master.value.sites, name.trim()] }
      saveCache(master.value)
    }
  }

  /** 元請け業者名を Supabase に保存（新規 or 既存は upsert で吸収） */
  async function saveContractor(name: string) {
    if (!name.trim()) return
    const supabase  = useSupabase()
    const { getAccountId } = useAccount()
    const accountId = await getAccountId()
    if (!accountId) throw new Error('account not found')
    const { error } = await supabase
      .from('contractors')
      .upsert({ name: name.trim(), account_id: accountId }, { onConflict: 'name,account_id' })
    if (error) throw error
    if (!master.value.contractors.includes(name.trim())) {
      master.value = { ...master.value, contractors: [...master.value.contractors, name.trim()].sort((a, b) => a.localeCompare(b, 'ja')) }
      saveCache(master.value)
    }
  }

  /** 下請け業者名を Supabase に保存。siteName を渡すとその現場へ自動で紐付ける（日報からの新規作成時）。 */
  async function saveSub(name: string, siteName?: string) {
    if (!name.trim()) return
    const supabase  = useSupabase()
    const { getAccountId } = useAccount()
    const accountId = await getAccountId()
    if (!accountId) throw new Error('account not found')
    const { error } = await supabase
      .from('subcontractors')
      .upsert({ name: name.trim(), account_id: accountId }, { onConflict: 'name,account_id' })
    if (error) throw error
    if (!master.value.subcontractors.includes(name.trim())) {
      master.value = { ...master.value, subcontractors: [...master.value.subcontractors, name.trim()].sort((a, b) => a.localeCompare(b, 'ja')) }
      saveCache(master.value)
    }
    // 現場への自動紐付け（best-effort：失敗しても業者作成は成立させる）
    if (siteName?.trim()) {
      try {
        const sName = siteName.trim()
        const [{ data: subRow }, { data: siteRow }] = await Promise.all([
          supabase.from('subcontractors').select('id').eq('name', name.trim()).eq('account_id', accountId).maybeSingle(),
          supabase.from('sites').select('id').eq('name', sName).eq('account_id', accountId).maybeSingle(),
        ])
        if (subRow?.id && siteRow?.id) {
          await supabase.from('site_subcontractors').upsert(
            { site_id: siteRow.id, subcontractor_id: subRow.id, account_id: accountId },
            { onConflict: 'site_id,subcontractor_id' },
          )
          const cur = master.value.siteSubcontractors ?? {}
          const list = cur[sName] ?? []
          if (!list.includes(name.trim())) {
            master.value = { ...master.value, siteSubcontractors: { ...cur, [sName]: [...list, name.trim()] } }
            saveCache(master.value)
          }
        }
      } catch { /* 紐付け失敗は無視（業者は作成済み） */ }
    }
  }

  /** 指定現場に紐づく下請け業者名[]。紐付けゼロの現場は全件にフォールバック（後方互換）。
   *  include に現在選択中の業者名を渡すと、紐付け外でも選択肢に残す（編集モードで消えない）。 */
  function subNamesForSite(siteName: string | null | undefined, include?: string | null): string[] {
    const all = master.value.subcontractors.slice().sort((a, b) => a.localeCompare(b, 'ja'))
    const links = siteName ? master.value.siteSubcontractors?.[siteName] : null
    if (!links || links.length === 0) return all
    const set = new Set(links)
    const filtered = all.filter(n => set.has(n))
    if (include && include !== '__other__' && all.includes(include) && !set.has(include)) filtered.push(include)
    return filtered
  }

  return {
    master:          readonly(master),
    loading:         readonly(loading),
    fetch,
    saveSite,
    saveContractor,
    saveSub,
    subNamesForSite,
    siteIds:             computed(() => master.value.siteIds ?? {}),
    siteSubcontractors:  computed(() => master.value.siteSubcontractors ?? {}),
    // sites は Supabase 側で name_kana 昇順(null最後)→name に整列済みのため、その順序を保持する（50音順）
    siteNames:           computed(() => master.value.sites.slice()),
    siteContractors:     computed(() => master.value.siteContractors ?? {}),
    siteWorkTimes:       computed(() => master.value.siteWorkTimes ?? {}),
    contractorNames:     computed(() => (master.value.contractors ?? []).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    workerNames:         computed(() => master.value.workers.map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    factoryWorkerNames:  computed(() => { const ws = master.value.workers; const hasRole = ws.some(w => w.role); return ws.filter(w => !hasRole || w.role === 'factory').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja')) }),
    siteWorkerNames:     computed(() => { const ws = master.value.workers; const hasRole = ws.some(w => w.role); return ws.filter(w => !hasRole || w.role === 'site').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja')) }),
    subcontractorNames:  computed(() => master.value.subcontractors.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    vehicleNames:        computed(() => master.value.vehicles),
  }
}
