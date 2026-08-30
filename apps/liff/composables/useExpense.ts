// ============================================================
//  composables/useExpense.ts
//  経費申請データの CRUD 操作
// ============================================================
import type { User, ExpenseItem, ExpenseItemInput, ExpenseRow } from '~/types'
import { useI18n } from 'vue-i18n'
import { gt } from '~/utils/i18n-global'
import { flattenReportExpenses, flattenGasolineItems, flattenPersonalExpenses, ratesFromSettings, mergeOtherExpenses, splitOtherExpenses } from './expense-flatten.gen'
// ★保存形への整形は EF と共有する（正典: shared/report-storage.ts）。
//  ここに写経を戻さないこと——LIFFとEFで整形規則がズレると、保存された形と読む側の期待が食い違う。
import { sanitizeSitesForStorage, normalizeGasolineItems } from './report-storage.gen'
import { resolveActiveSiteId } from '~/utils/site-similarity.gen'

// ---------- 期間キーユーティリティ ----------

/** 日付文字列(YYYY-MM-DD)から期間キーを計算 */
export function getPeriodKey(date: string): string {
  const day = parseInt(date.split('-')[2], 10)
  const yearMonth = date.substring(0, 7)
  return `${yearMonth}-${day <= 15 ? 'first' : 'second'}`
}

