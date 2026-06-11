<template>
  <div class="portal">
    <div class="portal-card">
      <div class="brand">SIDO</div>

      <div v-if="loading" class="state">
        <div class="spinner" />
        <p>読み込み中…</p>
      </div>

      <div v-else-if="!result?.ok" class="state">
        <div class="icon-bad">⚠️</div>
        <h1>リンクが無効です</h1>
        <p class="muted">このリンクは期限切れ・失効済み、または正しくありません。お手数ですが発行元にお問い合わせください。</p>
      </div>

      <div v-else class="state ok">
        <div class="icon-ok">✓</div>
        <p class="hello">{{ result.subcontractor?.name }} 様</p>
        <h1>{{ purposeLabel }}</h1>
        <p class="muted">対象の書類を準備しています。内容のご確認・お手続きはこの画面から行えます。</p>
        <!-- 注文書承諾・請求フォーム等の本体UIは後続チケットでこの枠に実装 -->
        <div class="doc-placeholder">書類の表示・お手続きUIは準備中です（{{ result.purpose }}）。</div>
      </div>
    </div>
    <p class="foot">このページはお客様専用のリンクです。第三者への共有はお控えください。</p>
  </div>
</template>

<script setup lang="ts">
// 業者向けポータル：LINEログイン不要。トークンを Edge Function に渡して検証・スコープ取得する。
// ※ このページは LIFF 初期化を経由しない（app.vue が /p/ を除外）。
const route  = useRoute()
const config = useRuntimeConfig()

type PortalResult = {
  ok: boolean
  purpose?: string
  document_type?: string | null
  document_id?: string | null
  subcontractor?: { id: string; name: string }
}

const loading = ref(true)
const result  = ref<PortalResult | null>(null)

const PURPOSE_LABELS: Record<string, string> = {
  order_accept:   '注文書のご確認・ご承諾',
  invoice_submit: '請求書のご提出',
}
const purposeLabel = computed(() => (result.value?.purpose && PURPOSE_LABELS[result.value.purpose]) || 'お手続き')

onMounted(async () => {
  const token = String(route.params.token ?? '')
  const edgeBase = (config.public as any).edgeFunctionUrl || `${(config.public as any).supabaseUrl}/functions/v1`
  try {
    const res = await fetch(`${edgeBase}/subcontractor-portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'resolve' }),
    })
    result.value = await res.json()
  } catch {
    result.value = { ok: false }
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.portal { min-height: 100dvh; background: #f2f2f7; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; gap: 14px; }
.portal-card { background: #fff; width: 100%; max-width: 420px; border-radius: 18px; padding: 32px 24px; box-shadow: 0 4px 20px rgba(0,0,0,.08); text-align: center; }
.brand { font-size: 20px; font-weight: 900; letter-spacing: 6px; color: #06C755; margin-bottom: 20px; }
.state { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.state h1 { font-size: 18px; font-weight: 700; margin: 0; color: #111; }
.hello { font-size: 15px; font-weight: 700; color: #06C755; margin: 0; }
.muted { font-size: 13px; color: #888; line-height: 1.7; margin: 0; }
.icon-ok { width: 48px; height: 48px; border-radius: 50%; background: #e8f9ef; color: #06C755; font-size: 26px; display: flex; align-items: center; justify-content: center; }
.icon-bad { font-size: 36px; }
.doc-placeholder { margin-top: 10px; width: 100%; box-sizing: border-box; background: #f8f9fa; border: 1px dashed #d8dde3; border-radius: 10px; padding: 16px; font-size: 12px; color: #999; }
.spinner { width: 30px; height: 30px; border: 3px solid #e0e0e0; border-top-color: #06C755; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.foot { font-size: 11px; color: #aaa; max-width: 420px; text-align: center; margin: 0; }
</style>
