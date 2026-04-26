// ============================================================
//  apps/liff / composables/useReport.ts
//  日報フォームの状態管理と送信処理
// ============================================================
import type { DailyReport, SiteReport, WorkerEntry, SubcontractorEntry, WorkerRole, VehicleExpense, LineItem } from '~/types'
import { computeWorkerHours } from '~/utils/workerHours'

export const createWorker = (role: WorkerRole = 'site'): WorkerEntry => ({
  workerId:     '',
  workerName:   '',
  workerRole:   role,
  startTime:    '08:00',
  endTime:      '17:00',
  breakMinutes: 60,
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
  subcontractorId:   '',
  subcontractorName: '',
  count:             1,
})

export const createVehicle = (): VehicleExpense => ({
  vehicleName: '',
  distanceKm:  undefined,
  dieselKm:    undefined,
  parkingYen:  undefined,
  highwayYen:  undefined,
})

export const createLineItem = (): LineItem => ({ label: '', yen: undefined })

export const createSite = (): SiteReport => ({
  siteName:       '',
  workers:        [createWorker()],
  expenses:       { vehicles: [createVehicle()], trains: [createLineItem()], others: [createLineItem()] },
  subcontractors: [createSub()],
})

export const useReport = () => {
  const config  = useRuntimeConfig()
  const { profile } = useLiff()

  const submitting = ref(false)
  const submitted  = ref(false)
  const error      = ref<string | null>(null)

  const form = ref<DailyReport>({
    date:     new Date().toISOString().split('T')[0],
    sender:   '',
    senderId: '',
    sites:    [createSite()],
    note:     '',
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
      date:     new Date().toISOString().split('T')[0],
      sender:   '',
      senderId: '',
      sites:    [createSite()],
      note:     '',
    }
  }

  async function submit() {
    if (submitting.value) return
    submitting.value = true
    error.value      = null

    // プロフィール情報をセット
    form.value.sender   = profile.value?.displayName || 'unknown'
    form.value.senderId = profile.value?.userId       || 'unknown'

    // 送信日が日曜か判定
    const isSunday = new Date(form.value.date + 'T00:00:00').getDay() === 0

    // 空の作業員・下請けを除去 & 料率別時間を計算してセット
    const payload: DailyReport = {
      ...form.value,
      sites: form.value.sites.map(site => ({
        ...site,
        workers: site.workers
          .filter(w => w.workerName)
          .map(w => {
            const r = computeWorkerHours(w.startTime, w.endTime, w.breakMinutes, isSunday)
            return { ...w, ...r }
          }),
        subcontractors: site.subcontractors.filter(s => s.subcontractorName),
      })),
    }

    try {
      if (!config.public.gasUrl || config.public.appEnv === 'development') {
        console.log('[Report] 送信ペイロード:', JSON.stringify(payload, null, 2))
        await new Promise(r => setTimeout(r, 800))
      } else {
        await fetch(config.public.gasUrl, {
          method:  'POST',
          mode:    'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body:    JSON.stringify({ action: 'submitReport', ...payload }),
        })
      }
      submitted.value = true
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
