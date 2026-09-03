// 管理画面のルートパス → 日本語の画面名。AIチャットの「これ何？」入口で
// 「今いる画面」を初期文脈としてチャット/EFに渡すために使う。
// ラベルは App.vue のサイドバー表記に合わせている（人が見て分かる名前で文脈化するため）。
const SCREEN_NAMES: Record<string, string> = {
  '/': 'ダッシュボード',
  '/reports': '日報一覧',
  '/report-edit-review': '日報編集の承認',
  '/report-edit-approvals': '日報編集の承認',
  '/report-site-relink': '現場未設定の紐付け',
  '/overtime-approvals': '残業申請の承認',
  '/punch-corrections': '打刻修正の承認',
  '/chats': 'チャット',
  '/chats/account': '社内チャット',
  '/site-reports': '現場別集計',
  '/calendar': '予定管理',
  '/schedule-categories': '予定カテゴリ',
  '/process': '工程管理',
  '/worker-reports': '出面・勤怠',
  '/attendance': '出退勤ログ',
  '/paid-leave': '有給管理',
  '/estimate-list': '見積もり',
  '/estimates': '見積書（受領）',
  '/estimate-masters': '見積マスタ・単価表',
  '/estimate-builder': '見積作成',
  '/purchase-orders': '注文書発行',
  '/drawing-materials': '実施図面 材料抽出(AI)',
  '/expenses': '経費管理',
  '/expenses-daily': '経費 日毎集計',
  '/gasoline-allocation': 'ガソリン按分',
  '/subcontractor-invoices': '協力業者請求',
  '/workers': '作業員',
  '/sites': '現場',
  '/work-categories': '作業区分',
  '/contractors': '元請け業者',
  '/subcontractors': '協力業者',
  '/vehicles': '車両',
  '/assets': '物品マスタ',
  '/inventory': '在庫管理',
  '/site-rules': '出退勤の確認ルール',
  '/ai-help': 'AIヘルプ',
  '/faq': 'FAQナレッジ',
  '/non-submitters': '未送信者リスト',
  '/reminder-history': 'リマインド履歴',
  '/operation-logs': '操作ログ',
  '/users': 'ユーザー',
  '/company-profile': '自社情報',
  '/settings': '設定',
}

/**
 * ルートパスから { path, name } を解決する。
 * 完全一致 → 動的セグメント(/sites/:id, /chats/:id)のプレフィックス一致 → フォールバック の順。
 */
export function resolveScreenContext(path: string): { path: string; name: string } {
  const clean = (path || '/').split('?')[0].split('#')[0]
  if (SCREEN_NAMES[clean]) return { path: clean, name: SCREEN_NAMES[clean] }
  if (clean.startsWith('/sites/')) return { path: clean, name: '現場詳細' }
  if (clean.startsWith('/chats/')) return { path: clean, name: 'チャット詳細' }
  return { path: clean, name: 'この画面' }
}
