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

const EDGE_FN = 'master-data'

export const useMaster = () => {
  const config = useRuntimeConfig()
  const cached = loadCache()

  /**
   * マスタの読み書きは Edge Function 経由（2026-08-15）。
   * ★sites / contractors / workers / subcontractors / vehicles / site_subcontractors は
   *  公開キー(anon)だけで全テナント分が読める状態だった。anon キーは LIFF の JS に
   *  埋め込まれて配信されるため、サイトを開けば誰でも入手できる。
   *  anon には身元が無くRLSの行フィルタでは絞れないので、身元をサーバ側で検証して
   *  service_role で読む形に寄せた。
   * ★ここに supabase.from('sites') 等を書き足さないこと。1箇所でも直叩きが残ると
   *  anon の権限を落とせず、穴が塞がらない。
   */
  async function callEf(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const supabase = useSupabase()
    const liff = useLiff()
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    const res = await $fetch<any>(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: { action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload },
    })
    if (!res?.ok) throw new Error(res?.error ?? 'master-data failed')
    return res
  }

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
    const r = await callEf('fetch')

    // 現場名 → 元請け名 のマップ（紐付け済みの現場のみ）。日報の現場絞り込みに使う。
    const contractorById = Object.fromEntries((r.contractors ?? []).map((c: any) => [c.id, c.name]))
    const siteContractors: Record<string, string> = {}
    const siteIds: Record<string, string> = {}
    const siteNameById: Record<string, string> = {}
    const siteWorkTimes: Record<string, { start: string | null; end: string | null }> = {}
    const siteBreaks: Record<string, { start: string; minutes: number }[]> = {}   // 現場名 → 既定休憩[{start,minutes}]。設定ある現場のみ収録。
    for (const site of (r.sites ?? []) as any[]) {
      if (site.contractor_id && contractorById[site.contractor_id]) siteContractors[site.name] = contractorById[site.contractor_id]
      siteIds[site.name] = site.id
      siteNameById[site.id] = site.name
      if (site.default_start_time || site.default_end_time) {
        siteWorkTimes[site.name] = { start: (site.default_start_time ?? null)?.slice(0, 5) ?? null, end: (site.default_end_time ?? null)?.slice(0, 5) ?? null }
      }
      // default_breaks(jsonb) → [{start,minutes}] に正規化（start必須・minutes>0のみ収録）
      if (Array.isArray(site.default_breaks) && site.default_breaks.length) {
        const wins = (site.default_breaks as any[])
          .filter(b => b && b.start && (Number(b.minutes) || 0) > 0)
          .map(b => ({ start: String(b.start).slice(0, 5), minutes: Number(b.minutes) || 0 }))
        if (wins.length) siteBreaks[site.name] = wins
      }
    }
    // 現場名 → 紐づく下請け業者名[]。未紐付け現場は未収録＝全件にフォールバック。
    const subNameById = Object.fromEntries(((r.subcontractors ?? []) as any[]).map((x: any) => [x.id, x.name]))
    const siteSubcontractors: Record<string, string[]> = {}
    for (const link of (r.siteSubcontractors ?? []) as any[]) {
      const sName = siteNameById[link.site_id]; const subName = subNameById[link.subcontractor_id]
      if (!sName || !subName) continue
      ;(siteSubcontractors[sName] ??= []).push(subName)
    }

    // 作業区分（現場作業/見積/事務…）と、現場×区分ごとの定時。
    //  ★定時は「現場だけ」でも「区分だけ」でも決まらない（事務は拠点で 08:30/08:00 と違う）。
    //   組をキーにして持つ。行が無い＝その組に定時なし。
    const workCategories = ((r.workCategories ?? []) as any[])
      .map((c: any) => ({ id: c.id, name: c.name, scope: c.scope ?? null }))
    const categoryHours: Record<string, { start: string | null; end: string | null; breaks: { start: string; minutes: number }[] | null }> = {}
    for (const h of (r.siteCategoryHours ?? []) as any[]) {
      const breaks = Array.isArray(h.default_breaks)
        ? (h.default_breaks as any[])
            .filter(b => b && b.start && (Number(b.minutes) || 0) > 0)
            .map(b => ({ start: String(b.start).slice(0, 5), minutes: Number(b.minutes) || 0 }))
        : null
      categoryHours[`${h.site_id}|${h.category_id}`] = {
        start: (h.default_start_time ?? null)?.slice(0, 5) ?? null,
        end:   (h.default_end_time ?? null)?.slice(0, 5) ?? null,
        breaks: breaks && breaks.length ? breaks : null,
      }
    }

    const data: MasterData = {
      sites:          (r.sites ?? []).map((x: any) => x.name),
      contractors:    (r.contractors ?? []).map((x: any) => x.name),
      workers:        (r.workers ?? []).map((x: any) => ({ id: x.id, name: x.name, role: x.role as 'factory' | 'site' })),
      subcontractors: (r.subcontractors ?? []).map((x: any) => x.name),
      vehicles:       r.vehicles ?? [],
      siteContractors,
      siteSubcontractors,
      siteIds,
      siteWorkTimes,
      siteBreaks,
      workCategories,
      categoryHours,
    }

    master.value = data
    saveCache(data)
    console.log('[Master] EF経由で取得:', data.sites.length, '現場', data.workers.length, '作業員')
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
  /** 元請け一覧（id付き）。出退勤の現場選択で「紐づく現場がある元請け」を出すのに使う。 */
  async function fetchContractors(): Promise<{ id: string; name: string }[]> {
    try {
      return ((await callEf('fetch')).contractors ?? []) as { id: string; name: string }[]
    } catch (e) {
      console.error('[Master] 元請けの取得に失敗:', e)
      return []
    }
  }

  /**
   * 現場名を保存（新規 or 既存は upsert で吸収）。EF経由。作った現場の id を返す。
   *
   * ★id を返し、siteIds にも入れること。ここを更新しないと呼び出し側が
   *  「今作った現場」の id を引けず、その回の保存が site_id 無しになる。
   *  スケジュール登録で実際にこれを踏み、本番144件が全部 site_id=NULL だった（2026-08-15）。
   */
  async function saveSite(name: string): Promise<string | undefined> {
    const nm = name.trim()
    if (!nm) return undefined
    // ★現場の新規作成は権限者(admin/office/site_manager)のみ。
    //  画面で選択肢を隠すだけでは REST直叩き/古いバンドル/下書き復元で通り得るため、
    //  EF 側（サーバ）でも permission_role を確認している。ここは早期に弾くためのUXガード。
    const perm = useWorkerPermission()
    await perm.resolveRole()
    if (!perm.canCreateSite.value) throw new Error('SITE_CREATE_FORBIDDEN')
    const res = await callEf('save-site', { name: nm })
    const id = (res?.id as string | undefined) ?? undefined
    const nextIds = id ? { ...(master.value.siteIds ?? {}), [nm]: id } : master.value.siteIds
    if (!master.value.sites.includes(nm)) {
      // 読み仮名は未知のため末尾に追加（並びは次回fetchでname_kana順に再構成される）
      master.value = { ...master.value, sites: [...master.value.sites, nm], siteIds: nextIds }
      saveCache(master.value)
    } else if (nextIds !== master.value.siteIds) {
      master.value = { ...master.value, siteIds: nextIds }
      saveCache(master.value)
    }
    return id
  }

  /** 元請け業者名を保存（新規 or 既存は upsert で吸収）。EF経由。 */
  async function saveContractor(name: string) {
    if (!name.trim()) return
    await callEf('save-contractor', { name: name.trim() })
    if (!master.value.contractors.includes(name.trim())) {
      master.value = { ...master.value, contractors: [...master.value.contractors, name.trim()].sort((a, b) => a.localeCompare(b, 'ja')) }
      saveCache(master.value)
    }
  }

  /** 下請け業者名を保存。siteName を渡すとその現場へ自動で紐付ける（日報からの新規作成時）。EF経由。 */
  async function saveSub(name: string, siteName?: string) {
    if (!name.trim()) return
    // 紐付けは EF 側で best-effort（失敗しても業者の作成は成立する）
    const r = await callEf('save-sub', { name: name.trim(), ...(siteName?.trim() ? { siteName: siteName.trim() } : {}) })
    if (!master.value.subcontractors.includes(name.trim())) {
      master.value = { ...master.value, subcontractors: [...master.value.subcontractors, name.trim()].sort((a, b) => a.localeCompare(b, 'ja')) }
      saveCache(master.value)
    }
    if (r?.linked && siteName?.trim()) {
      const sName = siteName.trim()
      const cur = master.value.siteSubcontractors ?? {}
      const list = cur[sName] ?? []
      if (!list.includes(name.trim())) {
        master.value = { ...master.value, siteSubcontractors: { ...cur, [sName]: [...list, name.trim()] } }
        saveCache(master.value)
      }
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
    fetchContractors,
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
    workCategories:      computed(() => master.value.workCategories ?? []),
    categoryHours:       computed(() => master.value.categoryHours ?? {}),
    siteContractors:     computed(() => master.value.siteContractors ?? {}),
    siteWorkTimes:       computed(() => master.value.siteWorkTimes ?? {}),
    siteBreaks:          computed(() => master.value.siteBreaks ?? {}),
    contractorNames:     computed(() => (master.value.contractors ?? []).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    // 現場プルダウンの2階層表示用: 元請け(五十音順)ごとに現場をグループ化。
    // 紐付けなしの現場は最後のグループ(contractorName=null)にまとめる。空グループは含めない。
    // 注: グループ内の現場は再ソートしない。sites(L108/66行目のfetchクエリ)が既に
    // name_kana昇順(nullは最後)→name昇順で取得済みのため、filter()はその順序を保持する。
    // ここで localeCompare(name) 等により再ソートすると、name_kanaを持たないため
    // 漢字の読み仮名を無視した並びになり、かえって五十音順が崩れる(再ソートしないことが正)。
    siteGroupsByContractor: computed<{ contractorName: string | null; sites: string[] }[]>(() => {
      const sites = master.value.sites.filter((n) => n !== '__unset__')
      const map = master.value.siteContractors ?? {}
      const orderedContractors = (master.value.contractors ?? []).slice().sort((a, b) => a.localeCompare(b, 'ja'))
      const groups: { contractorName: string | null; sites: string[] }[] = []
      for (const c of orderedContractors) {
        const linked = sites.filter((n) => map[n] === c)
        if (linked.length) groups.push({ contractorName: c, sites: linked })
      }
      const unlinked = sites.filter((n) => !map[n])
      if (unlinked.length) groups.push({ contractorName: null, sites: unlinked })
      return groups
    }),
    workerNames:         computed(() => master.value.workers.map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    factoryWorkerNames:  computed(() => { const ws = master.value.workers; const hasRole = ws.some(w => w.role); return ws.filter(w => !hasRole || w.role === 'factory').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja')) }),
    siteWorkerNames:     computed(() => { const ws = master.value.workers; const hasRole = ws.some(w => w.role); return ws.filter(w => !hasRole || w.role === 'site').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja')) }),
    subcontractorNames:  computed(() => master.value.subcontractors.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    vehicleNames:        computed(() => master.value.vehicles),
  }
}
