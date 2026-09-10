// ============================================================
//  relinkTarget.ts
//  「現場未設定の日報を紐付け」の対象判定を1か所に置く。
//
//  ★なぜ共有するか（2026-09-10）
//   判定は relink画面 と サイドナビのバッジ の2か所にあり、片方だけ直すと
//   「バッジは1件と言うのに開くと空」というズレが起きる。同じ関数を使う。
//
//  ★「稼働なし」を外す理由（尾崎さんの指摘・2026-09-10）
//   日報フォームで現場を選びかけてから「稼働なし」に変えて保存すると、
//   sites[] に siteName='__unset__' の入れ物だけが残る。集計は is_working で
//   弾く（worker-reports.vue が !is_working で continue）ので実害は無いが、
//   この画面にだけ出続けて「稼働なしのはずの日報を紐付けろ」と見えていた。
//   実測では本番sidoで1件（佐谷さん 2026-08-26）。
//
//  ★ただし休みの日でも経費は現場に紐づく（駐車代・高速代など）。
//   金額が入っている入れ物まで隠すと紐付ける先を失うので、それは残す。
// ============================================================

/**
 * この現場の入れ物に「金額の入った経費」があるか。
 * ★日報フォームは未入力でも空の要素を1つ置くため、配列が空でないことは
 *  「経費がある」を意味しない。必ず金額(yen>0)で見る。
 */
export function hasExpenseAmount(site: any): boolean {
  const e = site?.expenses ?? {}
  const anyYen = (a: any) => (a ?? []).some((x: any) => Number(x?.yen) > 0)
  if (anyYen(e.parkings) || anyYen(e.highways) || anyYen(e.trains) || anyYen(e.hotels) || anyYen(e.others) || anyYen(e.entertainments)) return true
  for (const v of (e.vehicles ?? [])) {
    if (Number(v?.distanceKm) > 0 || Number(v?.dieselKm) > 0 || Number(v?.parkingYen) > 0 || Number(v?.highwayYen) > 0) return true
  }
  return Number(e.hotelYen) > 0 || Number(e.leopalaceYen) > 0 || Number(e.entertainmentYen) > 0
}

/** この sites[] の1要素が「紐付けが要る現場未設定」か。isWorking は日報の is_working。 */
export function isRelinkTarget(site: any, isWorking: unknown): boolean {
  if (site?.siteName !== '__unset__') return false
  if (isWorking === false && !hasExpenseAmount(site)) return false
  return true
}
