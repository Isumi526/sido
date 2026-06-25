// ============================================================
//  utils/diffReport.ts
//  日報の新旧データを比較して差分テキスト行を返す
// ============================================================
import { gt } from '~/utils/i18n-global'

/** Supabase daily_reports 形式の旧データ */
interface OldReport {
  is_working: boolean
  leave_type?: string | null
  sites: any[]
  note?: string | null
}

/** LIFF フォーム形式の新データ */
interface NewReport {
  isWorking: boolean
  leaveType?: string | null
  sites: any[]
  note?: string
}

/** 稼働状態を3区分（稼働あり / 有給 / 休み）のラベルにする */
function workStatusLabel(isWorking: boolean, leaveType?: string | null): string {
  if (leaveType === 'paid_leave') return gt('diff.statusPaidLeave')
  return isWorking ? gt('diff.statusWorking') : gt('diff.statusOff')
}

/** 旧データと新データを比較して差分テキスト行を返す */
export function computeDiff(oldData: OldReport, newData: NewReport): string[] {
  const lines: string[] = []

  // ── 稼働状態（稼働あり / 有給 / 休み）──
  const oldStatus = workStatusLabel(oldData.is_working, oldData.leave_type)
  const newStatus = workStatusLabel(newData.isWorking, newData.leaveType)
  if (oldStatus !== newStatus) {
    lines.push(gt('diff.work', { from: oldStatus, to: newStatus }))
  }

  // ── 現場ごと ──
  const oldSites = oldData.sites ?? []
  const newSites = newData.sites ?? []
  const len = Math.max(oldSites.length, newSites.length)

  for (let i = 0; i < len; i++) {
    const o = oldSites[i]
    const n = newSites[i]
    const displayName = siteName(n) || siteName(o) || gt('diff.siteFallbackName', { n: i + 1 })
    const siteLines: string[] = []

    if (!o) {
      siteLines.push(gt('diff.siteAdded'))
    } else if (!n) {
      siteLines.push(gt('diff.siteRemoved'))
    } else {
      // 現場名
      const oName = siteName(o)
      const nName = siteName(n)
      if (oName !== nName) siteLines.push(gt('diff.siteName', { from: oName, to: nName }))

      // 元請け業者
      const oContractor = contractorName(o)
      const nContractor = contractorName(n)
      if (oContractor !== nContractor) {
        siteLines.push(gt('diff.contractor', { from: oContractor || gt('diff.none'), to: nContractor || gt('diff.none') }))
      }

      // 時刻
      const ow = o.workers?.[0]
      const nw = n.workers?.[0]
      if (ow && nw && (ow.startTime !== nw.startTime || ow.endTime !== nw.endTime)) {
        siteLines.push(gt('diff.time', { from: `${ow.startTime}〜${ow.endTime}`, to: `${nw.startTime}〜${nw.endTime}` }))
      }

      // 経費
      pushExpenseDiffs(siteLines, o.expenses ?? {}, n.expenses ?? {})

      // 下請け業者
      const oSubs = subSummary(o.subcontractors)
      const nSubs = subSummary(n.subcontractors)
      if (oSubs !== nSubs) {
        siteLines.push(gt('diff.subcontractors', { from: oSubs || gt('diff.none'), to: nSubs || gt('diff.none') }))
      }
    }

    if (siteLines.length > 0) {
      lines.push(gt('diff.siteHeader', { name: displayName }))
      lines.push(...siteLines)
    }
  }

  // ── 備考 ──
  const oNote = oldData.note ?? ''
  const nNote = newData.note ?? ''
  if (oNote !== nNote) {
    if (!oNote)       lines.push(gt('diff.noteAdded', { to: nNote }))
    else if (!nNote)  lines.push(gt('diff.noteRemoved'))
    else              lines.push(gt('diff.noteChanged', { from: oNote, to: nNote }))
  }

  return lines
}

// ── 内部ユーティリティ ──────────────────────────────────────

function siteName(site: any): string {
  if (!site) return ''
  return site.siteName === '__other__' ? (site.customSiteName || gt('diff.newSiteName')) : (site.siteName || '')
}

function contractorName(site: any): string {
  if (!site) return ''
  return site.contractorName === '__other__' ? (site.customContractorName || gt('diff.newContractorName')) : (site.contractorName || '')
}

function subSummary(subs: any[]): string {
  return (subs ?? [])
    .filter((s: any) => s.subcontractorName)
    .map((s: any) => gt('diff.subSummary', { name: s.subcontractorName, count: s.count }))
    .join('、')
}

