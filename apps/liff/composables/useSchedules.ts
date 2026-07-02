// ============================================================
//  composables/useSchedules.ts
//  予定管理（CRUD）+ グループ共有対応
// ============================================================
import { useI18n } from 'vue-i18n'
import { gt } from '~/utils/i18n-global'

export type ScheduleCategory = 'work' | 'off' | 'training' | 'meeting' | 'other'

export interface Schedule {
  id:              string
  account_id:      string | null
  worker_id:       string
  title:           string
  description:     string | null
  category:        ScheduleCategory
  site_id:         string | null
  color:           string | null
  is_public:       boolean
  all_day:         boolean
  start_date:      string   // 'YYYY-MM-DD'
  end_date:        string   // 'YYYY-MM-DD'
  start_time:      string | null  // 'HH:MM'
  end_time:        string | null  // 'HH:MM'
  is_night_shift:  boolean
  created_by_name: string | null
  deleted_at:      string | null
  deleted_by_name: string | null
  worker?:         { id: string; name: string }
}

export interface ScheduleForm {
  _worker_id?:     string   // 対象作業員（代理入力時のフォーム内部用。schedules列ではない）
  _original?: {             // 編集前の値（更新時の差分計算用。schedules列ではない）
    title:          string
    description:    string | null
    start_date:     string
    end_date:       string
    start_time:     string | null
    end_time:       string | null
    is_night_shift: boolean
  }
  title:           string
  description:     string
  category:        ScheduleCategory
  site_id:         string
  all_day:         boolean
  start_date:      string
  end_date:        string
  start_time:      string
  end_time:        string
  is_night_shift:  boolean
  is_public?:      boolean   // 他ユーザーへ共有するか（既定OFF=非共有・A方針）
}

const CATEGORY_LABEL_KEYS: Record<ScheduleCategory, string> = {
  work:     'sched.categoryWork',
  off:      'sched.categoryOff',
  training: 'sched.categoryTraining',
  meeting:  'sched.categoryMeeting',
  other:    'sched.categoryOther',
}

// アクセス時に翻訳する（i18n 初期化前にモジュール評価されても値が固定されないように Proxy 経由）
export const CATEGORY_LABELS: Record<ScheduleCategory, string> = new Proxy(
  {} as Record<ScheduleCategory, string>,
  {
    get(_t, prop: string) {
      const key = CATEGORY_LABEL_KEYS[prop as ScheduleCategory]
      return key ? gt(key) : undefined
    },
  },
)

export const CATEGORY_COLORS: Record<ScheduleCategory, string> = {
  work:     '#06C755',
  off:      '#94a3b8',
  training: '#f59e0b',
  meeting:  '#3b82f6',
  other:    '#a855f7',
}

