// ============================================================
//  apps/liff / composables/useMaster.ts
//  スプシ（GAS経由）からマスタデータを取得する
// ============================================================
import type { MasterData } from '~/types'

const FALLBACK: MasterData = {
  sites: ['ギフト桜ステージ', 'BLH名古屋', 'サボテン', 'TANAKA', 'LOGIFLAGTECK東扇じま', 'ルルレモン'],
  workers: [
    { name: '今井',  unitPrice: 30000 },
    { name: '伊藤',  unitPrice: 23000 },
    { name: '野村',  unitPrice: 23000 },
    { name: '大塚',  unitPrice: 30000 },
    { name: '小島',  unitPrice: 30000 },
    { name: 'Worker18',  unitPrice: 20000 },
    { name: '香田',  unitPrice: 20000 },
    { name: 'Worker33',  unitPrice: 20000 },
    { name: 'アリフ', unitPrice: 20000 },
    { name: '白石',  unitPrice: 23000 },
    { name: '片岡',  unitPrice: 20000 },
    { name: '浅野',  unitPrice: 23000 },
  ],
  subcontractors: ['VendorA', 'VendorB', 'VendorC', 'VendorD', 'VendorE', 'VendorF', 'VendorG', 'VendorH'],
  vehicles: ['ハイエース', 'キャラバン', 'プロボックス', 'その他'],
}

export const useMaster = () => {
  const config = useRuntimeConfig()
  const master = useState<MasterData>('master', () => FALLBACK)
  const loading = useState<boolean>('master-loading', () => false)

  async function fetch() {
    if (!config.public.gasUrl || config.public.appEnv === 'development') {
      console.warn('[Master] 開発モードのためフォールバックデータを使用')
      return
    }

    loading.value = true
    try {
      const res = await $fetch<MasterData>(
        config.public.gasUrl + '?action=getMaster',
        { method: 'GET' }
      )
      if (res.sites?.length) master.value = res
      console.log('[Master] 取得完了:', res.sites?.length, '現場')
    } catch (e) {
      console.warn('[Master] 取得失敗、フォールバックデータを使用:', e)
    } finally {
      loading.value = false
    }
  }

  return {
    master: readonly(master),
    loading: readonly(loading),
    fetch,
    siteNames:           computed(() => master.value.sites.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    workerNames:         computed(() => master.value.workers.map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    subcontractorNames:  computed(() => master.value.subcontractors.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    vehicleNames:        computed(() => master.value.vehicles),
  }
}
