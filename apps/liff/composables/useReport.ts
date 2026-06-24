// ============================================================
//  composables/useReport.ts
//  日報フォームの状態管理と送信処理
// ============================================================
import { useI18n } from 'vue-i18n'
import type { DailyReport, SiteReport, WorkerEntry, SubcontractorEntry, WorkerRole, VehicleExpense, LineItem, ExpenseFileLineItem, HighwayLineItem } from '~/types'
import type { RateBreakdown } from '~/utils/workerHours'
import { computeWorkerHours, calcBreakMinutes, parseMin } from '~/utils/workerHours'
import { uploadExpenseFiles } from '~/utils/uploadExpenseFiles'
import { getPeriodKey } from '~/composables/useExpense'

export const createWorker = (role: WorkerRole = 'site'): WorkerEntry => ({
  workerId:     '',
  workerName:   '',
  workerRole:   role,
  startTime:    '08:00',
  endTime:      '17:30',
  breakMinutes: calcBreakMinutes(role, '08:00', '17:30'),
  hoursNormal:        8,
  hoursOT:            0,
  hoursNight:         0,
  hoursOTNight:       0,
  hoursSunday:        0,
  hoursSundayOT:      0,
  hoursSundayNight:   0,
  hoursSundayOTNight: 0,
})

export const createSub = (): SubcontractorEntry => ({
  subcontractorId:          '',
  subcontractorName:        '',
  customSubcontractorName:  '',
  count:                    1,
})

export const createVehicle = (): VehicleExpense => ({
  vehicleName: '',
  distanceKm:  undefined,
  dieselKm:    undefined,
  parkingYen:  undefined,
  highwayYen:  undefined,
  gasTategae:     false,
  dieselTategae:  false,
  parkingTategae: false,
  highwayTategae: false,
})

export const createLineItem = (): LineItem => ({ label: '', yen: undefined, tategae: false })
export const createParking = (): ExpenseFileLineItem => ({ yen: undefined, tategae: false, files: [] })
export const createHighway = (): HighwayLineItem => ({ yen: undefined, tategae: false, etcCard: '', files: [] })
export const createTrain = (): ExpenseFileLineItem => ({ label: '', yen: undefined, tategae: false, files: [] })

export const createSite = (): SiteReport => ({
  siteName:       '',
  contractorName: '',
  workers:        [createWorker()],
  expenses:       { vehicles: [createVehicle()], parkings: [], highways: [], trains: [createTrain()], others: [createLineItem()], entertainments: [createLineItem()] },
  subcontractors: [],
  siteNote:       '',
})

// 経費オブジェクトから File[] フィールドを除去（GAS送信用 - *Urls は残す）
function stripFiles(expenses: Record<string, unknown> | object): Record<string, unknown> {
  const { vehicleFiles, trainFiles, hotelFiles, leopalaceFiles, otherFiles, entertainmentFiles, garbagePhotos, ...rest } = expenses as any
  // 明細ごとに File[] を持つ配列（駐車場代・高速代）からも files を除去（fileUrls は残す）
  const stripItemFiles = (items: any[] | undefined) =>
    (items ?? []).map(({ files, ...item }: any) => item)
  if (Array.isArray(rest.parkings)) rest.parkings = stripItemFiles(rest.parkings)
  if (Array.isArray(rest.highways)) rest.highways = stripItemFiles(rest.highways)
  if (Array.isArray(rest.trains))   rest.trains   = stripItemFiles(rest.trains)
  if (Array.isArray(rest.others))   rest.others   = stripItemFiles(rest.others)
  if (Array.isArray(rest.entertainments)) rest.entertainments = stripItemFiles(rest.entertainments)
  return rest
}

// undefined / null / 空文字 のキーを再帰的に除去してペイロードを軽量化
function stripEmpty(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripEmpty)
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, stripEmpty(v)])
    )
  }
  return obj
}

