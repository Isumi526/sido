<template>
  <div class="app">
    <!-- ヘッダー -->
    <header class="header">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-name">App</span>
          <span class="brand-divider">|</span>
          <span class="brand-sub">日報</span>
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
        <button class="btn-primary" @click="handleReset">もう1件入力する</button>
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
              @click="removeSite(si)"
            >✕ 削除</button>
          </template>

          <!-- 現場名 -->
          <Field label="現場名">
            <select v-model="site.siteName" class="select" required>
              <option value="">選択してください</option>
              <option v-for="name in master.siteNames.value" :key="name" :value="name">{{ name }}</option>
            </select>
          </Field>

          <!-- ── 稼働 ── -->
          <div class="sub-section">
            <div class="sub-section-title">稼働</div>

            <!-- 作業員 -->
            <Field label="作業員">
              <div v-for="(w, wi) in site.workers" :key="wi" class="worker-block">
                <div class="role-toggle">
                  <button
                    type="button"
                    class="role-btn"
                    :class="{ active: w.workerRole === 'factory' }"
                    @click="w.workerRole = 'factory'; w.workerName = ''"
                  >工場/事務所</button>
                  <button
                    type="button"
                    class="role-btn"
                    :class="{ active: w.workerRole === 'site' }"
                    @click="w.workerRole = 'site'; w.workerName = ''"
                  >現場</button>
                </div>
                <div class="worker-name-row">
                  <select v-model="w.workerName" class="select" required>
                    <option value="">名前を選択</option>
                    <option
                      v-for="name in (w.workerRole === 'factory' ? master.factoryWorkerNames.value : master.siteWorkerNames.value)"
                      :key="name"
                      :value="name"
                    >{{ name }}</option>
                  </select>
                  <button v-if="site.workers.length > 1" type="button" class="btn-icon-sm" @click="report.removeWorker(si, wi)">✕</button>
                </div>
                <!-- 時刻・休憩 -->
                <div class="worker-time-rows">
                  <!-- 開始〜終了 -->
                  <div class="worker-time-row">
                    <div class="time-field">
                      <label class="hours-label">開始</label>
                      <select v-model="w.startTime" class="select">
                        <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                    <span class="time-sep">〜</span>
                    <div class="time-field">
                      <label class="hours-label">終了</label>
                      <select v-model="w.endTime" class="select">
                        <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                  </div>
                  <!-- 休憩（自動計算） -->
                  <div class="worker-break-row">
                    <div class="time-field">
                      <label class="hours-label">休憩</label>
                      <span class="break-auto">
                        {{ calcBreakMinutes(w.workerRole, w.startTime, w.endTime) === 0 ? 'なし' : calcBreakMinutes(w.workerRole, w.startTime, w.endTime) + '分（自動）' }}
                      </span>
                    </div>
                  </div>
                </div>
                <!-- 料率プレビュー -->
                <div class="rate-preview">
                  <template v-if="getRateLines(computeWorkerHours(w.startTime, w.endTime, calcBreakMinutes(w.workerRole, w.startTime, w.endTime), isSunday)).length">
                    <div
                      v-for="line in getRateLines(computeWorkerHours(w.startTime, w.endTime, calcBreakMinutes(w.workerRole, w.startTime, w.endTime), isSunday))"
                      :key="line.label"
                      class="rate-line"
                    >
                      <span class="rate-label" :style="{ color: line.color }">{{ line.label }}</span>
                      <span class="rate-hours">{{ line.hours }}h</span>
                      <span class="rate-rate" :style="{ color: line.color }">{{ line.rate }}</span>
                    </div>
                  </template>
                  <span v-else class="rate-empty">—</span>
                </div>
              </div>
              <button type="button" class="btn-ghost-sm" @click="report.addWorker(si)">＋ 作業員を追加</button>
            </Field>

            <!-- 下請け業者 -->
            <Field label="下請け業者">
              <div v-for="(sub, si2) in site.subcontractors" :key="si2" class="row-worker">
                <select v-model="sub.subcontractorName" class="select">
                  <option value="">業者選択</option>
                  <option v-for="name in master.subcontractorNames.value" :key="name" :value="name">{{ name }}</option>
                </select>
                <input v-model.number="sub.count" type="number" min="1" max="20" class="input select--h" placeholder="人数" />
                <button v-if="site.subcontractors.length > 1" type="button" class="btn-icon-sm" @click="report.removeSub(si, si2)">✕</button>
              </div>
              <button type="button" class="btn-ghost-sm" @click="report.addSub(si)">＋ 業者を追加</button>
            </Field>
          </div>

          <!-- ── 交通経費 ── -->
          <div class="sub-section">
            <div class="sub-section-title">交通経費</div>

            <!-- 車両 -->
            <Field label="車両">
              <select :value="siteUsage[si].vehicle" class="select select--usage" @change="(e) => setUsage(si, 'vehicle', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].vehicle === 'あり'">
                <div
                  v-for="(veh, vi) in site.expenses.vehicles"
                  :key="vi"
                  class="vehicle-block"
                >
                  <div class="vehicle-block-header">
                    <span class="vehicle-block-label">車両{{ site.expenses.vehicles.length > 1 ? ` ${vi + 1}` : '' }}</span>
                    <button
                      v-if="site.expenses.vehicles.length > 1"
                      type="button"
                      class="btn-danger-sm"
                      @click="report.removeVehicle(si, vi)"
                    >✕ 削除</button>
                  </div>
                  <input v-model="veh.vehicleName" type="text" class="input" placeholder="車両名（例: ハイエース）" />
                  <div class="expense-grid mt8">
                    <ExpenseField v-model="veh.distanceKm" label="ガソリン（往復km）" />
                    <ExpenseField v-model="veh.dieselKm"   label="軽油（往復km）" />
                    <ExpenseField v-model="veh.parkingYen" label="駐車場（円）" />
                    <ExpenseField v-model="veh.highwayYen" label="高速代（円）" />
                  </div>
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addVehicle(si)">＋ 車両を追加</button>
              </template>
            </Field>

            <!-- 電車 -->
            <Field label="電車">
              <select :value="siteUsage[si].train" class="select select--usage" @change="(e) => setUsage(si, 'train', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].train === 'あり'">
                <div v-for="(tr, ti) in site.expenses.trains" :key="ti" class="lineitems-row">
                  <input v-model="tr.label" type="text" class="input" placeholder="例: 名古屋〜大阪" />
                  <ExpenseField v-model="tr.yen" label="金額" />
                  <button v-if="site.expenses.trains.length > 1" type="button" class="btn-icon-sm" @click="report.removeTrain(si, ti)">✕</button>
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addTrain(si)">＋ 追加</button>
              </template>
            </Field>
          </div>

          <!-- ── 現場経費 ── -->
          <div class="sub-section">
            <div class="sub-section-title">現場経費</div>

            <!-- ホテル -->
            <Field label="ホテル">
              <select :value="siteUsage[si].hotel" class="select select--usage" @change="(e) => setUsage(si, 'hotel', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].hotel === 'あり'">
                <div class="hotel-row mt6">
                  <input v-model="site.expenses.hotelName" type="text" class="input" placeholder="施設名（例: アパホテル）" />
                  <ExpenseField v-model="site.expenses.hotelYen" label="金額" />
                </div>
              </template>
            </Field>

            <!-- レオパレス等 -->
            <Field label="レオパレス等">
              <select :value="siteUsage[si].leopalace" class="select select--usage" @change="(e) => setUsage(si, 'leopalace', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].leopalace === 'あり'">
                <div class="hotel-row mt6">
                  <input v-model="site.expenses.leopalaceName" type="text" class="input" placeholder="施設名" />
                  <ExpenseField v-model="site.expenses.leopalaceYen" label="金額" />
                </div>
              </template>
            </Field>

            <!-- ゴミ -->
            <Field label="ゴミ">
              <select :value="siteUsage[si].garbage" class="select select--usage" @change="(e) => setUsage(si, 'garbage', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].garbage === 'あり'">
                <div class="expense-grid mt6">
                  <ExpenseField v-model="site.expenses.garbageFactoryYen" label="木材のみ（円）" />
                  <ExpenseField v-model="site.expenses.garbageSiteYen"    label="混載（円）" />
                </div>
              </template>
            </Field>

            <!-- その他（資材等） -->
            <Field label="その他（資材等）">
              <select :value="siteUsage[si].other" class="select select--usage" @change="(e) => setUsage(si, 'other', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].other === 'あり'">
                <div v-for="(ot, oi) in site.expenses.others" :key="oi" class="lineitems-row mt6">
                  <input v-model="ot.label" type="text" class="input" placeholder="内容" />
                  <ExpenseField v-model="ot.yen" label="金額" />
                  <button v-if="site.expenses.others.length > 1" type="button" class="btn-icon-sm" @click="report.removeOther(si, oi)">✕</button>
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addOther(si)">＋ 追加</button>
              </template>
            </Field>

            <!-- その他雑経費 -->
            <Field label="その他雑経費">
              <select :value="siteUsage[si].entertainment" class="select select--usage" @change="(e) => setUsage(si, 'entertainment', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].entertainment === 'あり'">
                <div class="lineitems-row mt6">
                  <input v-model="site.expenses.entertainmentLabel" type="text" class="input" placeholder="内容" />
                  <ExpenseField v-model="site.expenses.entertainmentYen" label="金額" />
                </div>
              </template>
            </Field>
          </div>

        </FormSection>

        <!-- 現場追加 -->
        <button type="button" class="btn-add-site" @click="addSite()">
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
import { computeWorkerHours, getRateLines, calcBreakMinutes, TIME_OPTIONS } from '~/utils/workerHours'

