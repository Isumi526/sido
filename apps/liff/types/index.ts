// ============================================================
//  types/index.ts
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
  customSubcontractorName?: string  // 「その他（新規）」選択時の自由記入名
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
  label?:              string
  yen?:                number
  registrationNumber?: string  // 登録番号（その他資材等）
}

export interface Expenses {
  carpool?: boolean              // 乗合いフラグ
  vehicles: VehicleExpense[]
  vehicleFiles?: File[]         // 車両領収書（アップロード前 File[]）
  vehicleUrls?: string[]        // 車両領収書（Supabase Storage URL）
  hotelName?:             string
  hotelYen?:              number
  hotelRegistration?:     string   // ホテル登録番号
  hotelFiles?: File[]              // ホテル領収書
  hotelUrls?: string[]             // ホテル領収書 URL
  leopalaceName?:             string
  leopalaceYen?:              number
  leopalaceRegistration?:     string   // レオパレス登録番号
  leopalaceFiles?: File[]              // レオパレス領収書
  leopalaceUrls?: string[]             // レオパレス領収書 URL
  garbageFactoryM3?: number
  garbageSiteM3?: number
  garbagePhotos?: File[]          // ゴミ写真
  garbagePhotoUrls?: string[]     // ゴミ写真 URL
  trains: LineItem[]
  trainFiles?: File[]           // 電車領収書
  trainUrls?: string[]          // 電車領収書 URL
  others: LineItem[]
  otherFiles?: File[]           // その他領収書
  otherUrls?: string[]          // その他領収書 URL
  entertainmentLabel?:        string
  entertainmentYen?:          number
  entertainmentRegistration?: string   // 雑経費登録番号
  entertainmentFiles?: File[]          // 雑経費領収書
  entertainmentUrls?: string[]         // 雑経費領収書 URL
}

export interface SiteReport {
  siteName: string
  customSiteName?: string  // 「その他（新規現場）」選択時の自由記入現場名
  workers: WorkerEntry[]
  expenses: Expenses
  subcontractors: SubcontractorEntry[]
  siteNote?: string        // 現場ごとの備考
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
  workers: { id?: string; name: string; unitPrice: number; role: WorkerRole }[]
  subcontractors: string[]
  vehicles: string[]
}

export interface ApiResponse<T = void> {
  success: boolean
  data?: T
  error?: string
}

// ============================================================
//  経費申請 関連型
// ============================================================

export interface User {
  id:           string
  line_user_id: string
  real_name:    string
  worker_role:  'factory' | 'site'
  worker_id?:   string | null
  created_at:   string
  updated_at:   string
}

/** @deprecated use User */
export type ExpenseUser = User

export const EXPENSE_CATEGORIES = [
  'ガソリン代',
  '軽油代',
  '材料費',
  '駐車代',
  'タクシー代',
  '電車代',
  'バス代',
  '駐輪代',
  '名刺',
  '宿泊費',
  'その他',
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export interface ExpenseItem {
  id:                  string
  user_id:             string
  date:                string   // YYYY-MM-DD
  payee:               string   // 支払先
  registration_number: string | null  // 登録番号
  category:            ExpenseCategory
  liters:              number | null  // ℓ（ガソリン代・軽油代のみ）
  site_name:           string | null  // 現場名
  amount:              number
  period_key:          string   // 'YYYY-MM-first' | 'YYYY-MM-second'
  created_at:          string
}

/** 月次PDF用の経費行（daily_reportsから集計） */
export interface ExpenseRow {
  date:                string
  category:            string
  siteName:            string
  amount:              number
  liters?:             number
  note?:               string  // 備考（車両名・電車区間など）
  registrationNumber?: string  // 登録番号
  fileUrls?:           string[]  // 領収書・写真 URL（Supabase Storage）
}

export interface ExpenseItemInput {
  date:                string
  payee:               string
  registration_number: string
  category:            ExpenseCategory
  liters:              number | null
  site_name:           string
  amount:              number
  period_key:          string
}