// ファイルカテゴリ定義（*Files → *Urls のマッピング）
const FILE_CATEGORIES = [
  { filesKey: 'vehicleFiles',       urlsKey: 'vehicleUrls',       category: 'vehicle'       },
  // 電車は明細ごと領収書（trains[].files）へ移行。共通 trainFiles は廃止（旧 trainUrls は集計で後方互換読み取り）
  { filesKey: 'hotelFiles',         urlsKey: 'hotelUrls',         category: 'hotel'         },
  { filesKey: 'leopalaceFiles',     urlsKey: 'leopalaceUrls',     category: 'leopalace'     },
  { filesKey: 'otherFiles',         urlsKey: 'otherUrls',         category: 'other'         },
  { filesKey: 'entertainmentFiles', urlsKey: 'entertainmentUrls', category: 'entertainment' },
  { filesKey: 'garbagePhotos',      urlsKey: 'garbagePhotoUrls',  category: 'garbage'       },
] as const

export const useReport = () => {
  const config   = useRuntimeConfig()
  const { t }    = useI18n()
  const { profile, isTester } = useLiff()
  const master   = useMaster()
  const supabase = useSupabase()

  const submitting = ref(false)
  const submitted  = ref(false)
  const error      = ref<string | null>(null)

  const form = ref<DailyReport>({
    date:      new Date().toISOString().split('T')[0],
    sender:    '',
    senderId:  '',
    isWorking: true,
    sites:     [createSite()],
    note:      '',
  })

  function addSite()            { form.value.sites.push(createSite()) }
  function removeSite(i: number){ form.value.sites.splice(i, 1) }

  function addWorker(si: number)          { form.value.sites[si].workers.push(createWorker()) }
  function removeWorker(si: number, wi: number) { form.value.sites[si].workers.splice(wi, 1) }

  function addSub(si: number)             { form.value.sites[si].subcontractors.push(createSub()) }
  function removeSub(si: number, si2: number) { form.value.sites[si].subcontractors.splice(si2, 1) }

  function addVehicle(si: number)                    { form.value.sites[si].expenses.vehicles.push(createVehicle()) }
  function removeVehicle(si: number, vi: number)     { form.value.sites[si].expenses.vehicles.splice(vi, 1) }
  function addParking(si: number)                    { (form.value.sites[si].expenses.parkings ??= []).push(createParking()) }
  function removeParking(si: number, pi: number)     { form.value.sites[si].expenses.parkings?.splice(pi, 1) }
  function addHighway(si: number)                    { (form.value.sites[si].expenses.highways ??= []).push(createHighway()) }
  function removeHighway(si: number, hi: number)     { form.value.sites[si].expenses.highways?.splice(hi, 1) }
  function addTrain(si: number)                      { form.value.sites[si].expenses.trains.push(createTrain()) }
  function removeTrain(si: number, ti: number)       { form.value.sites[si].expenses.trains.splice(ti, 1) }
  function addOther(si: number)                      { form.value.sites[si].expenses.others.push(createLineItem()) }
  function removeOther(si: number, oi: number)       { form.value.sites[si].expenses.others.splice(oi, 1) }
  function addEntertainment(si: number)                { (form.value.sites[si].expenses.entertainments ??= []).push(createLineItem()) }
  function removeEntertainment(si: number, ei: number) { form.value.sites[si].expenses.entertainments?.splice(ei, 1) }

  function reset() {
    submitted.value = false
    error.value     = null
    form.value = {
      date:      new Date().toISOString().split('T')[0],
      sender:    '',
      senderId:  '',
      isWorking: true,
      sites:     [createSite()],
      note:      '',
    }
  }

  async function submit() {
    if (submitting.value) return
    submitting.value = true
    error.value      = null

    // プロフィール情報をセット（sender は呼び元で本名を設定済みの場合は上書きしない）
    if (!form.value.sender) form.value.sender = profile.value?.displayName || 'unknown'
    form.value.senderId = profile.value?.userId || 'unknown'

    // 送信日が日曜か判定
    const isSunday = new Date(form.value.date + 'T00:00:00').getDay() === 0

    // ── ① ファイルを Supabase Storage にアップロードして *Urls にセット ──
    const senderName  = form.value.sender
    // 身元優先のスラッグ（email/pwは自テナント・LINEは env）。env固定だと別テナントのstorageパスに保存される。
    const accountSlug = (await useAccount().effectiveSlug()) || 'default'
    const periodKey   = getPeriodKey(form.value.date)          // 'YYYY-MM-first'
    const periodHalf  = periodKey.split('-').pop() as string   // 'first' | 'second'

    const uploadErrors: string[] = []

    for (const site of form.value.sites) {
      const siteName = site.siteName === '__other__'
        ? (site.customSiteName || 'other')
        : site.siteName
      if (!siteName) continue

      for (const { filesKey, urlsKey, category } of FILE_CATEGORIES) {
        const files = (site.expenses as any)[filesKey] as File[] | undefined
        if (!files?.length) continue
        try {
          const urls = await uploadExpenseFiles(
            supabase, files, form.value.date, senderName, siteName, category, accountSlug, periodHalf
          )
          ;(site.expenses as any)[urlsKey] = urls
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[FileUpload] ${filesKey}:`, msg)
          uploadErrors.push(`${category}: ${msg}`)
        }
      }

      // 明細ごとに領収書を持つ駐車場代・高速代（per-item upload）
      const perItemGroups: Array<{ items: ExpenseFileLineItem[] | undefined; prefix: string }> = [
        { items: site.expenses.parkings, prefix: 'parking' },
        { items: site.expenses.highways, prefix: 'highway' },
        { items: site.expenses.trains,   prefix: 'train'   },
        { items: site.expenses.others,   prefix: 'other'   },
        { items: site.expenses.entertainments, prefix: 'entertainment' },
      ]
      for (const { items, prefix } of perItemGroups) {
        for (let i = 0; i < (items?.length ?? 0); i++) {
          const item = items![i]
          if (!item.files?.length) continue
          try {
            const urls = await uploadExpenseFiles(
              supabase, item.files, form.value.date, senderName, siteName, `${prefix}_${i}`, accountSlug, periodHalf
            )
            item.fileUrls = urls
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`[FileUpload] ${prefix}_${i}:`, msg)
            uploadErrors.push(`${prefix}: ${msg}`)
          }
        }
      }
    }

    if (uploadErrors.length > 0) {
      error.value = t('report2.uploadFailed', { errors: uploadErrors.join('\n') })
      submitting.value = false
      return
    }

    // 現場跨ぎ残業対応: 作業者ごとに startTime 順で累積稼働分を引き継いで計算
    const workerAccum: Record<string, number> = {}

    // WeakMap は Vue3 reactive proxy で不安定なため、siteIdx-workerIdx 文字列キーの Map を使う
    type WorkerRef = { siteIdx: number; workerIdx: number; w: WorkerEntry }
    const workerList: WorkerRef[] = []
    form.value.sites.forEach((site, si) => {
      site.workers.forEach((w, wi) => {
        if (w.workerName && !(w as any)._manualHours) workerList.push({ siteIdx: si, workerIdx: wi, w })
      })
    })
    workerList.sort((a, b) => parseMin(a.w.startTime || '08:00') - parseMin(b.w.startTime || '08:00'))

    const breakdownMap = new Map<string, RateBreakdown>()
    for (const { siteIdx, workerIdx, w } of workerList) {
      const key    = w.workerId || w.workerName
      const accum  = workerAccum[key] ?? 0
      const { workedMin, ...breakdown } = computeWorkerHours(
        w.startTime, w.endTime, calcBreakMinutes(w.workerRole, w.startTime, w.endTime), isSunday, accum
      )
      workerAccum[key] = workedMin
      breakdownMap.set(`${siteIdx}-${workerIdx}`, breakdown)
    }

    // 空の作業員・下請けを除去 & 料率別時間を計算してセット
    const payload: DailyReport = {
      ...form.value,
      sites: form.value.sites.map((site, si) => {
        const isNew = site.siteName === '__other__'
        const isNewContractor = site.contractorName === '__other__'
        return {
          ...site,
          siteName:  isNew ? (site.customSiteName || '') : site.siteName,
          isNewSite: isNew,
          contractorName: isNewContractor ? (site.customContractorName || '') : (site.contractorName || ''),
          workers: site.workers
            .map((w, wi) => ({ w, wi }))
            .filter(({ w }) => w.workerName)
            .map(({ w, wi }) => {
              const r = (w as any)._manualHours
                ? {}
                : (breakdownMap.get(`${si}-${wi}`) ?? {})
              return { ...w, ...r }
            }),
          subcontractors: site.subcontractors
            .filter(s => s.subcontractorName)
            .map(s => s.subcontractorName === '__other__'
              ? { ...s, subcontractorName: s.customSubcontractorName || '', _isNew: true }  // 新規作成＝現場へ自動紐付け対象
              : s
            )
            .filter(s => s.subcontractorName)
            .map(s => ({ ...s, count: Math.max(1, parseInt(String(s.count), 10) || 1) })),
        }
      }),
    }

    try {
      const efUrl = config.public.edgeFunctionUrl
      if (!efUrl) {
        console.log('[Report] Edge Function URL未設定 - 送信ペイロード:', JSON.stringify(payload, null, 2))
      } else {
        // dev環境またはテスターはtest-プレフィックスの関数を呼び出す
        const fnPrefix = config.public.appEnv === 'development' ? 'test-' : ''

        // ── ② Edge Function に送信（File[] を除去・*Urls はそのまま含む）──
        const mainPayload = {
          ...payload,
          accountSlug,
          sites: payload.sites.map(site => ({
            ...site,
            expenses: stripFiles(site.expenses),
          })),
        }
        await fetch(`${efUrl}/${fnPrefix}submit-report`, {
          method:    'POST',
          keepalive: true,
          headers:   {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${config.public.supabaseAnonKey}`,
          },
          body:      JSON.stringify(stripEmpty(mainPayload)),
        })
      }
      // ── ③ 新規現場・新規下請けを Supabase に保存（送信完了表示の前に確実化）──
      //  fire-and-forget だと「送信完了」直後にLIFFを閉じた際に upsert が中断され、
      //  登録した下請が次回プルダウンに出ない事象が起きていた。await して確実に永続化する。
      const masterSaves: Promise<void>[] = []
      for (const site of payload.sites) {
        if (site.siteName) masterSaves.push(master.saveSite(site.siteName))
        if (site.contractorName) masterSaves.push(master.saveContractor(site.contractorName))
        for (const sub of site.subcontractors) {
          // 新規作成(__other__)の業者だけ、その現場へ自動紐付け(AC4)。既存業者の紐付けは変えない。
          if (sub.subcontractorName && sub.subcontractorName !== '__other__') {
            masterSaves.push(master.saveSub(sub.subcontractorName, (sub as any)._isNew ? site.siteName : undefined))
          }
        }
      }
      const masterResults = await Promise.allSettled(masterSaves)
      const masterFailed = masterResults.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (masterFailed.length) console.error('[Report] マスタ保存に失敗:', masterFailed.map(r => r.reason))

      submitted.value = true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : t('report2.submitFailed')
      console.error('[Report] 送信エラー:', e)
    } finally {
      submitting.value = false
    }
  }

  return {
    form,
    submitting: readonly(submitting),
    submitted:  readonly(submitted),
    error:      readonly(error),
    addSite, removeSite,
    addWorker, removeWorker,
    addSub, removeSub,
    addVehicle, removeVehicle,
    addParking, removeParking,
    addHighway, removeHighway,
    addTrain, removeTrain,
    addOther, removeOther,
    addEntertainment, removeEntertainment,
    submit, reset,
  }
}