const liff   = useLiff()
const master = useMaster()
const report = useReport()

const initializing = ref(true)

// 送信日が日曜かどうか（料率計算に使用）
const isSunday = computed(() =>
  new Date(report.form.value.date + 'T00:00:00').getDay() === 0
)

// ── 各経費セクションの あり/なし 状態（サイトごと） ──
type UsageState = {
  vehicle:       string
  train:         string
  hotel:         string
  leopalace:     string
  garbage:       string
  other:         string
  entertainment: string
}

const createUsage = (): UsageState => ({
  vehicle:       'なし',
  train:         'なし',
  hotel:         'なし',
  leopalace:     'なし',
  garbage:       'なし',
  other:         'なし',
  entertainment: 'なし',
})

const siteUsage = ref<UsageState[]>([createUsage()])

// 「なし」に戻した時に対応する経費データをクリアする
function setUsage(si: number, key: keyof UsageState, value: string) {
  siteUsage.value[si][key] = value
  if (value !== 'なし') return
  const exp = report.form.value.sites[si].expenses
  switch (key) {
    case 'vehicle':
      exp.vehicles = [createVehicle()]
      break
    case 'train':
      exp.trains = [createLineItem()]
      break
    case 'hotel':
      exp.hotelName = undefined; exp.hotelYen = undefined
      break
    case 'leopalace':
      exp.leopalaceName = undefined; exp.leopalaceYen = undefined
      break
    case 'garbage':
      exp.garbageFactoryYen = undefined; exp.garbageSiteYen = undefined
      break
    case 'other':
      exp.others = [createLineItem()]
      break
    case 'entertainment':
      exp.entertainmentLabel = undefined; exp.entertainmentYen = undefined
      break
  }
}

