// ============================================================
//  screen-catalog.gen.ts  ★自動生成 — 直接編集しない★
//  生成元: scripts/build-screen-catalog.mjs
//  ai-chat EF が systemInstruction の接地に使う画面カタログ。
//  画面を追加/変更したら  node scripts/build-screen-catalog.mjs  で再生成する。
// ============================================================
export interface ScreenCatalogEntry {
  path: string
  name: string
  title: string
  requiresManagement: boolean
  requiresEstimate: boolean
  help: string[]
}

export const SCREEN_CATALOG: ScreenCatalogEntry[] = [
  {
    "path": "/",
    "name": "ダッシュボード",
    "title": "ダッシュボード",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/calendar",
    "name": "予定管理",
    "title": "予定管理",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/schedule-categories",
    "name": "予定カテゴリ",
    "title": "予定カテゴリ設定",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/process",
    "name": "工程管理",
    "title": "工程管理",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": [
      "現場を選び、工程（タスク）を開始日・終了日・担当・進捗で登録します。",
      "バーは各工程の期間、緑の塗りは進捗%を表します。横軸は年月日のカレンダーです。",
      "「＋ 工程を追加」から登録。各行の編集/削除で更新できます。",
      "現場プルダウンで「全現場（横断ビュー）」を選ぶと、全現場の工程を同じカレンダー上に並べて確認できます。横断ビューでも追加でき、その場合は現場を選んで登録します。"
    ]
  },
  {
    "path": "/workers",
    "name": "作業員",
    "title": "作業員マスタ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/sites",
    "name": "現場",
    "title": "現場マスタ",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/work-categories",
    "name": "作業区分",
    "title": "作業区分の設定",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/assets",
    "name": "物品マスタ",
    "title": "物品マスタ（ETCカード）",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/chats",
    "name": "チャット",
    "title": "チャット",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/chats/account",
    "name": "社内チャット",
    "title": "{{ accountName || '全体チャット' }}",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/contractors",
    "name": "元請け業者",
    "title": "元請け業者マスタ",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/site-rules",
    "name": "現場ルール",
    "title": "{{ siteName }} &nbsp;—&nbsp; 確認ルール",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/attendance",
    "name": "出退勤ログ",
    "title": "出退勤ログ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/subcontractors",
    "name": "協力業者",
    "title": "協力業者マスタ",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/vehicles",
    "name": "車両",
    "title": "車両マスタ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/reports",
    "name": "日報一覧",
    "title": "日報一覧",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/site-reports",
    "name": "現場別集計",
    "title": "現場別集計",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": [
      "現場ごとに日報の稼働（人工）と経費を集計して表示します。",
      "上部の月ナビで対象月を切り替えられます。「期間で見る」で複数月をまたいだ合計も出せます。",
      "行を開くと、日報単位の内訳（作業員・経費）を確認できます。"
    ]
  },
  {
    "path": "/expenses",
    "name": "経費管理",
    "title": "経費管理",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/expenses-daily",
    "name": "経費 日毎集計",
    "title": "経費 日毎集計",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/gasoline-allocation",
    "name": "ガソリン按分",
    "title": "ガソリン按分",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": [
      "作業員が日報の「本日のガソリン代」に入力した実費を当月で自動集計し、各現場の走行距離の比率で実績を配賦します。",
      "見込み（走行距離×単価）と実績（按分）を並べ、差異（実績−見込み）を表示します。",
      "走行距離は日報の車両経費（距離）から自動集計しています。",
      "集計値が実態と合わない時だけ、下の「手動上書き」に金額を入れるとその値で按分します（0で自動集計へ戻る）。"
    ]
  },
  {
    "path": "/subcontractor-invoices",
    "name": "協力業者請求",
    "title": "協力業者請求",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": [
      "協力業者からの請求（支払）を登録・管理します。",
      "「＋ 新規請求」から、業者・対象・金額を入力して登録します。",
      "協力業者以外の仕入先の請求書も、請求元区分を「その他仕入先」に切り替えて仕入先名を直接入力すれば登録できます。",
      "登録済みの請求は一覧から編集・確認できます。"
    ]
  },
  {
    "path": "/worker-reports",
    "name": "出面・勤怠",
    "title": "出面・勤怠管理",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/paid-leave",
    "name": "有給管理",
    "title": "有給管理",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/settings",
    "name": "設定",
    "title": "設定",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/company-profile",
    "name": "自社情報",
    "title": "自社情報",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/users",
    "name": "ユーザー",
    "title": "ユーザー管理",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/reminder-history",
    "name": "リマインド履歴",
    "title": "リマインド履歴",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/operation-logs",
    "name": "操作ログ",
    "title": "操作ログ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/non-submitters",
    "name": "未送信者リスト",
    "title": "未送信者リスト",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/report-edit-approvals",
    "name": "日報編集の承認",
    "title": "日報編集の許可申請",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/report-edit-review",
    "name": "日報編集の承認",
    "title": "日報編集の承認",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/report-site-relink",
    "name": "現場未設定の紐付け",
    "title": "現場未設定の日報を紐付け",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/overtime-approvals",
    "name": "残業申請の承認",
    "title": "残業申請の承認",
    "requiresManagement": false,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/ai-help",
    "name": "AIヘルプ",
    "title": "AIヘルプ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": [
      "アプリの操作や仕様について質問すると、仕様を理解したAIが回答します。",
      "不具合かもと思ったら「バグとして報告」でバックログに起票できます。",
      "回答はAIによる参考情報です。重要な操作は実際の画面でご確認ください。",
      "右下のフローティングボタンからは、どのページにいてもこのヘルプを開けます。"
    ]
  },
  {
    "path": "/faq",
    "name": "FAQナレッジ",
    "title": "FAQナレッジ（AIヘルプ）",
    "requiresManagement": true,
    "requiresEstimate": false,
    "help": []
  },
  {
    "path": "/estimates",
    "name": "見積書（受領）",
    "title": "見積書管理",
    "requiresManagement": true,
    "requiresEstimate": true,
    "help": [
      "業者から受け取った見積書PDFをアップロードし、業者・現場に紐付けて保存します。",
      "業者を選ぶと、現場プルダウンはその業者に紐づく現場のみに絞り込まれます（現場マスタ詳細で紐付け）。",
      "合計金額・工事内容は目視で入力します。保存後は一覧からPDFを開けます。"
    ]
  },
  {
    "path": "/estimate-list",
    "name": "見積もり",
    "title": "見積もり",
    "requiresManagement": true,
    "requiresEstimate": true,
    "help": []
  },
  {
    "path": "/estimate-masters",
    "name": "見積マスタ・単価表",
    "title": "見積マスタ・単価表",
    "requiresManagement": true,
    "requiresEstimate": true,
    "help": []
  },
  {
    "path": "/estimate-builder",
    "name": "見積作成",
    "title": "見積もり",
    "requiresManagement": true,
    "requiresEstimate": true,
    "help": []
  },
  {
    "path": "/purchase-orders",
    "name": "注文書発行",
    "title": "注文書発行",
    "requiresManagement": true,
    "requiresEstimate": true,
    "help": []
  },
  {
    "path": "/drawing-materials",
    "name": "実施図面 材料抽出(AI)",
    "title": "実施図面 読み取り（AI）",
    "requiresManagement": true,
    "requiresEstimate": true,
    "help": [
      "施工図面(PDF)をドラッグ&ドロップまたは選択すると、AIが一度の操作で「材料（何を使うか）」と「数量（どれだけ要るか）」の両方を読み取ります。押すものは1つだけです。",
      "材料＝部位・メーカー名・品番・規格サイズ・仕様。数量＝凡例/仕上表に書かれている面積・台数・本数（壁面積は図面に無いため対象外）。",
      "数量（軽い）が先に、材料（規格サイズのWeb検索が入るぶん重い）が少し遅れて出そろいます。片方でエラーが出ても、もう片方の結果は残ります。",
      "複数ページのPDFは自動でページ分割して1ページずつ解析します。",
      "読み取れない/自信が無い項目は備考に「不明」「要確認」と入ります。結果は必ず人が確認・修正してください。",
      "結果はこの画面で直接編集でき、材料・数量それぞれCSVで書き出せます（見積・工程表への反映は手動）。"
    ]
  }
]
