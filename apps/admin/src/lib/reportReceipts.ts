// 日報（daily_reports 形式 / 保留 payload も同じ形）から領収書URLを集める。
//
// 用途は「編集の承認画面で、変更された経費の領収書を見て妥当か判断する」こと。
// 日報詳細(reports.vue)は経費の種類ごとにテンプレートへ直接書いているが、
// 承認画面が要るのは「どこに何枚あるか」ではなく「新旧で何が増えた/消えたか」なので、
// ラベル付きの平坦なリストに集約する。
//
// ★領収書の持ち方は歴史的に2系統ある（どちらも現役データ）:
//   - 明細ごと: hotels[]/others[]/entertainments[]/gasoline_items[] の fileUrls
//   - 現場ごと: vehicleUrls / trainUrls / hotelUrls / leopalaceUrls / otherUrls /
//               entertainmentUrls / garbagePhotoUrls（旧スカラー時代の名残）
// どちらか片方だけ見ると領収書を取りこぼすので両方拾う。

export type Receipt = {
  url: string
  /** どの経費の領収書か（現場名＋科目）。承認者が金額と突き合わせるための手がかり */
  label: string
}

/** 現場ごとにぶら下がるURL配列のキー → 表示名 */
const SITE_LEVEL_KEYS: Array<[string, string]> = [
  ['vehicleUrls', '車両'],
  ['trainUrls', '電車'],
  ['hotelUrls', '宿泊'],
  ['leopalaceUrls', 'レオパレス'],
  ['otherUrls', 'その他'],
  ['entertainmentUrls', '雑経費'],
  ['garbagePhotoUrls', 'ゴミ写真'],
]

/** 明細配列のキー → 表示名。★ここに無いキーも拾う（下の collectReceipts 参照）。
 *  この表は「日本語で何と出すか」を決めるためだけのもので、拾う対象を絞るものではない。 */
const ITEM_LABELS: Record<string, string> = {
  hotels: '宿泊',
  others: 'その他',
  entertainments: '雑経費',
  parkings: '駐車場',
  highways: '高速',
  trains: '電車',
  vehicles: '車両',
  garbagePhotos: 'ゴミ写真',
}

function push(out: Receipt[], urls: unknown, label: string) {
  if (!Array.isArray(urls)) return
  for (const u of urls) {
    if (typeof u === 'string' && u) out.push({ url: u, label })
  }
}

/** 日報1件ぶんの領収書を、現場・科目のラベル付きで平坦に集める */
export function collectReceipts(report: any): Receipt[] {
  const out: Receipt[] = []
  const sites = Array.isArray(report?.sites) ? report.sites : []

  sites.forEach((site: any, si: number) => {
    const siteName = site?.siteName === '__other__'
      ? (site?.customSiteName || '新規現場')
      : (site?.siteName || `現場${si + 1}`)
    const exp = site?.expenses ?? {}

    for (const [key, name] of SITE_LEVEL_KEYS) push(out, exp[key], `${siteName}／${name}`)

    // ★キーを決め打ちで列挙しない。経費のカテゴリは増えるし、実際に取りこぼしていた。
    //  本番で「領収書: 0枚 → 1枚」と出ているのに現物が出せない状態だった
    //  （駐車場 parkings に付いた領収書。列挙リストに parkings が無かった・2026-08-17）。
    //  枚数を数える receiptCount は全キーを走査しており、こちらだけ3キーに絞っていたのが原因。
    //  ★取りこぼす＝承認者が中身を見ないまま金額を確定させることになる。安全側に倒し、fileUrls を持つ配列は全部拾う。
    for (const [key, val] of Object.entries(exp)) {
      if (!Array.isArray(val)) continue
      if (SITE_LEVEL_KEYS.some(([k]) => k === key)) continue   // 上で処理済み（URLの配列）
      const name = ITEM_LABELS[key] ?? key
      for (const item of val) {
        push(out, (item as any)?.fileUrls, `${siteName}／${(item as any)?.label || name}`)
      }
    }
  })

  // 本日のガソリン代は現場ではなく日報の直下にぶら下がる
  const gas = Array.isArray(report?.gasoline_items) ? report.gasoline_items
            : Array.isArray(report?.gasolineItems) ? report.gasolineItems : []
  for (const g of gas) push(out, g?.fileUrls, `本日のガソリン代／${g?.payee || '給油'}`)

  return out
}

export type ReceiptDiff = {
  /** 編集で増えた領収書（＝今回見るべきもの） */
  added: Receipt[]
  /** 編集で外された領収書（差し替えなら added と対になる） */
  removed: Receipt[]
  /** 変更されていない領収書。参考として畳んで出す */
  kept: Receipt[]
}

/**
 * 編集前(daily_reports) と 編集後(保留 payload) の領収書を突き合わせる。
 * URLで同一判定する（同じファイルは同じURLなので、ラベルだけ変わっても差し替え扱いにしない）。
 */
export function diffReceipts(before: any, after: any): ReceiptDiff {
  const oldList = collectReceipts(before)
  const newList = collectReceipts(after)
  const oldUrls = new Set(oldList.map(r => r.url))
  const newUrls = new Set(newList.map(r => r.url))

  return {
    added: newList.filter(r => !oldUrls.has(r.url)),
    removed: oldList.filter(r => !newUrls.has(r.url)),
    kept: newList.filter(r => oldUrls.has(r.url)),
  }
}