/** timestamptz(UTC) → JST基準の 'YYYY-MM-DD'（ユーザー登録日を暦日に変換） */
export function jstDateOf(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 現在の期間キーを返す */
export function getCurrentPeriodKey(): string {
  const today = new Date()
  const day   = today.getDate()
  const ym    = today.toISOString().substring(0, 7)
  return `${ym}-${day <= 15 ? 'first' : 'second'}`
}

/** 期間キーを表示用ラベルに変換 (例: '2026-05-first' → '2026年5月 前半') */
export function periodLabel(key: string): string {
  const [year, month, half] = key.split('-')
  const halfLabel = half === 'first' ? gt('expense.periodFirstHalf') : gt('expense.periodSecondHalf')
  return gt('expense.periodLabel', { year, month: parseInt(month, 10), half: halfLabel })
}

// ---------- 月次精算（申請/差し戻し）ステータス ----------
// 正典: docs/spec/expense.md §2,§3

export type SettlementStatus = '未申請' | '申請中' | '差し戻し' | '支払い済み' | '期限超過'

/** 期(period_key)の締切(JST)を返す。first=当月18日10:00 / second=翌月3日10:00 */
export function deadlineForPeriod(periodKey: string): Date {
  const [y, m, half] = periodKey.split('-')
  const year = Number(y), month = Number(m) // month: 1-12
  if (half === 'first') {
    return new Date(`${y}-${String(month).padStart(2, '0')}-18T10:00:00+09:00`)
  }
  // second: 翌月3日（12月は翌年1月）
  const nm = month === 12 ? 1 : month + 1
  const ny = month === 12 ? year + 1 : year
  return new Date(`${ny}-${String(nm).padStart(2, '0')}-03T10:00:00+09:00`)
}

/**
 * 締切アラートの表示期間内か（ホームバナー用）。
 * first（前半）: 15日 〜 18日10:00 / second（後半）: 翌月1日 〜 翌月3日10:00（JST）
 */
export function isInDeadlineAlertWindow(periodKey: string, now: Date = new Date()): boolean {
  const [y, m, half] = periodKey.split('-')
  const year = Number(y), month = Number(m)
  let start: Date
  if (half === 'first') {
    start = new Date(`${y}-${String(month).padStart(2, '0')}-15T00:00:00+09:00`)
  } else {
    const nm = month === 12 ? 1 : month + 1
    const ny = month === 12 ? year + 1 : year
    start = new Date(`${ny}-${String(nm).padStart(2, '0')}-01T00:00:00+09:00`)
  }
  const t = now.getTime()
  return t >= start.getTime() && t <= deadlineForPeriod(periodKey).getTime()
}

/** 締切を表示用に整形（例: '6月3日(火) 10:00'） */
export function deadlineLabel(periodKey: string): string {
  const d = deadlineForPeriod(periodKey)
  const wdKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  const wd = gt(`expense.weekday.${wdKeys[d.getDay()]}`)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return gt('expense.deadlineLabel', { month: d.getMonth() + 1, day: d.getDate(), weekday: wd, time })
}

/** 実効ステータス。行が無ければ締切判定で 未申請/期限超過 を導出 */
export function effectiveStatus(
  row: { status?: string | null } | null | undefined,
  periodKey: string,
  now: Date = new Date(),
): SettlementStatus {
  if (row?.status) return row.status as SettlementStatus
  return now.getTime() <= deadlineForPeriod(periodKey).getTime() ? '未申請' : '期限超過'
}

/**
 * 直近3か月分の期間キーを新しい順で返す（各月 後半→前半）。
 * 例: 2026-06-second, 2026-06-first, 2026-05-second, 2026-05-first, ...
 */
export function recentPeriodKeys(): string[] {
  const keys: string[] = []
  const today = new Date()
  for (let i = 0; i < 3; i++) {
    const d  = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    keys.push(`${ym}-second`, `${ym}-first`)   // 後半→前半（新しい順）
  }
  return keys
}

// ---------- ユーザーキャッシュ（localStorage） ----------
// LIFF init 後に毎回 Supabase を叩くのを避けるため1時間キャッシュする

const USER_CACHE_TTL = 60 * 60 * 1000 // 1時間

function getCacheKey(lineUserId: string): string {
  // account slug をキーに含めてアカウント間のキャッシュ混在を防ぐ
  const slug = typeof useRuntimeConfig !== 'undefined'
    ? ((useRuntimeConfig().public as any).accountSlug as string) || 'sample-construction'
    : 'sample-construction'
  return `app_eu_${slug}_${lineUserId}`
}

function loadUserCache(lineUserId: string): User | null {
  if (import.meta.server) return null
  try {
    const key = getCacheKey(lineUserId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: User; ts: number }
    if (Date.now() - ts > USER_CACHE_TTL) { localStorage.removeItem(key); return null }
    return data
  } catch { return null }
}

function saveUserCache(user: User) {
  if (import.meta.server) return
  try {
    localStorage.setItem(getCacheKey(user.line_user_id), JSON.stringify({ data: user, ts: Date.now() }))
  } catch { /* quota超過は無視 */ }
}

function clearUserCache(lineUserId: string) {
  if (import.meta.server) return
  try { localStorage.removeItem(getCacheKey(lineUserId)) } catch {}
}

// ---------- composable ----------

export const useExpense = () => {
  // コンポーザブル初期化時（同期フェーズ）に一度だけ取得してクロージャで共有
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { t } = useI18n()

  /**
   * LINE userId でユーザーを取得（未登録なら null）
   * localStorage キャッシュあり → Supabase は初回・期限切れ時のみ問い合わせ
   */
  async function getUser(lineUserId: string): Promise<User | null> {
    // email/pw（Supabase認証）セッションは line_user_id を持たない → 単一ソース useCurrentUser で解決。
    // （users 行が無ければ作成して id 付きで返す＝日報/履歴が正しく保存される。line_user_id 検索はしない）
    const { authMode } = useLiff()
    // ★email/pw は worker_id が JWT に無くても resolve() が auth_user_id から解決する。
    //  ここで workerId を条件にすると、付け忘れ時に LINE キャッシュ経路へ落ちて /register へ飛ぶ（本バグ）。
    if (authMode.value === 'password') {
      return await useCurrentUser().resolve()
    }

    const cached = loadUserCache(lineUserId)

    const accountId = await getAccountId()

    // キャッシュがある場合：Supabaseで存在確認してから返す（削除済み・account_id不一致を検出）
    if (cached) {
      const { data: check } = await supabase
        .from('users')
        .select('id, updated_at')
        .eq('line_user_id', lineUserId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!check) {
        // DBに存在しない（削除済みorアカウント不一致）→ キャッシュ破棄して未登録扱い
        clearUserCache(lineUserId)
        return null
      }
      if (check.updated_at === cached.updated_at) return cached
      // updated_at が変わっていたらキャッシュ破棄して DB から再取得
      clearUserCache(lineUserId)
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('line_user_id', lineUserId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) { console.error('[useExpense] getUser:', error); return null }
    if (data)  saveUserCache(data)
    return data
  }

  /**
   * ユーザー登録
   * - workerId が渡された場合 → 既存作業員に紐づけ
   * - null の場合 → workerName/workerRole で workers に新規作成してから紐づけ
   */
  async function registerUser(
    lineUserId: string,
    workerIdOrNull: string | null,
    workerName: string,
    workerRole: 'factory' | 'site',
  ): Promise<User> {

    let workerId = workerIdOrNull

    const accountId = await getAccountId()

    // 新規作業員の場合は workers テーブルに作成
    if (!workerId) {
      const { data: newWorker, error: workerError } = await supabase
        .from('workers')
        .upsert(
          { name: workerName, role: workerRole, unit_price: 0, active: true, account_id: accountId },
          { onConflict: 'name,account_id' }
        )
        .select('id')
        .single()
      if (workerError) throw workerError
      workerId = newWorker.id
      // マスタキャッシュをクリアして次回取得時に新作業員が反映されるようにする
      if (import.meta.client) localStorage.removeItem('app_master_cache')
    }

    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          line_user_id: lineUserId,
          worker_id:    workerId,
          real_name:    workerName,   // 後方互換のため残す
          worker_role:  workerRole,   // 後方互換のため残す
          account_id:   accountId,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'line_user_id' }
      )
      .select()
      .single()

    if (error) throw error
    saveUserCache(data)
    return data
  }

  /** 経費明細を追加 */
  async function addItem(lineUserId: string, item: ExpenseItemInput): Promise<ExpenseItem> {
    const user = await getUser(lineUserId)
    if (!user) throw new Error(t('expense.userNotRegistered'))

    const { data, error } = await supabase
      .from('expense_items')
      .insert({ ...item, user_id: user.id })
      .select()
      .single()

    if (error) throw error
    return data
  }

  /** 期間を指定して経費明細を取得 */
  async function getItems(lineUserId: string, periodKey: string): Promise<ExpenseItem[]> {
    const user = await getUser(lineUserId)
    if (!user) return []

    const { data, error } = await supabase
      .from('expense_items')
      .select('*')
      .eq('user_id', user.id)
      .eq('period_key', periodKey)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) { console.error('[useExpense] getItems:', error); return [] }
    return data ?? []
  }

  /** 経費明細を削除 */
  async function deleteItem(id: string): Promise<void> {
    const { error } = await supabase
      .from('expense_items')
      .delete()
      .eq('id', id)

    if (error) throw error
  }

  /**
   * 代理入力対象（LINE未登録）の usersレコードを取得または作成して user_id を返す
   */
  async function findOrCreateProxyUser(
    workerId: string,
    workerName: string,
    workerRole: 'factory' | 'site'
  ): Promise<string> {
    const accountId = await getAccountId()
    if (!accountId) throw new Error(t('expense.accountIdFailed'))

    // worker_id で既存ユーザーを検索
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('account_id', accountId)
      .eq('worker_id', workerId)
      .maybeSingle()

    if (existing) return existing.id

    // 存在しなければ作成（line_user_id は null）
    const { data: created, error } = await supabase
      .from('users')
      .insert({
        account_id:  accountId,
        worker_id:   workerId,
        real_name:   workerName,
        worker_role: workerRole,
        line_user_id: null,
      })
      .select('id')
      .single()

    if (error) throw new Error(t('expense.proxyUserCreateFailed', { message: error.message }))
    return created.id
  }

  /**
   * 日報データをSupabaseに保存（user_id直接指定版）
   */
  // 保存前に File[] を除去（JSONB に File をそのまま入れると [{}] のゴミになるため）。
  //  *Files トップレベルキーと、明細ごとに files を持つ parkings/highways の files を落とす。*Urls は残す。
  /**
   * 保存する形（daily_reports の列そのまま）を組み立てる。DBには書かない。
   * ★日報の編集は承認制になり、編集時は保存せず保留に入れる。その保留の中身は
   *   「承認したらそのまま daily_reports へ入る形」でなければならない。
   *   保存経路(saveReportById)を通らないからといって素のフォーム値を保留に入れると、
   *   保存時の正規化（現場のsite_id解決・その他/接待交際費の振り分け・ガソリン明細の整形）が
   *   丸ごと抜け落ちる。実際それで「承認したら集計の接待交際費列が空になる」バグを踏んだ。
   */
  async function buildReportPayload(
    report: { isWorking: boolean; sites: unknown[]; note?: string; leaveType?: string | null; leaveDays?: number | null; leaveHours?: number | null; isBusinessTrip?: boolean; gasolineItems?: any[]; date?: string | null }
  ): Promise<Record<string, unknown>> {
    const accountId = await getAccountId()
    await registerNewSites(accountId, report.sites as any[])
    // ★EF経由（sites は公開キーから読めないようにしたため）。
    //  同名重複時は最古を正とするので created_at 昇順に並べ直す。
    const activeSites = (await useSitesApi().listSafe())
      .slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(s => ({ id: s.id, name: s.name }))
    return {
      is_working:       report.isWorking,
      leave_type:       report.leaveType ?? null,
      // 有給の消化量（日）。1=全日 / 0.5=半日 / 時間単位は 時間÷所定時間。
      // ★件数で数えると半日も1日消化になるので、量そのものを保存する（2026-08-30）
      leave_days:       report.leaveType === 'paid_leave' ? (report.leaveDays ?? 1) : null,
      leave_hours:      report.leaveType === 'paid_leave' ? (report.leaveHours ?? null) : null,
      is_business_trip: report.isBusinessTrip ?? false,
      sites:            sanitizeSitesForStorage(report.sites as any[], activeSites, report.date ?? null),
      note:             report.note ?? null,
      gasoline_items:   normalizeGasolineItems(report.gasolineItems),
    }
  }

  // 日報の現場名を現場マスタ(sites)へ確実に登録する。
  //  「その他/新規現場」は __other__ なので customSiteName を採用。trim・空・__other__ は除外。
  //  既存現場は onConflict + ignoreDuplicates で no-op（active/name_kana/sort_order を壊さない）。
  //  日報保存と同じ経路で必ず await されるため、ブラウザ側 saveSite の取りこぼしを補う保険。
  //  失敗しても日報保存は妨げない（best-effort・ログのみ）。
  async function registerNewSites(accountId: string | null, sites: any[]): Promise<void> {
    if (!accountId || !Array.isArray(sites) || sites.length === 0) return
    const names = new Set<string>()
    for (const s of sites) {
      if (s?.siteName === '__unset__') continue   // 現場未設定はマスタ登録しない（あとで紐付け）
      const raw  = s?.siteName === '__other__' ? s?.customSiteName : s?.siteName
      const name = (raw ?? '').trim()
      if (name && name !== '__other__') names.add(name)
    }
    if (names.size === 0) return
    // ★ 現場の新規作成は権限者(admin/office/site_manager)のみ。
    //   権限が無い場合はマスタ登録自体をスキップする。既存現場は ignoreDuplicates で
    //   もともと no-op なので取りこぼしは無く、日報保存も妨げない（新規名は site_id 未解決の
    //   まま保存され、admin「現場未設定の紐付け」で後から正せる）。
    const perm = useWorkerPermission()
    await perm.resolveRole()
    if (!perm.canCreateSite.value) {
      console.warn('[saveReportById] 現場作成権限が無いため現場マスタ登録をスキップ')
      return
    }
    // ★EF経由。権限は EF 側でも確認する（画面で隠すだけでは REST直叩きで通る）
    const r = await useSitesApi().ensure([...names])
    if (!r.ok) console.error('[saveReportById] 現場マスタ登録に失敗:', r.error)
  }

  /**
   * 日報の保存EFを呼ぶ。身元は EF 側で検証されるので、ここでは名乗らない
   * （dev_line_user_id はローカル検証用の経路。本番の SUPABASE_URL では EF 側が受け付けない）。
   */
  async function callSaveReportEf(
    userId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string; leaveType?: string | null; leaveDays?: number | null; leaveHours?: number | null; isBusinessTrip?: boolean; gasolineItems?: any[] },
  ): Promise<{ ok: boolean; error?: string }> {
    const config = useRuntimeConfig()
    const liff = useLiff()
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    try {
      const res = await $fetch<any>(`${config.public.edgeFunctionUrl}/save-daily-report`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
        },
        body: { userId, report, line_id_token: lineIdToken, dev_line_user_id: devLineUserId },
      })
      return res?.ok ? { ok: true } : { ok: false, error: res?.error ?? 'save_failed' }
    } catch (e: any) {
      // ★保存の失敗を握りつぶさない。送信できていないのに完了に見えるのが一番まずい
      return { ok: false, error: e?.data?.error ?? e?.message ?? 'save_failed' }
    }
  }

  async function saveReportById(
    userId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string; leaveType?: string | null; leaveDays?: number | null; leaveHours?: number | null; isBusinessTrip?: boolean; gasolineItems?: any[] }
  ): Promise<void> {
    // ★EF経由。daily_reports への直書きは他テナントの行まで書き換え・削除できるため塞いだ（2026-08-16）。
    //  身元の検証・クロステナントの拒否・現場マスタ登録・site_id 解決・整形は全部 EF 側で行う。
    //  以前はクロステナントのガードをここ（クライアント）でやっていたが、迂回できるので
    //  ガードになっていなかった（2026-06〜07 にねじれた行が本番で2件できている）。
    const res = await callSaveReportEf(userId, report)
    if (!res.ok) {
      console.error('[saveReportById] 保存に失敗:', res.error)
      throw new Error(res.error === 'WRITE_FORBIDDEN' ? t('expense.crossTenantDenied') : (res.error ?? 'save_failed'))
    }
  }

  // 内容(note)を label キーに書き戻せるカテゴリ（それ以外は payee/登録番号のみ編集）
  const LABEL_SRC_KEYS = new Set(['trains', 'hotels', 'others', 'entertainments'])

  /**
   * 経費申請書のインライン編集：1明細の 支払い先/内容/登録番号 を daily_reports.sites JSON（本日ガソリンは gasoline_items）へ書き戻す。
   * 申請前(未申請/差し戻し)のガードは呼び出し側(download.vue canApply)で担保。ExpenseRow の出所(srcKey/srcSiteIndex/srcIndex)で対象を辿る。
   * @returns 保存できたら true（出所不明・対象不在なら false）
   */
  async function patchExpenseItem(
    userId: string,
    row: { date: string; srcKey?: string; srcSiteIndex?: number; srcIndex?: number },
    patch: { payee?: string; registrationNumber?: string; note?: string }
  ): Promise<boolean> {
    if (!row?.srcKey || row.srcIndex == null) return false
    const rep = await getReportByUserId(userId, row.date)
    if (!rep) return false

    // 書き戻し対象の明細オブジェクトを取得
    let target: any = null
    if (row.srcKey === 'gasolineItems') {
      target = (rep.gasoline_items ?? [])[row.srcIndex]
    } else if (row.srcSiteIndex != null) {
      const site = (rep.sites ?? [])[row.srcSiteIndex]
      target = site?.expenses?.[row.srcKey]?.[row.srcIndex]
    }
    if (!target) return false

    // フィールド書き戻し（未指定は触らない）。内容(note)は label 系カテゴリのみ label へ。
    if (patch.payee !== undefined) target.payee = patch.payee.trim() || null
    if (patch.registrationNumber !== undefined) target.registrationNumber = patch.registrationNumber.trim() || null
    if (patch.note !== undefined && LABEL_SRC_KEYS.has(row.srcKey)) target.label = patch.note.trim() || null

    await saveReportById(userId, {
      date: rep.date,
      isWorking: rep.is_working,
      sites: rep.sites ?? [],
      note: rep.note ?? undefined,
      leaveType: rep.leave_type ?? null,
      leaveDays: (rep as any).leave_days ?? null,
      leaveHours: (rep as any).leave_hours ?? null,
      isBusinessTrip: rep.is_business_trip ?? false,
      gasolineItems: rep.gasoline_items ?? [],
    })
    return true
  }

  /**
   * 日報データをSupabaseに保存（管理画面・履歴用）
   * 同じ user_id + date がある場合は上書き（upsert）
   */
  async function saveReport(
    lineUserId: string,
    report: { date: string; isWorking: boolean; sites: unknown[]; note?: string; leaveType?: string | null; leaveDays?: number | null; leaveHours?: number | null; isBusinessTrip?: boolean; gasolineItems?: any[] }
  ): Promise<void> {
    console.log('[saveReport] 開始 lineUserId=', lineUserId)

    const user = await getUser(lineUserId)
    console.log('[saveReport] getUser結果=', user ? `id:${user.id} name:${user.real_name}` : 'null')
    if (!user) throw new Error(t('expense.userNotRegistered'))

    await saveReportById(user.id, report)
    console.log('[saveReport] 保存成功 date=', report.date)
  }

  /**
   * 期間内の日報データから経費行を集計（月次PDF用）
   * daily_reports.sites (JSONB) を展開してカテゴリ別に平坦化する
   */
  async function getExpenseRowsFromReports(lineUserId: string, periodKey: string): Promise<ExpenseRow[]> {
    const user = await getUser(lineUserId)
    if (!user) return []
    return getExpenseRowsFromReportsById(user.id, periodKey)
  }

  async function getExpenseRowsFromReportsById(userId: string, periodKey: string): Promise<ExpenseRow[]> {
    const [year, month, half] = periodKey.split('-')
    const dateFrom = half === 'first' ? `${year}-${month}-01` : `${year}-${month}-16`
    const lastDay  = new Date(parseInt(year), parseInt(month), 0).getDate()
    const dateTo   = half === 'first' ? `${year}-${month}-15` : `${year}-${month}-${String(lastDay).padStart(2, '0')}`

    // ★EF経由。daily_reports の直読みは他テナント分まで読めるため塞いだ（2026-08-15）
    let data: any[] = []
    try {
      data = await useDailyReportsApi().forExpense(dateFrom, dateTo, userId)
      data.sort((a, b) => String(a.date).localeCompare(String(b.date)))
    } catch (e) { console.error('[useExpense] getExpenseRowsFromReports:', e); return [] }

    // 燃料単価をsettingsから解決（単一ソース ratesFromSettings）
    const { getAccountId: getAid } = useAccount()
    const aid = await getAid()
    const { data: settingsData } = await supabase.from('settings').select('key, value').eq('account_id', aid)
    const rates = ratesFromSettings(settingsData as any)

    // 平坦化は単一ソース flattenReportExpenses（admin と共有・shared/expense-flatten.ts）
    const rows: ExpenseRow[] = []
    for (const rep of (data ?? [])) {
      // 経費PDF＝作業員への精算書。車両の距離按分「ガソリン代/軽油代」(distanceKm×単価)は
      //  実費でなく現場別集計(内部原価)への配賦なので**精算書には載せない**。実費は下の「本日のガソリン代」で載る。
      rows.push(...flattenReportExpenses(rep.date, rep.sites as any[], rates)
        .filter(r => r.category !== 'ガソリン代' && r.category !== '軽油代'))
      // 日報レベルの「本日のガソリン代」（複数給油・実費）も明細に含める（admin 経費精算と整合）
      //  ★共有関数を使う。srcKey='gasolineItems'（report直下・srcSiteIndex無し）で
      //   書き戻し先を区別する（srcIndexは元配列のindex）のも共有側で付ける。
      rows.push(...flattenGasolineItems(rep.date, (rep as any).gasoline_items) as ExpenseRow[])
    }

    // 現場に紐付かない個人経費も精算書に載せる（#f4cc3db1 / #32e93d75）。
    //  ★載せないと個人立替(tategae)が精算されない。日報を出さない役員等は
    //   そもそも daily_reports が無いので、ここで拾わないと1円も出ない。
    // ★必ず EF 経由で読む（直読み禁止）。personal_expenses は anon revoke ＋ RLS authenticated で、
    //  LIFF を LINE アプリ内で開くと anon になるため、直読みだと黙って0件＝個人立替が
    //  申請書から消える（2026-08-01 ship前に本番で LINE 利用者の残存を確認して判明）。
    rows.push(...flattenPersonalExpenses(await usePersonalExpense().listByRange(dateFrom, dateTo, userId) as any))

    // ★日付順に並べ替える。ソートしないと「日報由来を全部 → 個人経費を全部」の順になり、
    //  明細の途中で日付が 8/8 → 8/3 と戻る。本番ユーザーが「立て替えた分が明細に無い」と
    //  報告した原因がこれで、行は存在するのに離れた位置にあって見つけられなかった（2026-08-08）。
    //  同日内は元の順（日報由来 → 個人経費）を保つ＝安定ソート（Array#sort は ES2019 で安定）。
    rows.sort((a, b) => a.date.localeCompare(b.date))
    return rows
  }

  /**
   * サービス開始日から今日までで、最初の未送信日を返す。
   * 全日送信済みなら null を返す。
   * service_start_date が未設定なら null を返す。
   */
  async function getNextUnsubmittedDate(lineUserId: string, excludeDates: string[] = []): Promise<string | null> {
    const accountId = await getAccountId()

    // service_start_date を settings から取得（複数行対応で limit(1) を使用）
    const { data: settingRows } = await supabase
      .from('settings')
      .select('value')
      .eq('account_id', accountId)
      .eq('key', 'service_start_date')
      .limit(1)

    const startDate = settingRows?.[0]?.value
    console.log('[getNextUnsubmittedDate] accountId=', accountId, 'startDate=', startDate)
    if (!startDate) return 'NOT_CONFIGURED'  // startDate未設定は通常動作に戻す

    const user = await getUser(lineUserId)
    console.log('[getNextUnsubmittedDate] user=', user?.id)
    if (!user) return null

    // 起点 = max(service_start_date, 作業員登録日, 日報提出開始日)。これより前の日付は未送信扱いしない。
    // 作業員マスタ登録日(workers.created_at)で統一。worker_id 経由で取得し、無ければ users.created_at にフォールバック。
    // report_start_date（日報提出開始日・任意）が設定されていれば、それ以降のみ未送信対象にする。
    let regSrc: string | null | undefined = (user as any).created_at
    let reportStartDate: string | null = null
    if ((user as any).worker_id) {
      const { data: w } = await supabase.from('workers').select('created_at, report_start_date').eq('id', (user as any).worker_id).maybeSingle()
      if ((w as any)?.created_at) regSrc = (w as any).created_at
      reportStartDate = (w as any)?.report_start_date ?? null
    }
    const regDate = jstDateOf(regSrc)
    let effStart = startDate
    if (regDate && regDate > effStart) effStart = regDate
    if (reportStartDate && reportStartDate > effStart) effStart = reportStartDate

    // 今日の日付をローカルタイムゾーンで取得（toISOString はUTCになるため使わない）
    const now   = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    // 起点〜今日の送信済み日付を一括取得
    // ★EF経由（直読みは他テナント分まで読めるため塞いだ・2026-08-15）
    //  ここは「未提出日の算出」なので、取得に失敗した時に空配列へ倒すと
    //  全部未提出に見えてしまう。失敗はそのまま投げて呼び出し側に判断させる。
    let reports: { date: string }[] = []
    let reportsError: unknown = null
    try {
      reports = (await useDailyReportsApi().submittedDates(effStart, today, user.id)).map(d => ({ date: d }))
    } catch (e) { reportsError = e; throw e }

    console.log('[getNextUnsubmittedDate] today=', today, 'effStart=', effStart, 'submittedCount=', reports?.length, 'error=', reportsError)

    // ★承認待ちの日も「出し済み」として飛ばす。除外しないと承認されるまで同じ日付が
    //   出続けて次に進めず、まとめて（例: 忘れていた5日分）提出できない。
    // ★ここで自分から取りに行く。以前は呼び出し側が excludeDates に入れる形だったが、
    //  4箇所ある呼び出しのうち1箇所しか渡しておらず、送信直後・初回表示・代理切替では
    //  承認待ちが素通りしていた。結果、提出しても同じ日が出続けた
    //  （2026-08-18 大塚さん「なんか、15日が一生でてくる」）。
    //  呼び出し側に頼ると必ずまた漏れるので、判定する側で完結させる。
    const pending = await useReportEditApi().pendingDates().catch(() => [] as string[])
    const submittedDates = new Set([
      ...(reports ?? []).map((r: any) => r.date as string),
      ...excludeDates,
      ...pending,
    ])

    // 起点から順に走査（純粋な文字列加算でタイムゾーン問題を回避）
    let cursor = effStart
    while (cursor <= today) {
      if (!submittedDates.has(cursor)) {
        console.log('[getNextUnsubmittedDate] next=', cursor)
        return cursor
      }
      // 日付を1日進める
      const d = new Date(cursor + 'T12:00:00') // 正午指定でタイムゾーンのズレを防ぐ
      d.setDate(d.getDate() + 1)
      cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    console.log('[getNextUnsubmittedDate] all submitted')
    return null  // null = 全送信済み
  }

  /**
   * DBユーザーIDで直接未送信日を検索（代理入力用）
   * getNextUnsubmittedDate の userID版
   */
  async function getNextUnsubmittedDateById(userId: string, excludeDates: string[] = []): Promise<string | null> {
    const accountId = await getAccountId()

    const { data: settingRows } = await supabase
      .from('settings')
      .select('value')
      .eq('account_id', accountId)
      .eq('key', 'service_start_date')
      .limit(1)

    const startDate = settingRows?.[0]?.value
    if (!startDate) return 'NOT_CONFIGURED'

    // 起点 = max(service_start_date, 作業員登録日, 日報提出開始日)。これより前の日付は未送信扱いしない。
    // 作業員マスタ登録日(workers.created_at)で統一。無ければ users.created_at にフォールバック。
    // report_start_date（日報提出開始日・任意）が設定されていれば、それ以降のみ未送信対象にする。
    const { data: urow } = await supabase
      .from('users')
      .select('created_at, worker_id')
      .eq('id', userId)
      .maybeSingle()
    let regSrc: string | null | undefined = (urow as any)?.created_at
    let reportStartDate: string | null = null
    if ((urow as any)?.worker_id) {
      const { data: w } = await supabase.from('workers').select('created_at, report_start_date').eq('id', (urow as any).worker_id).maybeSingle()
      if ((w as any)?.created_at) regSrc = (w as any).created_at
      reportStartDate = (w as any)?.report_start_date ?? null
    }
    const regDate = jstDateOf(regSrc)
    let effStart = startDate
    if (regDate && regDate > effStart) effStart = regDate
    if (reportStartDate && reportStartDate > effStart) effStart = reportStartDate

    const now   = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    // ★EF経由。未提出日の算出なので失敗を空に倒さない（全部未提出に見えてしまう）
    const reports = (await useDailyReportsApi().submittedDates(effStart, today, userId)).map(d => ({ date: d }))

    // ★承認待ちの日も「出し済み」として飛ばす。除外しないと承認されるまで同じ日付が
    //   出続けて次に進めず、まとめて（例: 忘れていた5日分）提出できない。
    const submittedDates = new Set([...(reports ?? []).map((r: any) => r.date as string), ...excludeDates])

    let cursor = effStart
    while (cursor <= today) {
      if (!submittedDates.has(cursor)) return cursor
      const d = new Date(cursor + 'T12:00:00')
      d.setDate(d.getDate() + 1)
      cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    return null  // null = 全送信済み
  }

  /** 日報一覧を取得（新しい順） */
  async function getReports(lineUserId: string, limit = 60): Promise<any[]> {
    const user = await getUser(lineUserId)
    if (!user) return []
    return getReportsById(user.id, limit)
  }

  /** 日報一覧をDBユーザーIDで取得（代理入力用） */
  async function getReportsById(userId: string, limit = 60): Promise<any[]> {
    // ★EF経由。一覧は取れなくても操作は続けられるので失敗は空配列
    const data = await useDailyReportsApi().list(limit, userId)
    return data ?? []
  }

  /** 特定日の日報を1件取得。★EF経由（直読みは他テナント分まで読めるため塞いだ・2026-08-15） */
  async function getReport(lineUserId: string, date: string): Promise<any | null> {
    const user = await getUser(lineUserId)
    if (!user) return null
    return await useDailyReportsApi().one(date, user.id)
  }

  /** 特定日の日報をDBユーザーIDで取得（代理入力用）。代理の可否は EF 側で確認する */
  async function getReportByUserId(userId: string, date: string): Promise<any | null> {
    return await useDailyReportsApi().one(date, userId)
  }

  // ---------- 月次精算（申請/差し戻し） ----------

  /** 指定 user の精算行を period で取得（無ければ null） */
  async function getSettlement(userId: string, periodKey: string): Promise<any | null> {
    const accountId = await getAccountId()
    const { data, error } = await supabase
      .from('expense_settlements')
      .select('*')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .eq('period_key', periodKey)
      .maybeSingle()
    if (error) { console.error('[useExpense] getSettlement:', error); return null }
    return data
  }

  /** 複数 period 分の精算をまとめて取得（ホーム/一覧用） */
  async function getSettlements(userId: string, periodKeys: string[]): Promise<any[]> {
    if (!periodKeys.length) return []
    const accountId = await getAccountId()
    const { data, error } = await supabase
      .from('expense_settlements')
      .select('*')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .in('period_key', periodKeys)
    if (error) { console.error('[useExpense] getSettlements:', error); return [] }
    return data ?? []
  }

  /**
   * 経費申請: status を 申請中 にし、PDFパスを記録する。
   * 再申請（差し戻し後）でも notified_at を null クリアして1回だけ再送できるようにする。
   */
  async function applySettlement(userId: string, periodKey: string, pdfPath: string | null, comment: string | null = null): Promise<any> {
    const accountId = await getAccountId()
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('expense_settlements')
      .upsert(
        {
          account_id: accountId, user_id: userId, period_key: periodKey,
          status: '申請中', applied_at: now, pdf_path: pdfPath, apply_comment: comment,
          reject_reason: null, rejected_at: null, notified_at: null, updated_at: now,
        },
        { onConflict: 'account_id,user_id,period_key' }
      )
      .select()
      .single()
    if (error) throw error
    return data
  }

  return { buildReportPayload, getUser, registerUser, addItem, getItems, deleteItem, saveReport, saveReportById, patchExpenseItem, findOrCreateProxyUser, getExpenseRowsFromReports, getExpenseRowsFromReportsById, getReports, getReportsById, getReport, getReportByUserId, getNextUnsubmittedDate, getNextUnsubmittedDateById, clearUserCache, getSettlement, getSettlements, applySettlement }
}
