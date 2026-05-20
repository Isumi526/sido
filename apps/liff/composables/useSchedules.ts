// ============================================================
//  composables/useSchedules.ts
//  予定管理（CRUD）+ グループ共有対応
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
  is_public:   boolean
  all_day:     boolean
  start_date:  string   // 'YYYY-MM-DD'
  end_date:    string   // 'YYYY-MM-DD'
  start_time:  string | null  // 'HH:MM'
  end_time:    string | null  // 'HH:MM'
  worker?:     { id: string; name: string }
}

export interface ScheduleForm {
  title:            string
  description:      string
  category:         ScheduleCategory
  site_id:          string
  all_day:          boolean
  start_date:       string
  end_date:         string
  start_time:       string
  end_time:         string
  is_public:        boolean    // 公開フラグ
  group_ids:        string[]   // 共有先グループID
  recurrence_rule:  string     // '' | 'daily' | 'weekly' | 'monthly' | 'yearly'
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

export const useSchedules = () => {
  const supabase    = useSupabase()
  const { profile } = useLiff()
  const config      = useRuntimeConfig()

  const schedules = ref<Schedule[]>([])
  const loading   = ref(false)
  const error     = ref<string | null>(null)

  const _myWorkerIdCache = ref<string | null>(null)

  const myWorkerId = computed(() => _myWorkerIdCache.value)

  async function resolveMyWorkerId(): Promise<string | null> {
    if (_myWorkerIdCache.value) return _myWorkerIdCache.value
    const lineUserId = profile.value?.userId
    if (!lineUserId) return null
    try {
      const accountId = config.public.accountSlug
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

  // ──────────────────────────────────────────────────────
  // 予定取得
  //   - 常に自分の予定を取得
  //   - sharedGroupIds が指定されていれば、そのグループに共有されている
  //     公開予定も取得してマージ
  // ──────────────────────────────────────────────────────
  async function fetchSchedules(from: string, to: string, sharedGroupIds: string[] = [], workerIdOverride?: string | null) {
    loading.value = true
    error.value   = null
    try {
      await resolveMyWorkerId()
      const wid = workerIdOverride ?? _myWorkerIdCache.value
      if (!wid) return

      // 1. 自分の予定（is_public 問わず全件）
      const { data: ownData, error: ownErr } = await supabase
        .from('schedules')
        .select('*, worker:workers(id, name)')
        .eq('worker_id', wid)
        .lte('start_date', to)
        .gte('end_date', from)
        .order('start_date')
      if (ownErr) throw ownErr

      const result: Schedule[] = (ownData ?? []) as Schedule[]
      const ownIds = new Set(result.map(s => s.id))

      // 2. 選択グループに共有されている他人の公開予定
      if (sharedGroupIds.length) {
        const { data: shareRows } = await supabase
          .from('schedule_group_shares')
          .select('schedule_id')
          .in('group_id', sharedGroupIds)

        const scheduleIds = [...new Set((shareRows ?? []).map((r: any) => r.schedule_id))]

        if (scheduleIds.length) {
          const { data: sharedData } = await supabase
            .from('schedules')
            .select('*, worker:workers(id, name)')
            .in('id', scheduleIds)
            .eq('is_public', true)
            .lte('start_date', to)
            .gte('end_date', from)
          for (const s of (sharedData ?? [])) {
            if (!ownIds.has((s as Schedule).id)) result.push(s as Schedule)
          }
        }
      }

      result.sort((a, b) => a.start_date.localeCompare(b.start_date))
      schedules.value = result
    } catch (e) {
      error.value = e instanceof Error ? e.message : '取得に失敗しました'
    } finally {
      loading.value = false
    }
  }

  // ──────────────────────────────────────────────────────
  // 予定作成
  // ──────────────────────────────────────────────────────
  async function createSchedule(form: ScheduleForm, workerId?: string) {
    const wid = workerId ?? (await resolveMyWorkerId())
    if (!wid) throw new Error('作業員情報が取得できません')

    const { data, error: err } = await supabase
      .from('schedules')
      .insert(buildPayload(form, wid))
      .select('*, worker:workers(id, name)')
      .single()
    if (err) throw err

    const schedule = data as Schedule
    schedules.value.push(schedule)

    // グループ共有レコードを保存
    await syncGroupShares(supabase, schedule.id, form.is_public ? form.group_ids : [])
    return schedule
  }

  // ──────────────────────────────────────────────────────
  // 予定更新
  // ──────────────────────────────────────────────────────
  async function updateSchedule(id: string, form: Partial<ScheduleForm>) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (form.title       !== undefined) updates.title       = form.title
    if (form.description !== undefined) updates.description = form.description || null
    if (form.category    !== undefined) updates.category    = form.category
    if (form.site_id     !== undefined) updates.site_id     = form.site_id || null
    if (form.is_public        !== undefined) updates.is_public       = form.is_public
    if (form.recurrence_rule  !== undefined) updates.recurrence_rule = form.recurrence_rule || null
    if (form.all_day          !== undefined) updates.all_day         = form.all_day
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

    // グループ共有を同期
    if (form.group_ids !== undefined || form.is_public !== undefined) {
      const isPublic = form.is_public ?? schedules.value[idx]?.is_public ?? true
      await syncGroupShares(supabase, id, isPublic ? (form.group_ids ?? []) : [])
    }

    return data as Schedule
  }

  // ──────────────────────────────────────────────────────
  // 予定削除
  // ──────────────────────────────────────────────────────
  async function deleteSchedule(id: string) {
    const { error: err } = await supabase.from('schedules').delete().eq('id', id)
    if (err) throw err
    schedules.value = schedules.value.filter(s => s.id !== id)
  }

  // ──────────────────────────────────────────────────────
  // 予定のグループ共有先を取得
  // ──────────────────────────────────────────────────────
  async function fetchScheduleGroupIds(scheduleId: string): Promise<string[]> {
    const { data } = await supabase
      .from('schedule_group_shares')
      .select('group_id')
      .eq('schedule_id', scheduleId)
    return (data ?? []).map((r: any) => r.group_id)
  }

  return {
    schedules:        readonly(schedules),
    loading:          readonly(loading),
    error:            readonly(error),
    myWorkerId,
    resolveMyWorkerId,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    fetchScheduleGroupIds,
  }
}

// ──────────────────────────────────────────────────────
// ヘルパー
// ──────────────────────────────────────────────────────
function buildPayload(form: ScheduleForm, workerId: string) {
  return {
    worker_id:        workerId,
    title:            form.title,
    description:      form.description || null,
    category:         form.category,
    site_id:          form.site_id || null,
    is_public:        form.is_public,
    all_day:          form.all_day,
    start_date:       form.start_date,
    end_date:         form.end_date,
    start_time:       form.all_day ? null : (form.start_time || null),
    end_time:         form.all_day ? null : (form.end_time   || null),
    recurrence_rule:  form.recurrence_rule || null,
  }
}

async function syncGroupShares(
  supabase: ReturnType<typeof useSupabase>,
  scheduleId: string,
  groupIds: string[],
) {
  // 既存を全削除してから再挿入
  await supabase.from('schedule_group_shares').delete().eq('schedule_id', scheduleId)
  if (groupIds.length) {
    await supabase.from('schedule_group_shares').insert(
      groupIds.map(gid => ({ schedule_id: scheduleId, group_id: gid }))
    )
  }
}
