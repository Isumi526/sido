// ============================================================
//  _shared/notify.ts
//  日報 LINE 通知メッセージ生成
// ============================================================

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function sanitize(s: string): string {
  return String(s || '').replace(/[^A-Za-z0-9\-]/g, '_').slice(0, 40)
}

export function buildReportMessage(body: {
  sender: string
  date: string
  sites: any[]
  note?: string
}, liffUrl: string, accountSlug: string): string {
  const { sender, date, sites, note } = body
  const d = new Date(date + 'T00:00:00')
  const dateLabel = `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`

  const lines: string[] = [
    `📋 ${dateLabel} 日報（敬称略）`,
    `👤 ${sender}`,
    '──────────',
  ]

  for (const site of sites) {
    if (!site.siteName) continue
    lines.push('')
    lines.push(`📍 ${site.siteName}`)

    // 作業員
    const workers = (site.workers || []).filter((w: any) => w.workerName)
    for (const w of workers) {
      const parts: string[] = []
      if (w.hoursNormal)        parts.push(`${w.hoursNormal}h`)
      if (w.hoursSunday)        parts.push(`休日${w.hoursSunday}h`)
      if (w.hoursOT)            parts.push(`残業${w.hoursOT}h`)
      if (w.hoursNight)         parts.push(`深夜${w.hoursNight}h`)
      if (w.hoursOTNight)       parts.push(`深夜残業${w.hoursOTNight}h`)
      if (w.hoursSundayOT)      parts.push(`休日残業${w.hoursSundayOT}h`)
      if (w.hoursSundayNight)   parts.push(`休日深夜${w.hoursSundayNight}h`)
      if (w.hoursSundayOTNight) parts.push(`休日深夜残業${w.hoursSundayOTNight}h`)
      if (parts.length === 0 && w.days != null) parts.push(`${w.days}日`)
      if (parts.length) lines.push(`・${w.workerName} ${parts.join(' + ')}`)
    }

    // 経費
    const exp = site.expenses || {}
    const expLines: string[] = []

    if (exp.carpool) {
      expLines.push('乗合い')
    } else {
      for (const v of (exp.vehicles || [])) {
        if (!v) continue
        const vp: string[] = []
        if (v.vehicleName) vp.push(v.vehicleName)
        if (v.distanceKm)  vp.push(`往復${v.distanceKm}km`)
        if (v.dieselKm)    vp.push(`軽油${v.dieselKm}km`)
        if (v.parkingYen)  vp.push(`駐車¥${Number(v.parkingYen).toLocaleString()}`)
        if (v.highwayYen)  vp.push(`高速¥${Number(v.highwayYen).toLocaleString()}`)
        if (v.etcUsed)     vp.push(`ETC${v.etcCard || ''}`)
        if (vp.length)     expLines.push(vp.join(' '))
      }
    }
    for (const t of (exp.trains || [])) {
      if (t?.yen) expLines.push(`${t.label || '電車'} ¥${Number(t.yen).toLocaleString()}`)
    }
    for (const o of (exp.others || [])) {
      if (o?.yen) expLines.push(`${o.label || 'その他'} ¥${Number(o.yen).toLocaleString()}`)
    }
    if (exp.hotelYen)          expLines.push(`${exp.hotelName || 'ホテル'} ¥${Number(exp.hotelYen).toLocaleString()}`)
    if (exp.leopalaceYen)      expLines.push(`${exp.leopalaceName || 'レオパレス'} ¥${Number(exp.leopalaceYen).toLocaleString()}`)
    if (exp.entertainmentYen)  expLines.push(`${exp.entertainmentLabel || '雑経費'} ¥${Number(exp.entertainmentYen).toLocaleString()}`)
    if (exp.garbageFactoryM3 || exp.garbageSiteM3) {
      const g: string[] = []
      if (exp.garbageFactoryM3) g.push(`木材のみ ${exp.garbageFactoryM3}m³`)
      if (exp.garbageSiteM3)    g.push(`混載 ${exp.garbageSiteM3}m³`)
      expLines.push(`ゴミ ${g.join(' ')}`)
    }
    for (const el of expLines) lines.push(`・${el}`)

    // 領収書フォルダ URL
    const urlKeys = ['vehicleUrls','trainUrls','hotelUrls','leopalaceUrls','otherUrls','entertainmentUrls','garbagePhotoUrls']
    const hasFiles = urlKeys.some(k => exp[k]?.length > 0)
    if (hasFiles && liffUrl) {
      const day    = parseInt(date.split('-')[2], 10)
      const period = day <= 15 ? 'first' : 'second'
      const ym     = date.slice(0, 7)
      const folder = [accountSlug, ym, period, `${date}_${sanitize(sender)}_${sanitize(site.siteName)}`].join('/')
      lines.push(`📁 領収書: ${liffUrl}/files?path=${encodeURIComponent(folder)}`)
    }

    // 下請け業者
    const subs = (site.subcontractors || []).filter((s: any) => s.subcontractorName)
    for (const s of subs) lines.push(`・${s.subcontractorName} ${s.count}人`)

    // 現場備考
    if (site.siteNote) lines.push(`📝 ${site.siteNote}`)
  }

  if (note) lines.push(`\n📝 ${note}`)
  return lines.join('\n')
}

export function buildEditMessage(body: {
  sender: string
  date: string
  editedAt: string
  diffs: string[]
}): string {
  const { sender, date, editedAt, diffs } = body
  const d = new Date(date + 'T00:00:00')
  const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`

  return [
    '✏️ 日報を修正しました',
    `📅 ${dateLabel}`,
    `👤 ${sender}`,
    `🕐 ${editedAt} 更新`,
    '──────────',
    ...diffs,
  ].join('\n')
}

export function buildErrorMessage(body: {
  sender: string
  date?: string
  actionName?: string
  error: string
}): string {
  const { sender, date, actionName, error } = body
  let datePart = ''
  if (date) {
    const d = new Date(date + 'T00:00:00')
    datePart = `\n📅 ${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`
  }
  return [
    '🚨 日報エラー通知',
    `👤 ${sender}${datePart}`,
    `操作: ${actionName || '操作'}`,
    '──────────',
    error,
  ].join('\n')
}
