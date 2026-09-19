// ============================================================
//  shared/resource-core.ts  ★単一ソース（admin / liff 共有）
//  車両・道具・部屋などの予約（リソース予定B-1・2026-09-19）の純粋ロジック。
//  予定管理の「車両」「道具」タブ（日×対象のマトリクス）で admin と LIFF が同じ計算をする。
//  ここだけを編集し、`npm run sync:shared` で各アプリの resource-core.gen.ts を再生成すること。
//  ※ import を持たない自己完結ファイル。
// ============================================================

export type ResourceTypeKey = 'vehicle' | 'tool' | 'room'

export const RESOURCE_TYPE_LABEL: Record<ResourceTypeKey, string> = { vehicle: '車両', tool: '道具', room: '会議室' }
/** 種類 → 「使う機能」のキー */
export const RESOURCE_TYPE_FEATURE: Record<ResourceTypeKey, 'vehicles' | 'tools' | 'rooms'> = { vehicle: 'vehicles', tool: 'tools', room: 'rooms' }
/** 予定管理のタブに出す順（機能ONのものだけ出す） */
export const RESOURCE_TYPE_ORDER: ResourceTypeKey[] = ['vehicle', 'tool', 'room']

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
