<template>
  <div>
    <div class="page-header">
      <div class="header-left">
        <button class="btn-back" @click="router.push('/sites')">← 現場一覧</button>
        <h1 class="page-title">{{ siteName }} &nbsp;—&nbsp; QRコード発行</h1>
      </div>
    </div>

    <div class="qr-card">
      <p class="qr-label">出勤用 QRコード</p>
      <canvas ref="canvas" class="qr-canvas" />
      <p class="qr-url">{{ qrUrl }}</p>
      <div class="btn-row">
        <button class="btn-download" :disabled="generating" @click="downloadPdf">
          {{ generating ? '作成中...' : '印刷用PDF（A4）' }}
        </button>
        <button class="btn-download secondary" @click="download">PNG画像</button>
      </div>
      <p class="dl-hint">現場に貼るなら「印刷用PDF」がおすすめ（A4・現場名と使い方入り）</p>
    </div>

    <div class="note-card">
      <p class="note-title">使い方</p>
      <ol class="note-list">
        <li>このQRコードを現場の入口に掲示する</li>
        <li>作業員がLINEアプリのカメラでQRを読み取る</li>
        <li>確認ルールを全件チェックして出勤登録</li>
      </ol>
      <p class="note-sub">QRコードに有効期限はありません（永続）</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'
import { supabase } from '../lib/supabase'

const route  = useRoute()
const router = useRouter()

const siteId   = route.query.site_id as string
const siteName   = ref('')
const canvas     = ref<HTMLCanvasElement | null>(null)
const generating = ref(false)

const LIFF_ID = import.meta.env.VITE_LIFF_ID as string | undefined

const qrUrl = LIFF_ID
  ? `https://liff.line.me/${LIFF_ID}/checkin?site_id=${siteId}`
  : `(VITE_LIFF_ID が未設定です)`

onMounted(async () => {
  const { data } = await supabase.from('sites').select('name').eq('id', siteId).single()
  siteName.value = data?.name ?? ''

  if (!canvas.value || !LIFF_ID) return
  await QRCode.toCanvas(canvas.value, qrUrl, {
    width: 280,
    margin: 2,
    color: { dark: '#111111', light: '#ffffff' },
  })
})

function download() {
  if (!canvas.value) return
  const link = document.createElement('a')
  link.download = `qr_${siteName.value || siteId}.png`
  link.href     = canvas.value.toDataURL('image/png')
  link.click()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = reject
    img.src     = src
  })
}

// 日本語フォント埋め込みを避けるため、ポスター全体をcanvasに描画してから
// A4 PDFに1枚画像として貼り込む（テキストはブラウザのフォントで描画）
async function downloadPdf() {
  if (!LIFF_ID || generating.value) return
  generating.value = true
  try {
    // A4縦 ≒ 150dpi（210×297mm）
    const W = 1240, H = 1754
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')!

    // 背景＆枠
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 3
    ctx.strokeRect(40, 40, W - 80, H - 80)

    // 上部アクセントバー
    ctx.fillStyle = '#06C755'
    ctx.fillRect(40, 40, W - 80, 14)

    ctx.textAlign = 'center'

    // 現場名（幅に収まるよう自動縮小）
    let titleSize = 76
    ctx.fillStyle = '#111111'
    ctx.font = `bold ${titleSize}px sans-serif`
    while (ctx.measureText(siteName.value).width > W - 220 && titleSize > 28) {
      titleSize -= 2
      ctx.font = `bold ${titleSize}px sans-serif`
    }
    ctx.fillText(siteName.value || '現場', W / 2, 220)

    // サブタイトル
    ctx.fillStyle = '#555555'
    ctx.font = '40px sans-serif'
    ctx.fillText('出勤・退勤 QRコード', W / 2, 300)

    // QRコード（高解像度で再生成）
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      width: 900, margin: 1, color: { dark: '#111111', light: '#ffffff' },
    })
    const qrImg  = await loadImage(qrDataUrl)
    const qrSize = 760
    const qrX    = (W - qrSize) / 2
    const qrY    = 380
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)

    // 使い方
    let y = qrY + qrSize + 120
    ctx.textAlign = 'left'
    ctx.fillStyle = '#111111'
    ctx.font = 'bold 46px sans-serif'
    ctx.fillText('使い方', 150, y)

    ctx.font = '38px sans-serif'
    ctx.fillStyle = '#333333'
    const steps = [
      '① LINEアプリのカメラでこのQRコードを読み取る',
      '② 確認項目を全てチェックして出勤／退勤を登録',
    ]
    y += 70
    for (const s of steps) {
      ctx.fillText(s, 150, y)
      y += 64
    }

    // 注記
    ctx.fillStyle = '#9ca3af'
    ctx.font = '30px sans-serif'
    ctx.fillText('※ このQRコードに有効期限はありません', 150, y + 24)

    // A4 PDFに貼り込み
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 210, 297)
    pdf.save(`qr_${siteName.value || siteId}.pdf`)
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
.header-left { display: flex; flex-direction: column; gap: 6px; }
.btn-back { background: none; border: none; color: #06C755; font-size: 13px; cursor: pointer; padding: 0; text-align: left; }
.btn-back:hover { text-decoration: underline; }
.page-title { font-size: 20px; font-weight: 700; }

.qr-card {
  background: #fff;
  border-radius: 16px;
  padding: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  max-width: 440px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.qr-label { font-size: 13px; font-weight: 700; color: #888; }
.qr-canvas { border-radius: 8px; }
.qr-url {
  font-size: 11px;
  color: #aaa;
  word-break: break-all;
  text-align: center;
  max-width: 300px;
}
.btn-row { display: flex; gap: 10px; margin-top: 8px; }
.btn-download {
  background: #06C755;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 28px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn-download:hover { opacity: .9; }
.btn-download:disabled { opacity: .5; cursor: default; }
.btn-download.secondary {
  background: #fff;
  color: #06C755;
  border: 1px solid #06C755;
}
.dl-hint { font-size: 12px; color: #9ca3af; text-align: center; margin-top: 2px; }

.note-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 24px 28px;
  max-width: 440px;
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.note-title { font-size: 13px; font-weight: 700; color: #555; }
.note-list  { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.note-list li { font-size: 13px; color: #555; line-height: 1.6; }
.note-sub { font-size: 12px; color: #9ca3af; margin-top: 4px; }
</style>
