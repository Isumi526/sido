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
  etcUsed?: boolean
  etcCard?: string
}

export interface LineItem {
  label?: string
  yen?: number
}

export interface Expenses {
  carpool?: boolean              // 乗合いフラグ
  vehicles: VehicleExpense[]
  vehicleFiles?: string[]       // 車両領収書等
  hotelName?: string
  hotelYen?: number
  hotelFiles?: string[]         // ホテル領収書
  leopalaceName?: string
  leopalaceYen?: number
  leopalaceFiles?: string[]     // レオパレス領収書
  garbageFactoryM3?: number
  garbageSiteM3?: number
  garbagePhotos?: string[]
  trains: LineItem[]
  trainFiles?: string[]         // 電車領収書
  others: LineItem[]
  otherFiles?: string[]         // その他領収書
  entertainmentLabel?: string
  entertainmentYen?: number
  entertainmentFiles?: string[] // 雑経費領収書
}

export interface SiteReport {
  siteName: string
  customSiteName?: string  // 「その他（新規現場）」選択時の自由記入現場名
  workers: WorkerEntry[]
  expenses: Expenses
  subcontractors: SubcontractorEntry[]
}

export interface DailyReport {
  date: string
  sender: string
  senderId: string
  isWorking: boolean  // true=稼働あり, false=稼働なし（休み等）
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
