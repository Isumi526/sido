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
import { foldPunches, punchKey, punchForRow, type Punch } from '~/composables/attendance-punch.gen'

export function usePunches() {
  // ★テーブル直読みをやめて EF 経由にした（2026-08-15）。anon キーだけで全テナントの
  //  打刻が読めていた穴を塞ぐため、attendance_logs への直アクセスは残さない。
  const attendance = useAttendanceLog()

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
      // ★前後1日ずつ広げて取る。夜勤の退勤（翌4:31）は翌日のログなので、その日だけを
      //  取ると夜勤の回が「出勤のみ」になる。前日の出勤も取らないと、当日早朝の退勤が
      //  対になる出勤の無い退勤としてその日に混ざる。
      punches.value = foldPunches(await attendance.forReport(shiftDate(from, -1), shiftDate(to, +1), workerId))
      loaded.value = true
    } catch (e) {
      // ★打刻が読めなくても日報の入力は続けられないといけない（表示の付加情報でしかない）
      console.error('[punches] 出退勤の取得に失敗:', e)
    }
  }

  /**
   * その日の打刻。無ければ null（＝打刻なし。0:00 のように見せない）。
   * ★2026-08-27 の出退勤モデル変更で現場では引かない（打刻が現場に紐づかなくなった）。
   * ★行の作業時刻（plannedStart/End）を渡すと、その行に近い「回」を選ぶ。
   *  昼勤＋夜勤のように1日に2回出退勤した日は、渡さないと両方の行に外枠が出て
   *  夜勤行に「出勤 −10時間30分」のような嘘のズレが付く（2026-09-11 辻さん）。
   */
  function punchFor(
    workerId: string | null | undefined, date: string,
    plannedStart?: string | null, plannedEnd?: string | null,
  ): Punch | null {
    if (!workerId) return null
    const day = punches.value[punchKey(workerId, date)] ?? null
    return punchForRow(day, plannedStart, plannedEnd)
  }

  return { punches, loaded, load, loadRange, punchFor }
}

/** YYYY-MM-DD を days 日ずらす（JST・日付だけの計算なのでUTCで足し引きしてよい） */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
