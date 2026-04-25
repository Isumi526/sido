<template>
  <div class="app">
    <!-- ヘッダー -->
    <header class="header">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-name">App</span>
          <span class="brand-divider">|</span>
          <span class="brand-sub">施工台帳</span>
        </div>
        <div v-if="liff.profile.value" class="user-badge">
          {{ liff.profile.value.displayName }}
        </div>
      </div>
    </header>

    <main class="main">
      <!-- ローディング -->
      <div v-if="initializing" class="state-screen">
        <div class="spinner" />
        <p class="state-text">読み込み中...</p>
      </div>

      <!-- 送信完了 -->
      <div v-else-if="report.submitted.value" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">送信完了！</h2>
        <p class="state-text">LINEグループに通知しました</p>
        <button class="btn-primary" @click="report.reset()">もう1件入力する</button>
      </div>

      <!-- フォーム -->
      <form v-else @submit.prevent="handleSubmit" class="form">

        <!-- 日付 -->
        <FormSection num="01" title="日付">
          <input v-model="report.form.value.date" type="date" class="input" required />
        </FormSection>

        <!-- 現場ブロック -->
        <FormSection
          v-for="(site, si) in report.form.value.sites"
          :key="si"
          :num="String(si + 2).padStart(2, '0')"
          :title="`現場${ report.form.value.sites.length > 1 ? ' ' + (si + 1) : '' }`"
          accent
        >
          <template #action>
            <button
              v-if="report.form.value.sites.length > 1"
              type="button"
              class="btn-danger-sm"
              @click="report.removeSite(si)"
            >✕ 削除</button>
          </template>

          <!-- 現場名 -->
          <Field label="現場名">
            <select v-model="site.siteName" class="select" required>
              <option value="">選択してください</option>
              <option v-for="name in master.siteNames.value" :key="name" :value="name">{{ name }}</option>
            </select>
          </Field>

          <!-- 作業員 -->
          <Field label="作業員">
            <div v-for="(w, wi) in site.workers" :key="wi" class="row-worker">
              <select v-model="w.workerName" class="select" required>
                <option value="">名前を選択</option>
                <option v-for="name in master.workerNames.value" :key="name" :value="name">{{ name }}</option>
              </select>
              <select v-model.number="w.days" class="select select--days" required>
                <option value="">工数</option>
                <option v-for="v in DAY_OPTIONS" :key="v" :value="v">{{ v }}</option>
              </select>
              <button v-if="site.workers.length > 1" type="button" class="btn-icon-sm" @click="report.removeWorker(si, wi)">✕</button>
            </div>
            <button type="button" class="btn-ghost-sm" @click="report.addWorker(si)">＋ 作業員を追加</button>
          </Field>

          <!-- 経費 -->
          <Field label="経費">
            <div class="expense-list">
              <!-- ガソリン走行距離 -->
              <div class="expense-row-full">
                <span class="expense-label">🚗 ガソリン走行距離</span>
                <div class="expense-inputs">
                  <input v-model="site.expenses.vehicle" type="text" class="input" placeholder="車両名" />
                  <input v-model.number="site.expenses.distanceKm" type="number" min="0" class="input" placeholder="往復km" />
                </div>
              </div>
              <!-- 軽油走行距離 -->
              <div class="expense-row-full">
                <span class="expense-label">🚛 軽油走行距離</span>
                <input v-model.number="site.expenses.dieselKm" type="number" min="0" class="input" placeholder="往復km" />
              </div>
              <!-- 2列グリッド経費 -->
              <div class="expense-grid">
                <ExpenseField v-model="site.expenses.parkingYen"        label="🅿️ 駐車場" />
                <ExpenseField v-model="site.expenses.highwayYen"        label="🛣️ 高速代" />
                <ExpenseField v-model="site.expenses.trainYen"          label="🚃 電車代" />
                <ExpenseField v-model="site.expenses.garbageFactoryYen" label="🗑️ ゴミ（工場）" />
                <ExpenseField v-model="site.expenses.garbageSiteYen"    label="🗑️ ゴミ（現場）" />
                <ExpenseField v-model="site.expenses.hotelYen"          label="🏨 ホテル・マンスリー" />
                <ExpenseField v-model="site.expenses.otherYen"          label="📦 その他（資材等）" />
                <ExpenseField v-model="site.expenses.entertainmentYen"  label="🥂 接待費" />
              </div>
            </div>
          </Field>

          <!-- 下請け業者 -->
          <Field label="下請け業者">
            <div v-for="(sub, si2) in site.subcontractors" :key="si2" class="row-worker">
              <select v-model="sub.subcontractorName" class="select">
                <option value="">業者選択</option>
                <option v-for="name in master.subcontractorNames.value" :key="name" :value="name">{{ name }}</option>
              </select>
              <input v-model.number="sub.count" type="number" min="1" max="20" class="input select--days" placeholder="人数" />
              <button v-if="site.subcontractors.length > 1" type="button" class="btn-icon-sm" @click="report.removeSub(si, si2)">✕</button>
            </div>
            <button type="button" class="btn-ghost-sm" @click="report.addSub(si)">＋ 業者を追加</button>
          </Field>
        </FormSection>

        <!-- 現場追加 -->
        <button type="button" class="btn-add-site" @click="report.addSite()">
          ＋ 現場を追加する
        </button>

        <!-- 備考 -->
        <FormSection num="✎" title="備考">
          <textarea
            v-model="report.form.value.note"
            class="textarea"
            placeholder="特記事項があれば入力してください"
            rows="3"
          />
        </FormSection>

        <!-- エラー表示 -->
        <div v-if="report.error.value" class="error-banner">
          ⚠️ {{ report.error.value }}
        </div>

        <!-- 送信ボタン -->
        <button type="submit" class="btn-submit" :disabled="report.submitting.value">
          <span v-if="report.submitting.value" class="submitting">
            <span class="dot-spin" />送信中...
          </span>
          <span v-else>日報を送信する →</span>
        </button>

      </form>
    </main>
  </div>
