// ============================================================
//  utils/diffReport.ts
//  日報の新旧データを比較して差分テキスト行を返す
// ============================================================

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
  if (leaveType === 'paid_leave') return '有給'
  return isWorking ? '稼働あり' : '休み'
}

/** 旧データと新データを比較して差分テキスト行を返す */
export function computeDiff(oldData: OldReport, newData: NewReport): string[] {
  const lines: string[] = []

  // ── 稼働状態（稼働あり / 有給 / 休み）──
  const oldStatus = workStatusLabel(oldData.is_working, oldData.leave_type)
  const newStatus = workStatusLabel(newData.isWorking, newData.leaveType)
  if (oldStatus !== newStatus) {
    lines.push(`▸ 稼働: ${oldStatus} → ${newStatus}`)
  }

  // ── 現場ごと ──
  const oldSites = oldData.sites ?? []
  const newSites = newData.sites ?? []
  const len = Math.max(oldSites.length, newSites.length)

  for (let i = 0; i < len; i++) {
    const o = oldSites[i]
    const n = newSites[i]
    const displayName = siteName(n) || siteName(o) || `現場${i + 1}`
    const siteLines: string[] = []

    if (!o) {
      siteLines.push('  ▸ 現場を追加')
    } else if (!n) {
      siteLines.push('  ▸ 現場を削除')
    } else {
      // 現場名
      const oName = siteName(o)
      const nName = siteName(n)
      if (oName !== nName) siteLines.push(`  ▸ 現場名: ${oName} → ${nName}`)

      // 元請け業者
      const oContractor = contractorName(o)
      const nContractor = contractorName(n)
      if (oContractor !== nContractor) {
        siteLines.push(`  ▸ 元請け: ${oContractor || 'なし'} → ${nContractor || 'なし'}`)
      }

      // 時刻
      const ow = o.workers?.[0]
      const nw = n.workers?.[0]
      if (ow && nw && (ow.startTime !== nw.startTime || ow.endTime !== nw.endTime)) {
        siteLines.push(`  ▸ 時間: ${ow.startTime}〜${ow.endTime} → ${nw.startTime}〜${nw.endTime}`)
      }

      // 経費
      pushExpenseDiffs(siteLines, o.expenses ?? {}, n.expenses ?? {})

      // 下請け業者
      const oSubs = subSummary(o.subcontractors)
      const nSubs = subSummary(n.subcontractors)
      if (oSubs !== nSubs) {
        siteLines.push(`  ▸ 業者: ${oSubs || 'なし'} → ${nSubs || 'なし'}`)
      }
    }

    if (siteLines.length > 0) {
      lines.push(`📍 ${displayName}`)
      lines.push(...siteLines)
    }
  }

  // ── 備考 ──
  const oNote = oldData.note ?? ''
  const nNote = newData.note ?? ''
  if (oNote !== nNote) {
    if (!oNote)       lines.push(`▸ 備考を追加: 「${nNote}」`)
    else if (!nNote)  lines.push(`▸ 備考を削除`)
    else              lines.push(`▸ 備考: 「${oNote}」→「${nNote}」`)
  }

  return lines
}

// ── 内部ユーティリティ ──────────────────────────────────────

function siteName(site: any): string {
  if (!site) return ''
  return site.siteName === '__other__' ? (site.customSiteName || '新規現場') : (site.siteName || '')
}

function contractorName(site: any): string {
  if (!site) return ''
  return site.contractorName === '__other__' ? (site.customContractorName || '新規元請け') : (site.contractorName || '')
}

function subSummary(subs: any[]): string {
  return (subs ?? [])
    .filter((s: any) => s.subcontractorName)
    .map((s: any) => `${s.subcontractorName}${s.count}人`)
    .join('、')
}

