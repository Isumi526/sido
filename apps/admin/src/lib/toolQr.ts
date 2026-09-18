// ============================================================
//  toolQr — 道具QR／場所QR の URL と、面付けラベルPDF（A4）の生成
//  Notion: 【道具①】https://app.notion.com/p/3d90ff81c56b818fb7f5c118979b97e0
//
//  ★QR に埋める URL はアプリ自身のドメイン（AC4）。liff.line.me は使わない
//   （LINE認証撤去が進行中で、印刷後に URL を変えられないため）。dev は localhost:3000。
//   本番のドメインは VITE_LIFF_ORIGIN で差し替え可（未設定なら sido-liff.vercel.app）。
//  ★日本語フォントの埋め込みを避けるため、SiteQrPanel と同じく canvas に描いてから
//   1ページ1画像として PDF に貼る。
// ============================================================
import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'

const LIFF_ORIGIN = import.meta.env.DEV
  ? 'http://localhost:3000'
  : ((import.meta.env.VITE_LIFF_ORIGIN as string | undefined) || 'https://sido-liff.vercel.app')

export function toolQrUrl(toolId: string): string { return `${LIFF_ORIGIN}/tools/${toolId}` }
export function toolLocationQrUrl(locationId: string): string { return `${LIFF_ORIGIN}/tool-locations/${locationId}` }

export type QrLabel = {
  url: string
  title: string        // 道具名／保管場所名
  lines?: string[]     // 種別・管理番号・定位置 など（最大3行）
  tag?: string         // 「道具」「場所」
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** 幅に収まるまで文字を縮める（最小 sizeMin） */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, sizeMin: number, weight = 'bold'): number {
  let s = size
  ctx.font = `${weight} ${s}px sans-serif`
  while (ctx.measureText(text).width > maxWidth && s > sizeMin) { s -= 2; ctx.font = `${weight} ${s}px sans-serif` }
  return s
}

/**
 * ラベルを A4 に面付けして PDF を保存する。
 *  cols×rows は 2×4（8枚/枚・約 95×65mm）を既定にする＝道具に貼るラベル用。
 *  場所QR（壁に貼る）は 1×2（2枚/枚・大きめ）を指定する。
 */
export async function downloadQrLabelPdf(labels: QrLabel[], fileName: string, opts: { cols?: number; rows?: number } = {}): Promise<void> {
  if (!labels.length) return
  const cols = opts.cols ?? 2, rows = opts.rows ?? 4
  const perPage = cols * rows
  // A4 縦 ≒ 150dpi
  const W = 1240, H = 1754, M = 60
  const cellW = (W - M * 2) / cols, cellH = (H - M * 2) / rows
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  for (let p = 0; p * perPage < labels.length; p++) {
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)

    const page = labels.slice(p * perPage, (p + 1) * perPage)
    for (let i = 0; i < page.length; i++) {
      const lb = page[i]
      const x = M + (i % cols) * cellW, y = M + Math.floor(i / cols) * cellH
      // 切り取り線
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 2; ctx.setLineDash([12, 10])
      ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12)
      ctx.setLineDash([])

      // QR（左）。セル高さに合わせる
      const qrSize = Math.min(cellH - 60, cellW * 0.42)
      const qr = await loadImage(await QRCode.toDataURL(lb.url, { width: 600, margin: 1, color: { dark: '#111111', light: '#ffffff' } }))
      const qrX = x + 26, qrY = y + (cellH - qrSize) / 2
      ctx.drawImage(qr, qrX, qrY, qrSize, qrSize)

      // 文字（右）
      const tx = qrX + qrSize + 24
      const maxW = x + cellW - 30 - tx
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      let ty = y + 40
      if (lb.tag) {
        ctx.fillStyle = '#06C755'; ctx.font = 'bold 22px sans-serif'
        ctx.fillText(lb.tag, tx, ty); ty += 32
      }
      ctx.fillStyle = '#111111'
      const titleSize = fitText(ctx, lb.title, maxW, Math.min(44, cellH / 5), 20)
      // 長い名前は2行まで折る
      const words = lb.title
      if (ctx.measureText(words).width <= maxW) { ctx.fillText(words, tx, ty); ty += titleSize + 12 }
      else {
        let line = '', lines: string[] = []
        for (const ch of words) { if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch } else line += ch }
        if (line) lines.push(line)
        for (const l of lines.slice(0, 2)) { ctx.fillText(l, tx, ty); ty += titleSize + 6 }
        ty += 6
      }
      ctx.fillStyle = '#374151'
      for (const l of (lb.lines ?? []).slice(0, 3)) {
        fitText(ctx, l, maxW, 24, 16, 'normal')
        ctx.fillText(l, tx, ty); ty += 32
      }
      // URL（小さく）。読めないときに手で開ける
      ctx.fillStyle = '#9ca3af'; ctx.font = '14px sans-serif'
      const url = lb.url.replace(/^https?:\/\//, '')
      ctx.fillText(url.length > 48 ? url.slice(0, 46) + '…' : url, tx, y + cellH - 40)
    }

    if (p > 0) pdf.addPage()
    pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 210, 297)
  }
  pdf.save(fileName)
}
