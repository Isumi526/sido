// ⚠️ AUTO-GENERATED from shared/report-snapshot.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/report-snapshot.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/report-snapshot.ts — 日報1件を「人が読む行」に畳む（承認画面の変更前／変更後の全体表示・2026-09-20）
//
//  正本はここ。`npm run sync:shared` で admin（と将来 LIFF）に *.gen.ts として配布する。
//  設計書「日報の入力と承認画面 認識合わせ」R-2: 承認画面で変更前（daily_reports）と変更後（payload）の
//  日報全体を左右に並べ、変わった行をハイライトする。期限後提出は変更後だけを出す。
//
//  行は安定した key を持つ（site.0.worker.1 など）。前後で同じ key の値が違えば「変更」、
//  片方にしか無ければ「追加」「削除」。表示用の文字列で比べる＝人が見て違うところだけ光る。
// ============================================================

export type SnapshotRow = { key: string; group: string; label: string; value: string }
export type SnapshotDiff = 'same' | 'changed' | 'added' | 'removed'

const yen = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? `¥${n.toLocaleString()}` : ''
}
const str = (v: unknown): string => (v === null || v === undefined) ? '' : String(v).trim()
const files = (arr: unknown): string => Array.isArray(arr) && arr.length ? `（領収書${arr.length}枚）` : ''

