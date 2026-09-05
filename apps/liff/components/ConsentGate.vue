<template>
  <div v-if="show" class="consent-overlay" data-testid="consent-gate">
    <div class="consent-card">
      <h1 class="consent-title">個人情報の取扱いについて</h1>
      <div class="consent-body" data-testid="consent-text">{{ text }}</div>
      <label class="consent-check">
        <input type="checkbox" v-model="checked" data-testid="consent-checkbox" />
        <span>上記の内容を確認し、同意します</span>
      </label>
      <p v-if="error" class="consent-error" data-testid="consent-error">{{ error }}</p>
      <button
        class="consent-submit"
        :disabled="!checked || busy"
        data-testid="consent-submit"
        @click="submit"
      >{{ busy ? '送信中…' : '同意して続ける' }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  ConsentGate — 個人データ取扱い（外国＝韓国への移転を含む）の同意ゲート
//
//  出所: 2026-09-01 弁護士打合せ。契約 第9条・第10条4項で、作業員本人の同意を
//   取ってから登録・利用させる義務が規定された。
//
//  ★同意しないと閉じられない（AC3・チェックボックス＋送信ボタンでのみ進める）。
//   ×ボタン・背景クリックでの閉鎖は用意しない＝これが要件そのもの。
// ============================================================
const consent = useWorkerConsent()

const show   = ref(false)
const text   = ref('')
const checked = ref(false)
const busy   = ref(false)
const error  = ref('')

onMounted(async () => {
  const r = await consent.status()
  // ★通信失敗時は null が返る＝表示しない（フェイルオープン。記録の要否とは別軸で
  //  「同意画面が出せない」ことを理由に業務を止めない）。
  if (r && !r.consented) { text.value = r.text; show.value = true }
})

async function submit() {
  if (!checked.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await consent.consent()
    if (!res.ok) { error.value = '送信に失敗しました。通信環境を確認してもう一度お試しください。'; return }
    show.value = false
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.consent-overlay {
  position: fixed; inset: 0; z-index: 20000;
  background: rgba(15, 23, 42, .55);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.consent-card {
  background: #fff; border-radius: 16px; padding: 24px 20px;
  max-width: 460px; width: 100%; max-height: 88vh; overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0,0,0,.3);
}
.consent-title { font-size: 17px; font-weight: 700; margin: 0 0 12px; color: #0f172a; }
.consent-body {
  font-size: 13px; line-height: 1.8; color: #374151; white-space: pre-wrap;
  background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 14px; margin-bottom: 14px; max-height: 40vh; overflow-y: auto;
}
.consent-check { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
.consent-check input { width: 18px; height: 18px; }
.consent-error { font-size: 13px; color: #b91c1c; margin: 10px 0 0; }
.consent-submit {
  width: 100%; margin-top: 16px; background: #06C755; color: #fff; border: none;
  border-radius: 10px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer;
}
.consent-submit:disabled { opacity: .5; cursor: not-allowed; }
</style>
