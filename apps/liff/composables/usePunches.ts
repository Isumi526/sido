// ============================================================
//  usePunches.ts — その日の実打刻（出退勤ログ）を日報画面に出すために読む
//
//  出所（2026-08-10 大塚さんとの電話）:
//   「（出退勤の画面と日報の画面が）別じゃなくて一緒でいい。日報一〔画面〕で。
//     その中に実際打った打刻時間と、管理者が〔決めた〕8時半〜6時っていうのと…
//     それが出てくればそれでいいじゃないの？」
//
//  ★表示専用。人件費は従来どおり日報の作業時刻だけで計算する（管理者が決めた時間がマスタ）。
//   ここで読んだ打刻を form に書き戻さないこと。書き戻した瞬間に給与の根拠が入れ替わる。
//
//  ★現場名で突き合わせる。daily_reports.sites は siteName しか持たないため
//   （site_id は権威キーとして別に持つが、打刻側は sites(name) を引いて名前で照合する）。
//   自由入力の新規現場（__other__）はマスタに無いので打刻とは紐づかない＝出ない。
// ============================================================
import { foldPunches, jstRangeToUtc, punchKey, type Punch } from '~/composables/attendance-punch.gen'

export function usePunches() {
  const supabase = useSupabase()

  // key = `${workerId}|${date}|${siteName}`
  const punches = ref<Record<string, Punch>>({})
  const loaded = ref(false)

  /** 指定作業員の、指定日（JST）の打刻を読む */
  async function load(workerId: string | null | undefined, date: string): Promise<void> {
    return loadRange(workerId, date, date)
  }

  /** 指定作業員の、期間（JST）の打刻を読む。履歴一覧のようにまとめて要る時用 */
  async function loadRange(workerId: string | null | undefined, from: string, to: string): Promise<void> {
    punches.value = {}
    loaded.value = false
    const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
    if (!workerId || !ok(from) || !ok(to)) return
    try {
      const { lo, hi } = jstRangeToUtc(from, to)
      const { data } = await supabase
        .from('attendance_logs')
        .select('worker_id, type, checked_at, sites(name)')
        .eq('worker_id', workerId)
        .gte('checked_at', lo)
        .lte('checked_at', hi)
        .order('checked_at', { ascending: true })
        .limit(5000)   // 1ヶ月×出退勤で既定1000を超えて欠落するのを防ぐ（admin側と同じ余裕）
      punches.value = foldPunches((data ?? []).map((r: any) => ({
        worker_id: r.worker_id, type: r.type, checked_at: r.checked_at,
        siteName: r.sites?.name ?? null,
      })))
      loaded.value = true
    } catch (e) {
      // ★打刻が読めなくても日報の入力は続けられないといけない（表示の付加情報でしかない）
      console.error('[punches] 出退勤の取得に失敗:', e)
    }
  }

  /** その現場の打刻。無ければ null（＝打刻なし。0:00 のように見せない） */
  function punchFor(workerId: string | null | undefined, date: string, siteName: string | null | undefined): Punch | null {
    if (!workerId || !siteName) return null
    return punches.value[punchKey(workerId, date, siteName)] ?? null
  }

  return { punches, loaded, load, loadRange, punchFor }
}