/** 日報（daily_reports の行 or 保留 payload）→ 行の配列 */
export function reportToRows(rep: any): SnapshotRow[] {
  const rows: SnapshotRow[] = []
  const push = (key: string, group: string, label: string, value: string) => { if (value) rows.push({ key, group, label, value }) }
  if (!rep) return rows

  const working = rep.leave_type === 'paid_leave' || rep.leaveType === 'paid_leave' ? '有給'
    : (rep.is_working ?? rep.isWorking) ? '稼働' : '休み'
  push('working', '基本', '稼働区分', working)
  if (rep.is_business_trip ?? rep.isBusinessTrip) push('trip', '基本', '出張', 'あり')

  const sites = Array.isArray(rep.sites) ? rep.sites : []
  sites.forEach((site: any, si: number) => {
    const g = `現場${sites.length > 1 ? si + 1 : ''}`
    const name = str(site?.siteName) === '__other__' ? str(site?.customSiteName) : str(site?.siteName)
    push(`site.${si}.name`, g, '現場', name || '（未設定）')
    const contractor = str(site?.contractorName) === '__other__' ? str(site?.customContractorName) : str(site?.contractorName)
    push(`site.${si}.contractor`, g, '元請け', contractor)
    ;(Array.isArray(site?.workers) ? site.workers : []).forEach((w: any, wi: number) => {
      const t = w?.startTime || w?.endTime ? `${str(w?.startTime) || '—'}〜${str(w?.endTime) || '—'}` : ''
      const brk = w?.breakMinutes != null && w.breakMinutes !== '' ? ` 休憩${w.breakMinutes}分` : ''
      const role = w?.workerRole === 'factory' ? '（工場）' : ''
      push(`site.${si}.worker.${wi}`, g, `作業員 ${str(w?.workerName) || wi + 1}`, `${t}${brk}${role}`.trim() || '（時刻なし）')
    })
    ;(Array.isArray(site?.subcontractors) ? site.subcontractors : []).filter((s: any) => s?.subcontractorName).forEach((s: any, i: number) => {
      const n = s.subcontractorName === '__other__' ? (str(s.customSubcontractorName) || '新規業者') : str(s.subcontractorName)
      push(`site.${si}.sub.${i}`, g, '協力業者', `${n} ${s.count ?? 0}名`)
    })
    const e = site?.expenses ?? {}
    ;(Array.isArray(e.vehicles) ? e.vehicles : []).filter((v: any) => v?.vehicleName || v?.distanceKm || v?.dieselKm).forEach((v: any, vi: number) => {
      const parts = [str(v.vehicleName)]
      if (v.distanceKm) parts.push(`ガソリン${v.distanceKm}km`)
      if (v.dieselKm) parts.push(`軽油${v.dieselKm}km`)
      if (v.parkingYen) parts.push(`駐車${yen(v.parkingYen)}`)
      if (v.highwayYen) parts.push(`高速${yen(v.highwayYen)}`)
      push(`site.${si}.veh.${vi}`, g, '車両', parts.filter(Boolean).join(' '))
    })
    const line = (arr: unknown, label: string, k: string, extra?: (x: any) => string) => {
      ;(Array.isArray(arr) ? arr : []).filter((x: any) => x?.yen).forEach((x: any, i: number) => {
        push(`site.${si}.${k}.${i}`, g, label, `${str(x.label ?? x.payee)}${str(x.label ?? x.payee) ? ' ' : ''}${yen(x.yen)}${x.tategae ? '（立替）' : ''}${extra ? extra(x) : ''}${files(x.fileUrls)}`)
      })
    }
    line(e.parkings, '駐車代', 'parking')
    line(e.highways, '高速代', 'highway', (x) => x.etcCard ? ` ${x.etcCard}` : '')
    line(e.trains, '電車', 'train')
    line(e.hotels, '宿泊', 'hotel')
    line(e.others, 'その他', 'other', (x) => x.accountCategory ? ` [${x.accountCategory}]` : '')
    line(e.entertainments, '接待・会議', 'ent')
    // 旧スカラー（後方互換）
    if (e.hotelYen) push(`site.${si}.hotelYen`, g, '宿泊', `${str(e.hotelName)} ${yen(e.hotelYen)}`)
    if (e.leopalaceYen) push(`site.${si}.leoYen`, g, '宿泊', `${str(e.leopalaceName)} ${yen(e.leopalaceYen)}`)
    if (e.garbageFactoryM3 || e.garbageSiteM3) push(`site.${si}.garbage`, g, 'ゴミ', `工場${e.garbageFactoryM3 ?? 0}㎥ / 現場${e.garbageSiteM3 ?? 0}㎥${files(e.garbagePhotoUrls)}`)
    push(`site.${si}.note`, g, '現場の備考', str(site?.siteNote))
  })

  const gas = Array.isArray(rep.gasoline_items ?? rep.gasolineItems) ? (rep.gasoline_items ?? rep.gasolineItems) : []
  gas.filter((x: any) => x?.yen).forEach((x: any, i: number) => {
    push(`gas.${i}`, '本日のガソリン代', str(x.label ?? x.payee) || 'ガソリン', `${yen(x.yen)}${x.tategae ? '（立替）' : ''}${files(x.fileUrls)}`)
  })
  push('note', '備考', '備考', str(rep.note))
  return rows
}

export type BeforeAfterRow = { key: string; group: string; label: string; before: string; after: string; diff: SnapshotDiff }

/** 変更前／変更後の行を key で突き合わせ、差分種別を付ける（順序は「後」の並び→「前」だけの行） */
export function beforeAfterRows(before: any | null, after: any): BeforeAfterRow[] {
  const b = before ? reportToRows(before) : []
  const a = reportToRows(after)
  const bMap = new Map(b.map((r) => [r.key, r]))
  const aKeys = new Set(a.map((r) => r.key))
  const out: BeforeAfterRow[] = a.map((r) => {
    const prev = bMap.get(r.key)
    const diff: SnapshotDiff = !before ? 'same' : !prev ? 'added' : prev.value === r.value ? 'same' : 'changed'
    return { key: r.key, group: r.group, label: r.label, before: prev?.value ?? '', after: r.value, diff }
  })
  for (const r of b) if (!aKeys.has(r.key)) out.push({ key: r.key, group: r.group, label: r.label, before: r.value, after: '', diff: 'removed' })
  return out
}

export function changedCount(rows: BeforeAfterRow[]): number {
  return rows.filter((r) => r.diff !== 'same').length
}
