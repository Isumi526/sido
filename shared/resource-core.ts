// ============================================================
//  shared/resource-core.ts  ★単一ソース（admin / liff 共有）
//  車両・道具・部屋などの予約（リソース予定B-1・2026-09-19）の純粋ロジック。
//  予定管理の「車両」「道具」タブ（日×対象のマトリクス）で admin と LIFF が同じ計算をする。
//  ここだけを編集し、`npm run sync:shared` で各アプリの resource-core.gen.ts を再生成すること。
//  ※ import を持たない自己完結ファイル。
// ============================================================

/** 組み込みの種類。会社独自の種類（B-3）は 'custom_…' のキーで resource_types 表から来る */
export type BuiltinResourceTypeKey = 'vehicle' | 'tool' | 'room'
export type ResourceTypeKey = BuiltinResourceTypeKey | string

export const RESOURCE_TYPE_LABEL: Record<BuiltinResourceTypeKey, string> = { vehicle: '車両', tool: '道具', room: '会議室' }
/** 種類 → 「使う機能」のキー */
export const RESOURCE_TYPE_FEATURE: Record<BuiltinResourceTypeKey, 'vehicles' | 'tools' | 'rooms'> = { vehicle: 'vehicles', tool: 'tools', room: 'rooms' }
/** 予定管理のタブに出す順（機能ONのものだけ出す）。独自の種類はこの後ろに sort_order 順 */
export const RESOURCE_TYPE_ORDER: BuiltinResourceTypeKey[] = ['vehicle', 'tool', 'room']
export const isBuiltinResourceType = (k: string): k is BuiltinResourceTypeKey => (RESOURCE_TYPE_ORDER as string[]).includes(k)

/** 予定管理のタブ1つ分（組み込み＋独自を同じ形で扱う） */
export type ResourceTypeDef = {
  key: ResourceTypeKey
  name: string
  /** 台帳が resources 表（会議室・独自）か、既存マスタ（車両・道具）か */
  generic: boolean
  blockOverlap: boolean
  requireTime: boolean
}
export const BUILTIN_TYPE_DEFS: Record<BuiltinResourceTypeKey, ResourceTypeDef> = {
  vehicle: { key: 'vehicle', name: '車両', generic: false, blockOverlap: false, requireTime: false },
  tool:    { key: 'tool',    name: '道具', generic: false, blockOverlap: false, requireTime: false },
  room:    { key: 'room',    name: '会議室', generic: true, blockOverlap: true, requireTime: true },
}
/** 独自の種類のキー（会社内で一意）。名前から作るのではなく乱数＝改名しても予約が付いてくる */
export function newCustomTypeKey(): string { return `custom_${Math.random().toString(36).slice(2, 10)}` }

export type ReservationStatus = 'reserved' | 'in_use' | 'done' | 'canceled'

export type ResourceItem = {
  id: string; name: string
  /** 道具（B-2）: 実績から作る「今の状況」。あれば予約より優先して列見出しに出す */
  now_label?: string | null
  now_kind?: 'in_use' | 'broken' | null
  [k: string]: unknown
}

export type Reservation = {
  id: string
  resource_type: string
  resource_ref: string
  worker_id: string | null
  worker_name?: string | null
  companions: string[]
  site_id: string | null
  site_name?: string | null
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  purpose: string | null
  status: ReservationStatus
  created_by_worker_id?: string | null
}

/** その日・その対象のセルに出す予約（取消は除く・開始→時刻順） */
export function reservationsForCell(list: Reservation[], date: string, resourceRef: string): Reservation[] {
  return list
    .filter((r) => r.resource_ref === resourceRef && r.status !== 'canceled' && r.start_date <= date && r.end_date >= date)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.start_date.localeCompare(b.start_date))
}

/** チップの表示（誰／現場） */
export function reservationChipLabel(r: Reservation): string {
  const who = r.worker_name ?? ''
  return r.site_name ? `${who} / ${r.site_name}` : (who || r.purpose || '予約')
}

export function reservationTimeLabel(r: Reservation): string {
  if (!r.start_time && !r.end_time) return ''
  const s = (r.start_time ?? '').slice(0, 5), e = (r.end_time ?? '').slice(0, 5)
  return e ? `${s}〜${e}` : s
}

/** 列見出しの「今の状況」: 使用中 > 予約あり > 空き（今日をまたぐ予約で判定） */
export function resourceStatusToday(list: Reservation[], resourceRef: string, today: string): 'in_use' | 'reserved' | 'free' {
  const todays = reservationsForCell(list, today, resourceRef)
  if (todays.some((r) => r.status === 'in_use')) return 'in_use'
  if (todays.some((r) => r.status === 'reserved')) return 'reserved'
  return 'free'
}

export const RESOURCE_STATUS_LABEL: Record<'in_use' | 'reserved' | 'free', string> = { in_use: '使用中', reserved: '予約あり', free: '空き' }

/** 予約が「自分のもの」か（本人＝使う人 or 作った人） */
export function isOwnReservation(r: Reservation, myWorkerId: string | null | undefined): boolean {
  return !!myWorkerId && (r.worker_id === myWorkerId || r.created_by_worker_id === myWorkerId)
}

/** 重なり警告の文（EF の conflicts をそのまま渡す） */
export function overlapMessage(conflicts: { worker_name?: string | null; start_date: string; end_date: string; resource_name?: string }[], blocked: boolean): string {
  const names = [...new Set(conflicts.map((c) => c.worker_name || '別の人'))].join('・')
  const head = `既に${names}が予約しています（${conflicts.map((c) => c.start_date === c.end_date ? c.start_date : `${c.start_date}〜${c.end_date}`).slice(0, 3).join('、')}）。`
  return blocked ? `${head}同じ時間帯には予約できません。` : `${head}このまま保存すると重なった予約になります（同乗・引き継ぎの場合はそのまま保存できます）。`
}

/**
 * 道具の「持出中 N日目」＝ JST暦日で持出当日を1日目とした通し日数（最小1）。
 *  ★ now(nowMs) と 持出時刻(sinceIso) を **両方とも同じ JST 暦日** に落としてから日数差を取る。
 *   片側だけ +9h すると経過時間が常に9h水増しされ、同じ暦日でも「2日目」と誤表示される
 *   （2026-09-22 /explore で発覚。旧実装は now だけ +9h していた）。
 */
export function toolDaysOut(sinceIso: string, nowMs: number): number {
  const jstMidnight = (ms: number) => { const d = new Date(ms + 9 * 3600 * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }
  const since = new Date(sinceIso).getTime()
  if (Number.isNaN(since)) return 1
  return Math.max(1, Math.floor((jstMidnight(nowMs) - jstMidnight(since)) / 86400000) + 1)
}