function addSite() {
  report.addSite()
  siteUsage.value.push(createUsage())
}
function removeSite(i: number) {
  report.removeSite(i)
  siteUsage.value.splice(i, 1)
}

onMounted(async () => {
  await liff.init()
  await master.fetch()
  // startTime/endTime が未設定のワーカーにデフォルト値を補完
  report.form.value.sites.forEach(site => {
    site.workers.forEach(w => {
      if (!w.startTime)    w.startTime    = '08:00'
      if (!w.endTime)      w.endTime      = '17:30'
      w.breakMinutes = calcBreakMinutes(w.workerRole, w.startTime, w.endTime)
    })
  })
  initializing.value = false
})

async function handleSubmit() {
  await report.submit()
}

function handleReset() {
  report.reset()
  siteUsage.value = [createUsage()]
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
.form { display: flex; flex-direction: column; gap: 14px; }

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
.select--h     { width: 100%; }
.select--usage { width: 90px; flex-shrink: 0; }
.textarea { resize: vertical; }

/* ── サブセクション ── */
.sub-section {
  margin-top: 6px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 16px;
}
.sub-section-title {
  font-size: 11px; font-weight: 800;
  letter-spacing: 2px; text-transform: uppercase;
  color: var(--text2); margin-bottom: -6px;
}

/* ── 下請け行 ── */
.row-worker {
  display: flex; gap: 8px; margin-bottom: 8px; align-items: flex-end;
}

/* ── 作業員ブロック ── */
.worker-block { margin-bottom: 14px; }
.worker-name-row {
  display: flex; gap: 6px; align-items: center; margin-top: 4px;
}
.worker-name-row .select { flex: 1; }

/* ── 時刻・休憩行 ── */
.worker-time-rows { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.worker-time-row  { display: flex; gap: 6px; align-items: flex-end; }
.worker-time-row .time-field { flex: 1; }
.worker-break-row .time-field { width: 140px; }
.time-field {
  display: flex; flex-direction: column; gap: 3px;
}
.time-sep {
  font-size: 16px; color: var(--text2); padding-bottom: 11px; flex-shrink: 0;
}

/* ── 料率プレビュー ── */
.rate-preview {
  margin-top: 6px;
  background: #f8f9fa;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 4px 10px;
  align-items: center;
}
.rate-line   { display: contents; }
.rate-label  { white-space: nowrap; font-size: 11px; font-weight: 700; }
.rate-hours  { text-align: right; font-size: 14px; font-weight: 800; color: var(--text); }
.rate-rate   { font-size: 11px; font-weight: 600; }
.rate-empty  { font-size: 12px; color: var(--text2); grid-column: 1 / -1; }

/* ── 共通: 小ラベル ── */
.hours-label {
  font-size: 10px; color: var(--text2); font-weight: 600;
  white-space: nowrap;
}

/* ── ロールトグル ── */
.role-toggle {
  display: flex; gap: 0;
  border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
}
.role-btn {
  flex: 1; padding: 5px 0; font-size: 11px; font-family: var(--font);
  background: var(--surface2); color: var(--text2); border: none; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.role-btn:first-child { border-right: 1px solid var(--border); }
.role-btn.active { background: var(--accent); color: #fff; font-weight: 700; }

/* ── 経費リスト ── */
.expense-list { display: flex; flex-direction: column; gap: 12px; }
.expense-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.mt6  { margin-top: 6px; }
.mt8  { margin-top: 8px; }

/* ── 車両ブロック ── */
.vehicle-block {
  border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; display: flex; flex-direction: column; gap: 8px;
  background: var(--surface2); margin-top: 8px;
}
.vehicle-block-header {
  display: flex; align-items: center; justify-content: space-between;
}
.vehicle-block-label { font-size: 12px; font-weight: 700; color: var(--text2); }

/* ── その他共通経費 ── */
.hotel-row { display: flex; flex-direction: column; gap: 6px; }
.lineitems-row { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 6px; }
.lineitems-row .input { flex: 1; }
.lineitems-row .expense-item { width: 110px; flex-shrink: 0; }

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
  .worker-hours-row { flex-wrap: wrap; }
}
</style>
