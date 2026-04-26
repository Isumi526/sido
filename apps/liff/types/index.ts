// ============================================================
//  apps/liff / types/index.ts
//  packages/types からインライン化（Vercel workspace解決問題の回避）
// ============================================================

export type WorkerRole = 'factory' | 'site'

export interface WorkerEntry {
  workerId: string
  workerName: string
  workerRole: WorkerRole
  hours: number                // 稼働時間 (1-8h)
  overtimeHours: number        // 残業時間 (1.25x)
  holidayOvertimeHours: number // 休日残業時間 (1.5x)
}

export interface SubcontractorEntry {
  subcontractorId: string
  subcontractorName: string
  count: number
}

export interface VehicleExpense {
  vehicleName?: string
  distanceKm?: number
  dieselKm?: number
  parkingYen?: number
  highwayYen?: number
}

export interface LineItem {
  label?: string
  yen?: number
}

export interface Expenses {
  vehicles: VehicleExpense[]
  hotelName?: string
  hotelYen?: number
  leopalaceName?: string
  leopalaceYen?: number
  garbageFactoryYen?: number
  garbageSiteYen?: number
  trains: LineItem[]
  others: LineItem[]
  entertainmentLabel?: string
  entertainmentYen?: number
}

export interface SiteReport {
  siteName: string
  workers: WorkerEntry[]
  expenses: Expenses
  subcontractors: SubcontractorEntry[]
}

export interface DailyReport {
  date: string
  sender: string
  senderId: string
  sites: SiteReport[]
  note?: string
}

export interface MasterData {
  sites: string[]
  workers: { name: string; unitPrice: number; role: WorkerRole }[]
  subcontractors: string[]
  vehicles: string[]
}

export interface ApiResponse<T = void> {
  success: boolean
  data?: T
  error?: string
}