function pushExpenseDiffs(lines: string[], o: any, n: any): void {
  // 車両
  const oVeh = vehSummary(o)
  const nVeh = vehSummary(n)
  if (oVeh !== nVeh) {
    lines.push(`  ▸ 車両: ${oVeh || 'なし'} → ${nVeh || 'なし'}`)
  }

  // 電車
  const oTrain = listSummary(o.trains, (t: any) => t.yen ? `${t.label || '電車'}¥${Number(t.yen).toLocaleString()}` : '')
  const nTrain = listSummary(n.trains, (t: any) => t.yen ? `${t.label || '電車'}¥${Number(t.yen).toLocaleString()}` : '')
  if (oTrain !== nTrain) lines.push(`  ▸ 電車: ${oTrain || 'なし'} → ${nTrain || 'なし'}`)

  // ホテル
  diffYen(lines, 'ホテル', o.hotelYen, n.hotelYen)

  // レオパレス
  diffYen(lines, 'レオパレス', o.leopalaceYen, n.leopalaceYen)

  // ゴミ
  const oGarb = garbSummary(o)
  const nGarb = garbSummary(n)
  if (oGarb !== nGarb) lines.push(`  ▸ ゴミ: ${oGarb || 'なし'} → ${nGarb || 'なし'}`)

  // その他資材
  const oOther = listSummary(o.others, (t: any) => t.yen ? `${t.label || ''}¥${Number(t.yen).toLocaleString()}` : '')
  const nOther = listSummary(n.others, (t: any) => t.yen ? `${t.label || ''}¥${Number(t.yen).toLocaleString()}` : '')
  if (oOther !== nOther) lines.push(`  ▸ その他: ${oOther || 'なし'} → ${nOther || 'なし'}`)

  // 雑経費（新=entertainments配列 / 旧=スカラー）
  const entSummary = (x: any) => (x.entertainments?.some((e: any) => e.yen)
    ? listSummary(x.entertainments, (t: any) => t.yen ? `${t.label || ''}¥${Number(t.yen).toLocaleString()}` : '')
    : (x.entertainmentYen ? `${x.entertainmentLabel || ''}¥${Number(x.entertainmentYen).toLocaleString()}` : ''))
  const oEnt = entSummary(o), nEnt = entSummary(n)
  if (oEnt !== nEnt) lines.push(`  ▸ 雑経費: ${oEnt || 'なし'} → ${nEnt || 'なし'}`)
}

function vehSummary(exp: any): string {
  if (exp.carpool) return '乗合い'
  const vehs = (exp.vehicles ?? []).filter((v: any) => v.vehicleName || v.distanceKm || v.parkingYen || v.highwayYen)
  if (!vehs.length) return ''
  return vehs.map((v: any) => {
    const p: string[] = []
    if (v.vehicleName) p.push(v.vehicleName)
    if (v.distanceKm)  p.push(`${v.distanceKm}km`)
    if (v.dieselKm)    p.push(`軽油${v.dieselKm}km`)
    if (v.parkingYen)  p.push(`駐車¥${Number(v.parkingYen).toLocaleString()}`)
    if (v.highwayYen)  p.push(`高速¥${Number(v.highwayYen).toLocaleString()}`)
    if (v.etcCard)     p.push(v.etcCard)
    return p.join(' ')
  }).join(' / ')
}

function listSummary(arr: any[], fmt: (item: any) => string): string {
  return (arr ?? []).map(fmt).filter(Boolean).join(' / ')
}

function garbSummary(exp: any): string {
  const p: string[] = []
  if (exp.garbageFactoryM3) p.push(`木材${exp.garbageFactoryM3}m³`)
  if (exp.garbageSiteM3)    p.push(`混載${exp.garbageSiteM3}m³`)
  return p.join(' ')
}

function diffYen(lines: string[], label: string, oldYen: number | undefined, newYen: number | undefined): void {
  if ((oldYen ?? 0) === (newYen ?? 0)) return
  if (!oldYen && newYen)        lines.push(`  ▸ ${label}: ¥${Number(newYen).toLocaleString()} を追加`)
  else if (oldYen && !newYen)   lines.push(`  ▸ ${label}: 削除`)
  else                           lines.push(`  ▸ ${label}: ¥${Number(oldYen).toLocaleString()} → ¥${Number(newYen).toLocaleString()}`)
}
