// ============================================================
//  apps/liff / composables/useReport.ts
//  日報フォームの状態管理と送信処理
// ============================================================
import type { DailyReport, SiteReport, WorkerEntry, SubcontractorEntry } from '@app/types'

export const createWorker = (): WorkerEntry => ({
  workerId:   '',
  workerName: '',
  days:       1.0,
  overtime:   0,
})

export const createSub = (): SubcontractorEntry => ({
  subcontractorId:   '',
  subcontractorName: '',
  count:             1,
})

export const createSite = (): SiteReport => ({
  siteName:       '',
  workers:        [createWorker()],
  expenses:       {},
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

    // 空の作業員・下請けを除去
    const payload: DailyReport = {
      ...form.value,
      sites: form.value.sites.map(site => ({
        ...site,
        workers:        site.workers.filter(w => w.workerName),
        subcontractors: site.subcontractors.filter(s => s.subcontractorName),
      })),
    }

    try {
      if (!config.public.gasUrl) {
        // 開発モード: コンソールに出力するだけ
        console.log('[Report] 送信ペイロード:', JSON.stringify(payload, null, 2))
        await new Promise(r => setTimeout(r, 800))
      } else {
        await $fetch(config.public.gasUrl, {
          method: 'POST',
          body:   JSON.stringify({ action: 'submitReport', ...payload }),
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
    submit, reset,
  }
}
