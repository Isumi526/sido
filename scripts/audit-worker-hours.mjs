// ============================================================
//  scripts/audit-worker-hours.mjs  （読み取り専用・#7c72d5d9）
//  日報の各作業員セグメントで「勤務スパン vs 実効稼働(休憩控除後)」の乖離を洗い出す。
//  ★金額ロジックは一切変更しない。診断のみ。shared/worker-hours.ts の休憩窓ロジックを複製。
//  usage: node scripts/audit-worker-hours.mjs "<DB_URL>" [sinceYYYY-MM-DD]
// ============================================================
import { execFileSync } from 'node:child_process'

const DB = process.argv[2]
const SINCE = process.argv[3] || '2000-01-01'
if (!DB) { console.error('DB URL required'); process.exit(1) }

const parseMin = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return null
  return (+m[1]) * 60 + (+m[2])
}
// shared/worker-hours.ts getBreakWindows を複製（固定時刻・勤務帯内のみ）
function breakWindows(role, startMin, endMin) {
  const wins = []
  const add = (hour, dur) => { let bt = hour * 60; if (bt <= startMin) bt += 1440; if (startMin < bt && bt < endMin) wins.push([bt, bt + dur]) }
  const night = startMin >= 18 * 60
  if (!night) { const s = role === 'factory' ? 15 : 30; add(10, s); add(12, 60); add(15, s) }
  else { add(22, 30); add(1, 30); add(3, 30) }
  return wins
}
// 実効休憩分（勤務帯に重なる分のみ）。snapshot(breaks[])があればそれ、無ければ固定窓。
function effBreakMin(w, startMin, endMin) {
  if (w.breakSnapshot && Array.isArray(w.breaks) && w.breaks.length) {
    let sum = 0
    for (const b of w.breaks) {
      const mins = Math.max(0, Math.round(Number(b?.minutes) || 0)); if (mins <= 0 || !b?.start) continue
      let bs = parseMin(b.start); if (bs == null) continue; if (bs < startMin) bs += 1440
      const s = Math.max(bs, startMin), e = Math.min(bs + mins, endMin); if (e > s) sum += e - s
    }
    return sum
  }
  const role = w.workerRole === 'factory' ? 'factory' : 'site'
  return breakWindows(role, startMin, endMin).reduce((a, [s, e]) => a + (e - s), 0)
}

const sql = `select date, user_id, sites from daily_reports where sites is not null and date >= '${SINCE}' limit 20000`
const raw = execFileSync('psql', [DB, '-tAc', sql], { maxBuffer: 1 << 28 }).toString()

let segs = 0, zero = 0, big = 0
const zeroEx = [], bigEx = []
for (const line of raw.split('\n')) {
  if (!line.trim()) continue
  const tab = line.split('|'); const date = tab[0]; const sitesJson = tab.slice(2).join('|')
  let sites; try { sites = JSON.parse(sitesJson) } catch { continue }
  for (const site of (Array.isArray(sites) ? sites : [])) {
    for (const w of (site?.workers ?? [])) {
      if (!w?.workerName) continue
      const sm = parseMin(w.startTime || '08:00'); let em = parseMin(w.endTime || '17:30')
      if (sm == null || em == null) continue
      if (em <= sm) em += 1440
      const span = em - sm; if (span <= 0) continue
      const brk = effBreakMin(w, sm, em)
      const worked = Math.max(0, span - brk)
      segs++
      const spanH = (span / 60).toFixed(2), workedH = (worked / 60).toFixed(2)
      if (worked <= 0) { zero++; if (zeroEx.length < 8) zeroEx.push(`${date} ${site.siteName ?? '?'} ${w.workerName} ${w.startTime}-${w.endTime} span${spanH}h→0h brk${brk}分`) }
      else if (span >= 120 && worked / span < 0.45) { big++; if (bigEx.length < 8) bigEx.push(`${date} ${site.siteName ?? '?'} ${w.workerName} ${w.startTime}-${w.endTime} span${spanH}h→${workedH}h brk${brk}分`) }
    }
  }
}
console.log(`=== worker-hours 監査 (since ${SINCE}) ===`)
console.log(`総セグメント: ${segs} / 0h化: ${zero} / 過小(span>=2h かつ worked<45%): ${big}`)
console.log('--- 0h化の例 ---'); zeroEx.forEach(e => console.log('  ' + e))
console.log('--- 過小の例 ---'); bigEx.forEach(e => console.log('  ' + e))
