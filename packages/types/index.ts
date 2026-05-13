// ============================================================
//  types
//  全アプリ共通の型定義
// ============================================================

// ── マスタデータ ─────────────────────────────────────────────

export interface Site {
  id: string
  name: string
  active: boolean
  createdAt: string
}

export interface Worker {
  id: string
  name: string
  unitPrice: number
  role: 'factory' | 'site'
  active: boolean
}

export interface Subcontractor {
  id: string
  name: string
  active: boolean
}

export interface Vehicle {
  id: string
  name: string
}

// ── 日報 ─────────────────────────────────────────────────────

export interface WorkerEntry {
  workerId: string
  workerName: string
  days: number
  overtime: number // 時間
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
  date: string          // YYYY-MM-DD
  sender: string        // LINE表示名
  senderId: string      // LINE userId
  sites: SiteReport[]
  note?: string
}

// ── APIレスポンス ─────────────────────────────────────────────

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