export const useSchedules = () => {
  const supabase    = useSupabase()
  const { t }       = useI18n()
  const { profile } = useLiff()
  const config      = useRuntimeConfig()

  const schedules = ref<Schedule[]>([])
  const loading   = ref(false)
  const error     = ref<string | null>(null)

  const _myWorkerIdCache = ref<string | null>(null)
  let   _accountIdCache: string | null = null

  async function resolveAccountId(): Promise<string | null> {
    if (_accountIdCache) return _accountIdCache
    // account は身元優先（認証時は env で上書きしない＝テナント分離）
    const { getAccountId } = useAccount()
    _accountIdCache = await getAccountId()
    return _accountIdCache
  }

  const myWorkerId = computed(() => _myWorkerIdCache.value)

  async function resolveMyWorkerId(): Promise<string | null> {
    if (_myWorkerIdCache.value) return _myWorkerIdCache.value
    // email/pw（Supabase認証）は JWT の worker_id を直接使う（line_user_id を持たないため）
    const { authMode, workerId } = useLiff()
    if (authMode.value === 'password' && workerId.value) {
      _myWorkerIdCache.value = workerId.value
      return _myWorkerIdCache.value
    }
    const lineUserId = profile.value?.userId
    if (!lineUserId) return null
    try {
      const accountId = config.public.accountSlug
      const { data: accountData } = await supabase
        .from('accounts')
        .select('id')
        .eq('slug', accountId)
        .maybeSingle()
      if (!accountData) return null

      const { data } = await supabase
        .from('users')
        .select('worker_id')
        .eq('line_user_id', lineUserId)
        .eq('account_id', accountData.id)
        .maybeSingle()
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
  async function fetchSchedules(from: string, to: string, _unused?: string[], workerIdOverride?: string | null) {
    loading.value = true
    error.value   = null
    try {
      await resolveMyWorkerId()
      const wid = workerIdOverride ?? _myWorkerIdCache.value
      if (!wid) return

      // アカウント全体の予定を取得（削除済みを除く）
      const accountId = await resolveAccountId()

      // 可視性（A方針）：非公開(is_public=false)は「本人」または「管理者(admin/office)」のみ閲覧可。
      //  それ以外の閲覧者には公開(is_public=true)＋自分の予定だけを返す。既存予定は is_public=true 既定のため従来どおり全員に見える。
      const viewerWid = _myWorkerIdCache.value
      let canSeeAll = false
      if (viewerWid) {
        const { data: vw } = await supabase.from('workers').select('permission_role').eq('id', viewerWid).maybeSingle()
        const role = (vw as { permission_role?: string } | null)?.permission_role
        canSeeAll = role === 'admin' || role === 'office'
      }

      let query = supabase
        .from('schedules')
        .select('*, worker:workers(id, name)')
        .eq('account_id', accountId)
        .lte('start_date', to)
        .gte('end_date', from)
      if (!canSeeAll && viewerWid) {
        query = query.or(`is_public.eq.true,worker_id.eq.${viewerWid}`)
      }
      const { data, error: err } = await query.order('start_date')
      if (err) throw err

      schedules.value = (data ?? []) as Schedule[]
    } catch (e) {
      error.value = e instanceof Error ? e.message : t('sched.fetchFailed')
    } finally {
      loading.value = false
    }
  }

  // ──────────────────────────────────────────────────────
  // 予定作成
  // ──────────────────────────────────────────────────────
  async function createSchedule(form: ScheduleForm, workerId?: string, creatorName?: string) {
    const wid       = workerId ?? (await resolveMyWorkerId())
    if (!wid) throw new Error(t('sched.workerInfoUnavailable'))
    const accountId = await resolveAccountId()

    const { data, error: err } = await supabase
      .from('schedules')
      .insert({ ...buildPayload(form, wid), account_id: accountId, created_by_name: creatorName ?? null, is_public: form.is_public ?? false })
      .select('*, worker:workers(id, name)')
      .single()
    if (err) throw err

    const schedule = data as Schedule
    schedules.value.push(schedule)
    // 対象作業員へアプリ内通知（自分で自分の予定を作った時は不要）。best-effort・失敗しても作成は成立 #予定通知
    try {
      const me = _myWorkerIdCache.value
      if (wid && wid !== me) {
        await supabase.from('schedule_notifications').insert({
          account_id: accountId, worker_id: wid, schedule_id: schedule.id,
          title: '新しい予定が追加されました',
          body: `${schedule.title}（${schedule.start_date}${schedule.end_date !== schedule.start_date ? '〜' + schedule.end_date : ''}）`,
        })
      }
    } catch { /* 通知失敗は無視 */ }
    return schedule
  }

  // ──────────────────────────────────────────────────────
  // 予定更新
  // ──────────────────────────────────────────────────────
  async function updateSchedule(id: string, form: Partial<ScheduleForm>) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ((form as any).worker_id !== undefined) updates.worker_id   = (form as any).worker_id  // 担当変更
    if (form.title           !== undefined) updates.title          = form.title
    if (form.description     !== undefined) updates.description    = form.description || null
    if (form.category        !== undefined) updates.category       = form.category
    if (form.site_id         !== undefined) updates.site_id        = form.site_id || null
    if (form.all_day         !== undefined) updates.all_day        = form.all_day
    if (form.is_night_shift  !== undefined) updates.is_night_shift = form.is_night_shift
    if (form.is_public       !== undefined) updates.is_public      = form.is_public
    if (form.start_date      !== undefined) updates.start_date     = form.start_date
    if (form.end_date        !== undefined) updates.end_date       = form.end_date
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

  // ──────────────────────────────────────────────────────
  // 予定削除
  // ──────────────────────────────────────────────────────
  async function deleteSchedule(id: string, deletedByName?: string) {
    const { error: err } = await supabase.from('schedules').update({
      deleted_at:      new Date().toISOString(),
      deleted_by_name: deletedByName ?? null,
    }).eq('id', id)
    if (err) throw err
    schedules.value = schedules.value.filter(s => s.id !== id)
  }

  // ──────────────────────────────────────────────────────
  // 予定のグループ共有先を取得
  // ──────────────────────────────────────────────────────
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
  }
}

// ──────────────────────────────────────────────────────
// ヘルパー
// ──────────────────────────────────────────────────────
function buildPayload(form: ScheduleForm, workerId: string) {
  return {
    worker_id:       workerId,
    title:           form.title,
    description:     form.description || null,
    category:        form.category,
    site_id:         form.site_id || null,
    all_day:         form.all_day,
    start_date:      form.start_date,
    end_date:        form.end_date,
    start_time:      form.all_day ? null : (form.start_time || null),
    end_time:        form.all_day ? null : (form.end_time   || null),
    is_night_shift:  form.is_night_shift,
  }
}
