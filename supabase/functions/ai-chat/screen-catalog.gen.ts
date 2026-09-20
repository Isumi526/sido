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
  /** 承認系（meta.approver）＝ owner/admin/office/site_manager のみ */
  requiresApprover: boolean
  /** 「使う機能」ゲート（meta.feature）。shared/features.ts の FeatureKey。無ければ null */
  feature: string | null
  help: string[]
}

export const SCREEN_CATALOG: ScreenCatalogEntry[] = [
  {
    "path": "/",
    "name": "ダッシュボード",
    "title": "ダッシュボード",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/calendar",
    "name": "スケジュール管理",
    "title": "スケジュール管理",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/schedule-categories",
    "name": "予定カテゴリ",
    "title": "予定カテゴリ設定",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/process",
    "name": "工程管理",
    "title": "工程管理",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": [
      "全現場の工期（現場マスタで入力）を月単位で俯瞰します。現場は住所の地方ごとにまとまり、行のクリップから工程表ファイル（PDF・画像・Excel）を開けます。",
      "工期が未入力の現場は「工期未定」に出ます。現場マスタの編集で工期を入れると帯が出ます。",
      "工程表ファイルは現場マスタの編集画面「＋ 工程表」から添付します。作業員画面の「会社予定」にも同じ帯とクリップが出ます。"
    ]
  },
  {
    "path": "/workers",
    "name": "作業員",
    "title": "作業員マスタ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/sites",
    "name": "現場",
    "title": "現場マスタ",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/work-categories",
    "name": "作業区分",
    "title": "作業区分の設定",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/assets",
    "name": "物品マスタ",
    "title": "物品マスタ（ETCカード）",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/inventory",
    "name": "在庫管理",
    "title": "",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": "inventory",
    "help": []
  },
  {
    "path": "/tools",
    "name": "道具管理",
    "title": "道具管理",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": "tools",
    "help": []
  },
  {
    "path": "/chats",
    "name": "チャット",
    "title": "チャット",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/chats/account",
    "name": "社内チャット",
    "title": "{{ accountName || '全体チャット' }}",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/contractors",
    "name": "元請け業者",
    "title": "元請け業者マスタ",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/site-rules",
    "name": "出退勤の確認ルール",
    "title": "出退勤の確認ルール",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/attendance",
    "name": "出退勤ログ",
    "title": "出退勤ログ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/subcontractors",
    "name": "協力業者",
    "title": "協力業者マスタ",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/vehicles",
    "name": "車両",
    "title": "車両マスタ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": "vehicles",
    "help": []
  },
  {
    "path": "/reports",
    "name": "日報一覧",
    "title": "日報一覧",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/site-reports",
    "name": "現場別集計",
    "title": "現場別集計",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
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
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/expenses-daily",
    "name": "経費 日毎集計",
    "title": "経費 日毎集計",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/gasoline-allocation",
    "name": "ガソリン按分",
    "title": "ガソリン按分",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
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
    "requiresApprover": false,
    "feature": null,
    "help": [
      "協力業者からの請求（支払）を登録・管理します。",
      "「＋ 新規請求」から、業者・対象・金額を入力して登録します。",
      "協力業者以外の仕入先の請求書も、請求元区分を「その他仕入先」に切り替えて仕入先名を直接入力すれば登録できます。",
      "登録済みの請求は一覧から編集・確認できます。"
    ]
  },
  {
    "path": "/unpaid-invoices",
    "name": "未入金一覧",
    "title": "未入金一覧",
    "requiresManagement": true,
    "requiresEstimate": true,
    "requiresApprover": false,
    "feature": null,
    "help": [
      "受注済み（状態=受注）の見積案件が並びます。まだ入金が確認できていないものだけが対象です。",
      "請求金額は未入力なら見積の合計金額を既定で表示します。実際に請求した額が違う場合は直接書き換えてください。",
      "支払期限を過ぎている行は赤くなり、「N日超過」と滞留日数が出ます。",
      "入金日を入れるとその行は一覧から消えます。あとから確認したい時は「入金済みも表示」にチェックを入れてください。",
      "この画面から催促メール等が送られることは一切ありません（表示・記録のみ）。"
    ]
  },
  {
    "path": "/worker-reports",
    "name": "出面・勤怠",
    "title": "出面・勤怠管理",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/paid-leave",
    "name": "有給管理",
    "title": "有給管理",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/settings",
    "name": "設定",
    "title": "設定",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/data-export",
    "name": "データの一括ダウンロード",
    "title": "データの一括ダウンロード",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/external-consents",
    "name": "外部者の規約同意",
    "title": "外部者の規約同意",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/company-profile",
    "name": "自社情報",
    "title": "自社情報",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/users",
    "name": "ユーザー",
    "title": "ユーザー管理",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/reminder-history",
    "name": "リマインド履歴",
    "title": "リマインド履歴",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/operation-logs",
    "name": "操作ログ",
    "title": "操作ログ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/usage-report",
    "name": "効果測定",
    "title": "効果測定",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/non-submitters",
    "name": "未送信者リスト",
    "title": "未送信者リスト",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/report-edit-approvals",
    "name": "日報編集の承認",
    "title": "日報編集の許可申請",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": true,
    "feature": null,
    "help": []
  },
  {
    "path": "/report-edit-review",
    "name": "日報編集の承認",
    "title": "日報編集の承認",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": true,
    "feature": null,
    "help": []
  },
  {
    "path": "/report-site-relink",
    "name": "現場未設定の紐付け",
    "title": "現場未設定の日報を紐付け",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": true,
    "feature": null,
    "help": []
  },
  {
    "path": "/overtime-approvals",
    "name": "残業申請の承認",
    "title": "残業申請の承認",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": true,
    "feature": null,
    "help": []
  },
  {
    "path": "/punch-corrections",
    "name": "打刻修正の承認",
    "title": "打刻修正の承認",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": true,
    "feature": null,
    "help": []
  },
  {
    "path": "/distance-approvals",
    "name": "距離の超過申請",
    "title": "距離の超過申請",
    "requiresManagement": false,
    "requiresEstimate": false,
    "requiresApprover": true,
    "feature": null,
    "help": [
      "作業員が日報で、現場マスタの既定距離（会社からの往復km）より大きい距離を入れると、理由付きでここに届きます。",
      "承認するまでは既定の距離で計上されます（未承認の超過分でガソリン按分の金額は動きません）。承認すると入力した距離に置き換わり、集計に反映されます。",
      "月次を締める前に承認待ちを残さないでください（承認後に差し替わるため、締め後に承認すると集計が変わります）。",
      "自分が出した申請は自分では承認できません。別の承認者に依頼してください。"
    ]
  },
  {
    "path": "/ai-help",
    "name": "AIヘルプ",
    "title": "AIヘルプ",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
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
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/estimates",
    "name": "見積書（受領）",
    "title": "見積書管理",
    "requiresManagement": true,
    "requiresEstimate": true,
    "requiresApprover": false,
    "feature": null,
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
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/estimate-masters",
    "name": "見積マスタ・単価表",
    "title": "見積マスタ・単価表",
    "requiresManagement": true,
    "requiresEstimate": true,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/estimate-builder",
    "name": "見積作成",
    "title": "見積もり",
    "requiresManagement": true,
    "requiresEstimate": true,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/estimate-excel",
    "name": "見積Excel連携",
    "title": "見積Excel連携",
    "requiresManagement": true,
    "requiresEstimate": true,
    "requiresApprover": false,
    "feature": "estimate_excel",
    "help": []
  },
  {
    "path": "/purchase-orders",
    "name": "注文書発行",
    "title": "注文書発行",
    "requiresManagement": true,
    "requiresEstimate": true,
    "requiresApprover": false,
    "feature": null,
    "help": []
  },
  {
    "path": "/drawing-materials",
    "name": "実施図面 材料抽出(AI)",
    "title": "実施図面 読み取り（AI）",
    "requiresManagement": true,
    "requiresEstimate": false,
    "requiresApprover": false,
    "feature": null,
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
