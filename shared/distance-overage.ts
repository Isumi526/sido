// ============================================================
//  shared/distance-overage.ts — 日報の車両距離「既定値超過」の申請・承認（距離Step2・2026-09-20）
//
//  正本はここ。`npm run sync:shared` で LIFF / admin / EF に *.gen.ts として配布する。
//
//  ★方式（2026-09-03 確定・変更しないこと）: 「既定値で計上し、承認されたら申請値に差し替える」
//   - 現場マスタの既定距離（sites.default_distance_km）より大きい距離を作業員が入れたら、
//     保存する JSON では **距離欄（distanceKm/dieselKm）を既定値に戻し**、超過分は
//     `vehicle.overages[field]` に「申請」として積む（理由必須・status='pending'）。
//   - 集計・PDF・按分（docs/expense-data-consumers.md の消費箇所）は従来どおり距離欄だけを読む
//     ＝ 未承認の超過分で金額が動かない。消費箇所側の変更は不要（ここが一番の狙い）。
//   - 承認者が承認すると EF（report-distance）が距離欄を申請値に差し替え、status='approved' にする。
//   - 日報の提出は止めない（夕方に現場から出す運用）。
//
//  ★申請の器を別テーブルにせず日報 JSON の中に持つ理由:
//   日報は編集承認（daily_report_pending_edits）や期限切れ提出など複数の経路で保存される。
//   別テーブルにすると経路ごとに行の作成/更新を追随させる必要があり、漏れると「JSONは超過のまま・
//   申請行が無い」孤児ができる。JSON に埋めておけばどの経路で保存されても申請が一緒に運ばれる。
//   一覧・バッジは daily_reports を走査して拾う（現場未設定の紐付けバッジと同じ作り）。
// ============================================================

export type DistanceField = 'distanceKm' | 'dieselKm'
export const DISTANCE_FIELDS: DistanceField[] = ['distanceKm', 'dieselKm']

export type DistanceOverageStatus = 'pending' | 'approved' | 'rejected'

export type DistanceOverage = {
  /** 作業員が入れた距離(km) */
  requestedKm: number
  /** 申請時点の現場の既定距離(km)＝承認されるまで計上される値 */
  defaultKm: number
  reason: string
  status: DistanceOverageStatus
  requestedAt: string
  decidedBy?: string | null
  decidedAt?: string | null
}

/** 日報 JSON の車両要素のうち、この機能が読む/書く部分 */
export type VehicleWithOverage = {
  vehicleName?: string
  distanceKm?: number | null
  dieselKm?: number | null
  /** 超過申請（欄ごと）。無ければ超過なし */
  overages?: Partial<Record<DistanceField, DistanceOverage>>
  /** 入力中の理由（フォーム状態）。保存時に overages[*].reason へ写す */
  overageReason?: string
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** その欄が「既定値超過」か（既定値が無い現場は常に false＝申告どおり） */
export function isOverDefault(entered: unknown, defaultKm: number | null | undefined): boolean {
  const e = num(entered); const d = num(defaultKm)
  return e !== null && d !== null && d > 0 && e > d
}

/**
 * 保存直前に呼ぶ。フォームの車両（作業員が入れた値）を「保存する形」に直す。
 *  - 超過している欄: 距離欄 ← 既定値、overages[field] ← 申請(pending)。理由は veh.overageReason から
 *    （既に承認済みで同じ値なら差し替え済みなのでそのまま／却下済み・値が変わったなら新しい申請にする）
 *  - 超過していない欄: overages[field] を消す（既定値以下は理由不要＝申告どおり）
 * 戻り値: 理由が空のまま超過している欄（呼び出し側はこれが空になるまで送信させない）
 */
export function normalizeVehicleOverages(veh: VehicleWithOverage, defaultKm: number | null | undefined, now = new Date()): DistanceField[] {
  const missingReason: DistanceField[] = []
  const d = num(defaultKm)
  const reason = String(veh.overageReason ?? '').trim()
  for (const field of DISTANCE_FIELDS) {
    const entered = num(veh[field])
    const cur = veh.overages?.[field]
    if (!isOverDefault(entered, d)) {
      if (veh.overages) { delete veh.overages[field] }
      continue
    }
    // 承認済みで同じ値＝差し替え済み。触らない
    if (cur && cur.status === 'approved' && cur.requestedKm === entered) continue
    // 申請中で同じ値＝申請を維持（理由の更新だけ反映）。距離欄は既定値に戻す
    if (cur && cur.status === 'pending' && cur.requestedKm === entered) {
      if (reason) cur.reason = reason
      if (!cur.reason) missingReason.push(field)
      veh[field] = cur.defaultKm
      continue
    }
    if (!reason) { missingReason.push(field); continue }
    veh.overages = veh.overages ?? {}
    veh.overages[field] = { requestedKm: entered as number, defaultKm: d as number, reason, status: 'pending', requestedAt: now.toISOString() }
    veh[field] = d as number
  }
  if (veh.overages && Object.keys(veh.overages).length === 0) delete veh.overages
  return missingReason
}

/**
 * 編集で開く時に呼ぶ。保存形（距離欄＝既定値・申請は overages）を「作業員が入れた形」に戻す。
 *  pending の欄は申請値を距離欄に出し、理由を overageReason に復元する（もう一度理由を書かせない）。
 *  approved/rejected はそのまま（approved は距離欄がもう申請値・rejected は既定値のまま＝申告し直す）。
 */
export function denormalizeVehicleOverages(veh: VehicleWithOverage): void {
  const ov = veh.overages
  if (!ov) return
  for (const field of DISTANCE_FIELDS) {
    const o = ov[field]
    if (!o || o.status !== 'pending') continue
    veh[field] = o.requestedKm
    if (!veh.overageReason && o.reason) veh.overageReason = o.reason
  }
}

/** 承認一覧・バッジ用: 日報1件から承認待ちの超過申請を拾う */
export type PendingOverageRef = {
  siteIndex: number
  vehicleIndex: number
  field: DistanceField
  siteName: string
  vehicleName: string
  overage: DistanceOverage
}
export function pendingOveragesOf(sites: unknown): PendingOverageRef[] {
  const out: PendingOverageRef[] = []
  const arr = Array.isArray(sites) ? sites : []
  arr.forEach((site: any, si: number) => {
    const vehicles = Array.isArray(site?.expenses?.vehicles) ? site.expenses.vehicles : []
    vehicles.forEach((veh: any, vi: number) => {
      for (const field of DISTANCE_FIELDS) {
        const o = veh?.overages?.[field]
        if (o && o.status === 'pending') out.push({ siteIndex: si, vehicleIndex: vi, field, siteName: String(site?.siteName ?? ''), vehicleName: String(veh?.vehicleName ?? ''), overage: o })
      }
    })
  })
  return out
}

/** 日報 JSON に承認待ちの超過申請があるか（バッジ・一覧の粗い絞り込み用） */
export function hasPendingOverage(sites: unknown): boolean {
  return pendingOveragesOf(sites).length > 0
}

export const DISTANCE_FIELD_LABELS: Record<DistanceField, string> = { distanceKm: 'ガソリン(km)', dieselKm: '軽油(km)' }