function pushExpenseDiffs(lines: string[], o: any, n: any): void {
  // 車両
  const oVeh = vehSummary(o)
  const nVeh = vehSummary(n)
  if (oVeh !== nVeh) {
    lines.push(gt('diff.vehicle', { from: oVeh || gt('diff.none'), to: nVeh || gt('diff.none') }))
  }

  // 電車
  const oTrain = listSummary(o.trains, (t: any) => t.yen ? gt('diff.labeledYen', { label: t.label || gt('diff.trainLabel'), amount: Number(t.yen).toLocaleString() }) : '')
  const nTrain = listSummary(n.trains, (t: any) => t.yen ? gt('diff.labeledYen', { label: t.label || gt('diff.trainLabel'), amount: Number(t.yen).toLocaleString() }) : '')
  if (oTrain !== nTrain) lines.push(gt('diff.train', { from: oTrain || gt('diff.none'), to: nTrain || gt('diff.none') }))

  // 宿泊費（新形式 hotels[] 合計、無ければ旧スカラー hotel+leopalace ＝二重計上を防ぐ後方互換）
  const hotelTotal = (e: any) => {
    const s = (e.hotels || []).reduce((a: number, h: any) => a + (Number(h.yen) || 0), 0)
    return s > 0 ? s : (e.hotelYen || 0) + (e.leopalaceYen || 0)
  }
  diffYen(lines, gt('diff.labelHotel'), hotelTotal(o), hotelTotal(n))

  // ゴミ
  const oGarb = garbSummary(o)
  const nGarb = garbSummary(n)
  if (oGarb !== nGarb) lines.push(gt('diff.garbage', { from: oGarb || gt('diff.none'), to: nGarb || gt('diff.none') }))

  // その他資材
  const oOther = listSummary(o.others, (t: any) => t.yen ? gt('diff.labeledYen', { label: t.label || '', amount: Number(t.yen).toLocaleString() }) : '')
  const nOther = listSummary(n.others, (t: any) => t.yen ? gt('diff.labeledYen', { label: t.label || '', amount: Number(t.yen).toLocaleString() }) : '')
  if (oOther !== nOther) lines.push(gt('diff.other', { from: oOther || gt('diff.none'), to: nOther || gt('diff.none') }))

  // 雑経費（新=entertainments配列 / 旧=スカラー）
  const entSummary = (x: any) => (x.entertainments?.some((e: any) => e.yen)
    ? listSummary(x.entertainments, (t: any) => t.yen ? gt('diff.labeledYen', { label: t.label || '', amount: Number(t.yen).toLocaleString() }) : '')
    : (x.entertainmentYen ? gt('diff.labeledYen', { label: x.entertainmentLabel || '', amount: Number(x.entertainmentYen).toLocaleString() }) : ''))
  const oEnt = entSummary(o), nEnt = entSummary(n)
  if (oEnt !== nEnt) lines.push(gt('diff.entertainment', { from: oEnt || gt('diff.none'), to: nEnt || gt('diff.none') }))
}

function vehSummary(exp: any): string {
  if (exp.carpool) return gt('diff.carpool')
  const vehs = (exp.vehicles ?? []).filter((v: any) => v.vehicleName || v.distanceKm || v.parkingYen || v.highwayYen)
  if (!vehs.length) return ''
  return vehs.map((v: any) => {
    const p: string[] = []
    if (v.vehicleName) p.push(v.vehicleName)
    if (v.distanceKm)  p.push(gt('diff.vehDistance', { km: v.distanceKm }))
    if (v.dieselKm)    p.push(gt('diff.vehDiesel', { km: v.dieselKm }))
    if (v.parkingYen)  p.push(gt('diff.vehParking', { amount: Number(v.parkingYen).toLocaleString() }))
    if (v.highwayYen)  p.push(gt('diff.vehHighway', { amount: Number(v.highwayYen).toLocaleString() }))
    if (v.etcCard)     p.push(v.etcCard)
    return p.join(' ')
  }).join(' / ')
}

function listSummary(arr: any[], fmt: (item: any) => string): string {
  return (arr ?? []).map(fmt).filter(Boolean).join(' / ')
}

function garbSummary(exp: any): string {
  const p: string[] = []
  if (exp.garbageFactoryM3) p.push(gt('diff.garbWood', { m3: exp.garbageFactoryM3 }))
  if (exp.garbageSiteM3)    p.push(gt('diff.garbMixed', { m3: exp.garbageSiteM3 }))
  return p.join(' ')
}

function diffYen(lines: string[], label: string, oldYen: number | undefined, newYen: number | undefined): void {
  if ((oldYen ?? 0) === (newYen ?? 0)) return
  if (!oldYen && newYen)        lines.push(gt('diff.yenAdded', { label, amount: Number(newYen).toLocaleString() }))
  else if (oldYen && !newYen)   lines.push(gt('diff.yenRemoved', { label }))
  else                           lines.push(gt('diff.yenChanged', { label, from: Number(oldYen).toLocaleString(), to: Number(newYen).toLocaleString() }))
}
