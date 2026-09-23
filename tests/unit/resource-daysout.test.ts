// Unit test for shared/resource-core.ts toolDaysOut （道具「持出中 N日目」の JST暦日カウント）
//  背景: 旧実装（supabase/functions/resource-reservations/index.ts 内インライン）は
//   now を +9h した一方 checkout(created_at) を +9h しなかったため、経過時間が常に9h水増しされ
//   同じ JST 暦日でも「2日目」と表示され得た（/explore 2026-09-22 で発見）。
//  実行: npx vite-node tests/unit/resource-daysout.test.ts
import { toolDaysOut } from '../../shared/resource-core'

let failed = 0
function eq(name: string, got: number, want: number) {
  if (got !== want) { console.error(`FAIL ${name}: got ${got}, want ${want}`); failed++ }
  else console.log(`ok   ${name} = ${got}`)
}
const jst = (ymd: string, hm: string) => Date.parse(`${ymd}T${hm}:00+09:00`)

// ① 旧実装がバグっていた核心ケース: checkout も now も同じ JST 暦日(9/20) → 1日目
//    旧式: floor(((now+9h) - checkout)/86400000)+1 = 2日目（誤）
eq('same JST day (02:00→20:00)', toolDaysOut('2026-09-19T17:00:00Z', jst('2026-09-20', '20:00')), 1)

// ② 当日ちょうど（checkout=now） → 1日目
eq('checkout == now', toolDaysOut('2026-09-20T00:00:00Z', Date.parse('2026-09-20T00:00:00Z')), 1)

// ③ 翌 JST 暦日 → 2日目（JST 9/20 23:00 持出 → 9/21 08:00 参照）
eq('next JST day (crosses midnight)', toolDaysOut(String(new Date(jst('2026-09-20', '23:00')).toISOString()), jst('2026-09-21', '08:00')), 2)

// ④ 3 暦日跨ぎ → 3日目
eq('two JST days later', toolDaysOut(String(new Date(jst('2026-09-20', '10:00')).toISOString()), jst('2026-09-22', '09:00')), 3)

// ⑤ JST 深夜帯（UTC では前日）でも暦日で判定される: 持出 9/20 08:00 JST、参照 9/20 00:30 JST(=前日UTC) は不整合入力だが最小1を保証
eq('floor at 1 minimum', toolDaysOut('2026-09-20T12:00:00Z', jst('2026-09-20', '09:00')), 1)

if (failed) { console.error(`\n${failed} assertion(s) failed`); process.exit(1) }
console.log('\nall passed')