</template>

<script setup lang="ts">
const liff   = useLiff()
const master = useMaster()
const report = useReport()

const initializing = ref(true)

const DAY_OPTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5]

onMounted(async () => {
  await liff.init()
  await master.fetch()
  initializing.value = false
})

async function handleSubmit() {
  await report.submit()
}
</script>

<style>
/* ── リセット＆変数 ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #EFEFEF;
  --surface:  #FFFFFF;
  --surface2: #F7F7F7;
  --border:   #E0E0E0;
  --accent:   #06C755;
  --accent-l: #08D860;
  --text:     #111111;
  --text2:    #888888;
  --danger:   #E53935;
  --radius:   12px;
  --font:     'Noto Sans JP', -apple-system, sans-serif;
}

html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* ── ヘッダー ── */
.header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 100;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.header-inner {
  max-width: 640px; margin: 0 auto;
  padding: 0 16px;
  height: 52px;
  display: flex; align-items: center; justify-content: space-between;
}
.brand { display: flex; align-items: baseline; gap: 8px; }
.brand-name {
  font-size: 16px; font-weight: 900; letter-spacing: 5px;
  color: var(--accent);
}
.brand-divider { color: var(--border); }
.brand-sub { font-size: 12px; color: var(--text2); letter-spacing: 2px; }
.user-badge {
  font-size: 12px; color: var(--text2);
  background: var(--surface2);
  border: 1px solid var(--border);
  padding: 3px 10px; border-radius: 20px;
}

/* ── メイン ── */
.main { max-width: 640px; margin: 0 auto; padding: 16px 16px 100px; }

/* ── 状態画面 ── */
.state-screen {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 20px; gap: 16px; text-align: center;
}
.spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.success-mark {
  width: 80px; height: 80px;
  background: var(--accent);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 40px; color: #fff; font-weight: bold;
}
.state-title { font-size: 22px; font-weight: 700; }
.state-text  { font-size: 14px; color: var(--text2); }

/* ── フォーム ── */
.form { display: flex; flex-direction: column; gap: 10px; }

/* ── 入力要素 ── */
.input, .select, .textarea {
  width: 100%; background: var(--surface2); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 11px 14px; font-size: 15px; font-family: var(--font);
  transition: border-color 0.15s;
  -webkit-appearance: none; appearance: none;
}
.input:focus, .select:focus, .textarea:focus {
  outline: none; border-color: var(--accent);
  background: #fff;
}
.select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 38px;
}
.select--days { width: 90px; flex-shrink: 0; }
.textarea { resize: vertical; }

/* ── 作業員・下請け行 ── */
.row-worker {
  display: flex; gap: 8px; margin-bottom: 8px; align-items: center;
}
.row-worker .select:first-child { flex: 1; }

/* ── 経費リスト ── */
.expense-list { display: flex; flex-direction: column; gap: 12px; }

.expense-row-full { display: flex; flex-direction: column; gap: 6px; }
.expense-label { font-size: 12px; color: var(--text2); font-weight: 500; }
.expense-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

.expense-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

/* ── ボタン類 ── */
.btn-primary {
  background: var(--accent); color: #fff;
  border: none; border-radius: 8px;
  padding: 13px 28px; font-size: 15px; font-weight: 700;
  font-family: var(--font); cursor: pointer;
  transition: opacity 0.15s;
}
.btn-primary:hover { opacity: 0.85; }

.btn-ghost-sm {
  background: transparent; color: var(--accent);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 7px 14px; font-size: 12px; cursor: pointer;
  font-family: var(--font); transition: border-color 0.15s;
  margin-top: 2px;
}
.btn-ghost-sm:hover { border-color: var(--accent); }

.btn-icon-sm {
  background: transparent; color: var(--text2);
  border: 1px solid var(--border); border-radius: 6px;
  width: 32px; height: 40px; cursor: pointer;
  font-size: 12px; flex-shrink: 0;
}

.btn-danger-sm {
  background: transparent; color: var(--danger);
  border: 1px solid var(--danger); border-radius: 6px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
  font-family: var(--font);
}

.btn-add-site {
  width: 100%; background: transparent;
  border: 2px dashed var(--border); border-radius: var(--radius);
  color: var(--text2); font-size: 14px; font-family: var(--font);
  padding: 16px; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-add-site:hover { border-color: var(--accent); color: var(--accent); }

/* ── 送信ボタン ── */
.btn-submit {
  width: 100%;
  background: var(--accent);
  color: #fff; border: none; border-radius: var(--radius);
  padding: 18px; font-size: 16px; font-weight: 900; letter-spacing: 2px;
  font-family: var(--font); cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  margin-top: 4px;
}
.btn-submit:active:not(:disabled) { transform: scale(0.98); }
.btn-submit:disabled { opacity: 0.45; cursor: not-allowed; }

.submitting {
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
.dot-spin {
  width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* ── エラー ── */
.error-banner {
  background: #fff0f0;
  border: 1px solid var(--danger);
  color: var(--danger);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 13px;
}

/* ── レスポンシブ ── */
@media (max-width: 380px) {
  .expense-grid { grid-template-columns: 1fr; }
  .expense-inputs { grid-template-columns: 1fr; }
}
</style>
