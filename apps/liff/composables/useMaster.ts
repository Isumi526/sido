// ============================================================
//  apps/liff / composables/useMaster.ts
//  スプシ（GAS経由）からマスタデータを取得する
// ============================================================
import type { MasterData } from '~/types'

const FALLBACK: MasterData = {
  sites: ['ギフト桜ステージ', 'BLH名古屋', 'サボテン', 'TANAKA', 'LOGIFLAGTECK東扇じま', 'ルルレモン'],
  workers: [
    // 工場・事務所
    { name: '今井',   unitPrice: 30000, role: 'factory' },
    { name: '伊藤',   unitPrice: 23000, role: 'factory' },
    { name: '野村',   unitPrice: 23000, role: 'factory' },
    { name: '毛利',   unitPrice: 20000, role: 'factory' },
    { name: '鵜飼',   unitPrice: 20000, role: 'factory' },
    { name: '相馬',   unitPrice: 20000, role: 'factory' },
    { name: 'Worker07', unitPrice: 20000, role: 'factory' },
    { name: '前田',   unitPrice: 20000, role: 'factory' },
    { name: 'ジェイ', unitPrice: 20000, role: 'factory' },
    { name: 'ヌル',   unitPrice: 20000, role: 'factory' },
    { name: 'デデ',   unitPrice: 20000, role: 'factory' },
    { name: 'アチェ', unitPrice: 20000, role: 'factory' },
    { name: '平床',   unitPrice: 20000, role: 'factory' },
    { name: '作長',   unitPrice: 20000, role: 'factory' },
    // 現場
    { name: '大塚',   unitPrice: 30000, role: 'site' },
    { name: '小島',   unitPrice: 30000, role: 'site' },
    { name: '山本',   unitPrice: 20000, role: 'site' },
    { name: 'Worker18',   unitPrice: 20000, role: 'site' },
    { name: 'Worker19', unitPrice: 20000, role: 'site' },
    { name: 'アリフ', unitPrice: 20000, role: 'site' },
    { name: 'Worker21', unitPrice: 20000, role: 'site' },
    { name: 'ハイ',   unitPrice: 20000, role: 'site' },
    { name: 'ガイ',   unitPrice: 20000, role: 'site' },
    { name: '辻',     unitPrice: 20000, role: 'site' },
    { name: '佐藤',   unitPrice: 20000, role: 'site' },
    { name: 'さや',   unitPrice: 20000, role: 'site' },
    { name: '片岡',   unitPrice: 20000, role: 'site' },
    { name: 'Worker28',   unitPrice: 20000, role: 'site' },
    { name: '浅野',   unitPrice: 23000, role: 'site' },
    { name: '横井',   unitPrice: 20000, role: 'site' },
    { name: '白石',   unitPrice: 23000, role: 'site' },
    { name: '香田',   unitPrice: 20000, role: 'site' },
    { name: 'Worker33',   unitPrice: 20000, role: 'site' },
    { name: 'Worker34',   unitPrice: 20000, role: 'site' },
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
    siteNames:              computed(() => master.value.sites.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    workerNames:            computed(() => master.value.workers.map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    factoryWorkerNames:     computed(() => master.value.workers.filter(w => w.role === 'factory').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    siteWorkerNames:        computed(() => master.value.workers.filter(w => w.role === 'site').map(w => w.name).slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    subcontractorNames:     computed(() => master.value.subcontractors.slice().sort((a, b) => a.localeCompare(b, 'ja'))),
    vehicleNames:           computed(() => master.value.vehicles),
  }
}
