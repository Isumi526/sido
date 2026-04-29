// ============================================================
//  apps/liff / types/index.ts
//  packages/types からインライン化（Vercel workspace解決問題の回避）
// ============================================================

export type WorkerRole = 'factory' | 'site'

export interface WorkerEntry {
  workerId:     string
  workerName:   string
  workerRole:   WorkerRole
  startTime:    string   // "08:00"
  endTime:      string   // "17:30"
  breakMinutes: number   // 休憩時間（分）
  // 料率別稼働時間（送信前に自動計算）
  hoursNormal:        number  // 1.00  通常
  hoursOT:            number  // 1.25  残業
  hoursNight:         number  // 1.25  深夜
  hoursOTNight:       number  // 1.50  残業+深夜
  hoursSunday:        number  // 1.35  法定休日
  hoursSundayOT:      number  // 1.60  法定休日+残業
  hoursSundayNight:   number  // 1.60  法定休日+深夜
  hoursSundayOTNight: number  // 1.85  法定休日+残業+深夜
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
