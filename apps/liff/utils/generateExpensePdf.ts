// ============================================================
//  utils/generateExpensePdf.ts
//  経費申請書(印刷エリアDOM)をクライアントで PDF(Blob) 化する。
//  正典: docs/spec/expense.md §6（クライアント生成→Storage保存→メール添付）
//  jspdf / html2canvas は重いので動的 import（クライアント専用）。
// ============================================================

const BUCKET = 'expense-receipts'

/** PDF化時の基準幅(px)。A4縦の印刷幅に合わせて表全体が収まるようにする */
const RENDER_WIDTH = 780

/** DOM要素を A4 PDF の Blob に変換 */
export async function elementToPdfBlob(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, jspdf] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])
  const jsPDF = (jspdf as any).jsPDF ?? (jspdf as any).default

  // モバイル幅のままだと表が横にはみ出て見切れる。一時的に印刷向けの幅へ広げ、
  // テーブルの横スクロールを解除してから撮影する（撮影後に元へ戻す）。
  const prevStyle = el.getAttribute('style') || ''
  const wraps = Array.from(el.querySelectorAll<HTMLElement>('.table-wrap'))
  const wrapPrev = wraps.map(w => w.getAttribute('style') || '')
  el.style.width = `${RENDER_WIDTH}px`
  el.style.maxWidth = 'none'
  wraps.forEach(w => { w.style.overflow = 'visible' })

  let canvas: HTMLCanvasElement
  try {
    canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      width: RENDER_WIDTH,
      windowWidth: RENDER_WIDTH + 40,
      // 画面専用要素（no-print: 領収書列・リンク等）はPDFに含めない
      ignoreElements: (node) => (node as HTMLElement).classList?.contains('no-print'),
    })
  } finally {
    el.setAttribute('style', prevStyle)
    wraps.forEach((w, i) => w.setAttribute('style', wrapPrev[i]))
  }
  const img = canvas.toDataURL('image/png')

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgW = pageW
  const imgH = (canvas.height * imgW) / canvas.width

  if (imgH <= pageH) {
    pdf.addImage(img, 'PNG', 0, 0, imgW, imgH)
  } else {
    // 複数ページに分割（縦に流す）
    let position = 0
    let remaining = imgH
    while (remaining > 0) {
      pdf.addImage(img, 'PNG', 0, position, imgW, imgH)
      remaining -= pageH
      position -= pageH
      if (remaining > 0) pdf.addPage()
    }
  }
  return pdf.output('blob')
}

/**
 * 申請PDFを Storage に保存し、保存パスを返す。
 * パス: expense-applications/{accountSlug}/{user_id}/{period_key}.pdf
 */
export async function uploadApplicationPdf(
  supabase: any,
  blob: Blob,
  accountSlug: string,
  userId: string,
  periodKey: string,
): Promise<string> {
  const path = `expense-applications/${accountSlug}/${userId}/${periodKey}.pdf`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'application/pdf' })
  if (error) throw new Error(`${path}: ${error.message}`)
  return path
}
