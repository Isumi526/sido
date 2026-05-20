// ============================================================
//  composables/useSchedules.ts
//  予定管理（CRUD）
// ============================================================

export type ScheduleCategory = 'work' | 'off' | 'training' | 'meeting' | 'other'

export interface Schedule {
  id:          string
  account_id:  string | null
  worker_id:   string
  title:       string
  description: string | null
  category:    ScheduleCategory
  site_id:     string | null
  color:       string | null
  all_day:     boolean
  start_date:  string   // 'YYYY-MM-DD'
  end_date:    string   // 'YYYY-MM-DD'
  start_time:  string | null  // 'HH:MM'
  end_time:    string | null  // 'HH:MM'
  worker?:     { id: string; name: string }
}

export interface ScheduleForm {
  title:       string
  description: string
  category:    ScheduleCategory
  site_id:     string
  all_day:     boolean
  start_date:  string
  end_date:    string
  start_time:  string
  end_time:    string
}

export const CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  work:     '現場作業',
  off:      '休み',
  training: '研修',
  meeting:  '会議',
  other:    'その他',
}

export const CATEGORY_COLORS: Record<ScheduleCategory, string> = {
  work:     '#06C755',
  off:      '#94a3b8',
  training: '#f59e0b',
  meeting:  '#3b82f6',
  other:    '#a855f7',
}

// LocalStorage キー（表示する作業員IDのリスト）
const VISIBLE_WORKERS_KEY = 'calendar_visible_workers'

function loadVisibleWorkers(): string[] {
  if (import.meta.server) return []
  try {
    const raw = localStorage.getItem(VISIBLE_WORKERS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveVisibleWorkers(ids: string[]) {
  if (import.meta.server) return
  try { localStorage.setItem(VISIBLE_WORKERS_KEY, JSON.stringify(ids)) } catch {}
}

export const useSchedules = () => {
  const supabase   = useSupabase()
  const { profile } = useLiff()
  const master     = useMaster()
  const config     = useRuntimeConfig()

  const schedules      = ref<Schedule[]>([])
  const loading        = ref(false)
  const error          = ref<string | null>(null)
  const visibleWorkerIds = ref<string[]>(loadVisibleWorkers())

  // ログインユーザーの worker_id を取得
  const myWorkerId = computed(() => {
    const lineUserId = profile.value?.userId
    if (!lineUserId) return null
    // Supabase から users テーブル経由で worker_id を引く
    return _myWorkerIdCache.value
  })

  const _myWorkerIdCache = ref<string | null>(null)

  async function resolveMyWorkerId(): Promise<string | null> {
    if (_myWorkerIdCache.value) return _myWorkerIdCache.value
    const lineUserId = profile.value?.userId
    if (!lineUserId) return null
    try {
      const accountId = config.public.accountSlug
      // account_id で絞り込み
      const { data: accountData } = await supabase
        .from('accounts')
        .select('id')
        .eq('slug', accountId)
        .single()
      if (!accountData) return null

      const { data } = await supabase
        .from('users')
        .select('worker_id')
        .eq('line_user_id', lineUserId)
        .eq('account_id', accountData.id)
        .single()
      _myWorkerIdCache.value = data?.worker_id ?? null
      return _myWorkerIdCache.value
    } catch { return null }
  }

  // 表示対象の worker_id リスト（自分 + 追加設定した人）
  const targetWorkerIds = computed<string[]>(() => {
    if (!_myWorkerIdCache.value) return []
    const ids = new Set([_myWorkerIdCache.value, ...visibleWorkerIds.value])
    return [...ids]
  })

  // 指定期間の予定を取得
  async function fetchSchedules(from: string, to: string) {
    loading.value = true
    error.value   = null
    try {
      await resolveMyWorkerId()
      if (!targetWorkerIds.value.length) return

      const { data, error: err } = await supabase
        .from('schedules')
        .select('*, worker:workers(id, name)')
        .in('worker_id', targetWorkerIds.value)
        .lte('start_date', to)
        .gte('end_date', from)
        .order('start_date')

      if (err) throw err
      schedules.value = (data ?? []) as Schedule[]
    } catch (e) {
      error.value = e instanceof Error ? e.message : '取得に失敗しました'
    } finally {
      loading.value = false
    }
  }

  async function createSchedule(form: ScheduleForm, workerId?: string) {
    const wid = workerId ?? (await resolveMyWorkerId())
    if (!wid) throw new Error('作業員情報が取得できません')

    const payload = buildPayload(form, wid)
    const { data, error: err } = await supabase
      .from('schedules')
      .insert(payload)
      .select('*, worker:workers(id, name)')
      .single()
    if (err) throw err
    schedules.value.push(data as Schedule)
    return data as Schedule
  }

  async function updateSchedule(id: string, form: Partial<ScheduleForm>) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (form.title       !== undefined) updates.title       = form.title
    if (form.description !== undefined) updates.description = form.description || null
    if (form.category    !== undefined) updates.category    = form.category
    if (form.site_id     !== undefined) updates.site_id     = form.site_id || null
    if (form.all_day     !== undefined) updates.all_day     = form.all_day
    if (form.start_date  !== undefined) updates.start_date  = form.start_date
    if (form.end_date    !== undefined) updates.end_date    = form.end_date
    if (!form.all_day) {
      updates.start_time = form.start_time || null
      updates.end_time   = form.end_time   || null
    } else {
      updates.start_time = null
      updates.end_time   = null
    }

    const { data, error: err } = await supabase
      .from('schedules')
      .update(updates)
      .eq('id', id)
      .select('*, worker:workers(id, name)')
      .single()
    if (err) throw err
    const idx = schedules.value.findIndex(s => s.id === id)
    if (idx !== -1) schedules.value[idx] = data as Schedule
    return data as Schedule
  }

  async function deleteSchedule(id: string) {
    const { error: err } = await supabase.from('schedules').delete().eq('id', id)
    if (err) throw err
    schedules.value = schedules.value.filter(s => s.id !== id)
  }

  // 追加表示する作業員を設定
  function setVisibleWorkers(ids: string[]) {
    visibleWorkerIds.value = ids
    saveVisibleWorkers(ids)
  }

  return {
    schedules: readonly(schedules),
    loading:   readonly(loading),
    error:     readonly(error),
    myWorkerId: _myWorkerIdCache,
    visibleWorkerIds,
    targetWorkerIds,
    resolveMyWorkerId,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    setVisibleWorkers,
  }
}

function buildPayload(form: ScheduleForm, workerId: string) {
  return {
    worker_id:   workerId,
    title:       form.title,
    description: form.description || null,
    category:    form.category,
    site_id:     form.site_id || null,
    all_day:     form.all_day,
    start_date:  form.start_date,
    end_date:    form.end_date,
    start_time:  form.all_day ? null : (form.start_time || null),
    end_time:    form.all_day ? null : (form.end_time   || null),
  }
}
