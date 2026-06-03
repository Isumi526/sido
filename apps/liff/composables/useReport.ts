// ============================================================
//  composables/useReport.ts
//  日報フォームの状態管理と送信処理
// ============================================================
import type { DailyReport, SiteReport, WorkerEntry, SubcontractorEntry, WorkerRole, VehicleExpense, LineItem } from '~/types'
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

export const createSite = (): SiteReport => ({
  siteName:       '',
  contractorName: '',
  workers:        [createWorker()],
  expenses:       { vehicles: [createVehicle()], trains: [createLineItem()], others: [createLineItem()] },
  subcontractors: [],
  siteNote:       '',
})

// 経費オブジェクトから File[] フィールドを除去（GAS送信用 - *Urls は残す）
function stripFiles(expenses: Record<string, unknown> | object): Record<string, unknown> {
  const { vehicleFiles, trainFiles, hotelFiles, leopalaceFiles, otherFiles, entertainmentFiles, garbagePhotos, ...rest } = expenses as any
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
  { filesKey: 'trainFiles',         urlsKey: 'trainUrls',         category: 'train'         },
  { filesKey: 'hotelFiles',         urlsKey: 'hotelUrls',         category: 'hotel'         },
  { filesKey: 'leopalaceFiles',     urlsKey: 'leopalaceUrls',     category: 'leopalace'     },
  { filesKey: 'otherFiles',         urlsKey: 'otherUrls',         category: 'other'         },
  { filesKey: 'entertainmentFiles', urlsKey: 'entertainmentUrls', category: 'entertainment' },
  { filesKey: 'garbagePhotos',      urlsKey: 'garbagePhotoUrls',  category: 'garbage'       },
] as const

export const useReport = () => {
  const config   = useRuntimeConfig()
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
  function addTrain(si: number)                      { form.value.sites[si].expenses.trains.push(createLineItem()) }
  function removeTrain(si: number, ti: number)       { form.value.sites[si].expenses.trains.splice(ti, 1) }
  function addOther(si: number)                      { form.value.sites[si].expenses.others.push(createLineItem()) }
  function removeOther(si: number, oi: number)       { form.value.sites[si].expenses.others.splice(oi, 1) }

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
    const accountSlug = (config.public.accountSlug as string) || 'default'
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
    }

    if (uploadErrors.length > 0) {
      error.value = `ファイルのアップロードに失敗しました。送信を中止します。\n${uploadErrors.join('\n')}`
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
              ? { ...s, subcontractorName: s.customSubcontractorName || '' }
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
          accountSlug: config.public.accountSlug as string,
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
      submitted.value = true

      // ── ③ 新規現場・新規下請けを Supabase に保存（fire-and-forget）──
      for (const site of payload.sites) {
        if (site.siteName) master.saveSite(site.siteName)
        if (site.contractorName) master.saveContractor(site.contractorName)
        for (const sub of site.subcontractors) {
          if (sub.subcontractorName && sub.subcontractorName !== '__other__') master.saveSub(sub.subcontractorName)
        }
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '送信に失敗しました'
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
    addTrain, removeTrain,
    addOther, removeOther,
    submit, reset,
  }
}
