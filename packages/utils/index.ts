// ============================================================
//  packages/utils
//  全アプリ共通のユーティリティ関数
// ============================================================

import type { DailyReport, SiteReport } from '../types'

/**
 * 日報データをLINE通知用のテキストに変換する
 */
export function formatReportForLine(report: DailyReport): string {
  const dateLabel = formatDateJP(report.date)
  const lines: string[] = [
    `📋 ${dateLabel} の日報`,
    `👤 ${report.sender}`,
    '─────────────────',
  ]

  report.sites.forEach((site) => {
    lines.push(`\n📍 ${site.siteName}`)

    // 作業員
    if (site.workers.length > 0) {
      const workerStr = site.workers
        .map((w) => {
          let s = `${w.workerName} ${w.days}日`
          if (w.overtime > 0) s += ` 残業${w.overtime}h`
          return s
        })
        .join(' / ')
      lines.push(`  👷 ${workerStr}`)
    }

    // 経費
    const exp = site.expenses
    const expItems: string[] = []
    if (exp.distanceKm) expItems.push(`${exp.vehicle || ''}往復${exp.distanceKm}km`)
    if (exp.parkingYen) expItems.push(`駐車場¥${exp.parkingYen.toLocaleString()}`)
    if (exp.highwayYen) expItems.push(`高速¥${exp.highwayYen.toLocaleString()}`)
    if (exp.trainYen) expItems.push(`電車¥${exp.trainYen.toLocaleString()}`)
    if (exp.garbageFactoryYen) expItems.push(`ゴミ工場¥${exp.garbageFactoryYen.toLocaleString()}`)
    if (exp.garbageSiteYen) expItems.push(`ゴミ現場¥${exp.garbageSiteYen.toLocaleString()}`)
    if (exp.hotelYen) expItems.push(`ホテル¥${exp.hotelYen.toLocaleString()}`)
    if (exp.otherYen) expItems.push(`その他¥${exp.otherYen.toLocaleString()}`)
    if (expItems.length > 0) lines.push(`  💴 ${expItems.join(' / ')}`)

    // 下請け業者
    if (site.subcontractors.length > 0) {
      const subStr = site.subcontractors
        .map((s) => `${s.subcontractorName} ${s.count}人`)
        .join(' / ')
      lines.push(`  🏢 ${subStr}`)
    }
  })

  if (report.note) {
    lines.push(`\n📝 ${report.note}`)
  }

  return lines.join('\n')
}

/**
 * YYYY-MM-DD → M月D日（火）形式に変換
 */
export function formatDateJP(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekdays[date.getDay()]}）`
}

/**
 * 日報のDay番号を取得（スプシの列計算用）
 */
export function getDayNumber(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDate()
}
