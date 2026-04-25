// ============================================================
//  apps/liff / types/index.ts
//  packages/types からインライン化（Vercel workspace解決問題の回避）
// ============================================================

export interface WorkerEntry {
  workerId: string
  workerName: string
  days: number
  overtime: number
}

export interface SubcontractorEntry {
  subcontractorId: string
  subcontractorName: string
  count: number
}

export interface Expenses {
  vehicle?: string
  distanceKm?: number
  parkingYen?: number
  highwayYen?: number
  trainYen?: number
  garbageFactoryYen?: number
  garbageSiteYen?: number
  hotelYen?: number
  otherYen?: number
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
  workers: { name: string; unitPrice: number }[]
  subcontractors: string[]
  vehicles: string[]
}

export interface ApiResponse<T = void> {
  success: boolean
  data?: T
  error?: string
}
