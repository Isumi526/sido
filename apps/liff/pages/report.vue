<template>
  <div class="app">
    <AppNav subtitle="日報" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <main class="main">
      <!-- ローディング -->
      <div v-if="initializing" class="state-screen">
        <div class="spinner" />
        <p class="state-text">読み込み中...</p>
      </div>

      <!-- 全日送信済み -->
      <div v-else-if="allSubmitted" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">送信済みです</h2>
        <p class="state-text">今日までの日報はすべて送信済みです</p>
        <button class="btn-history" @click="navigateTo('/history')">日報履歴を見る</button>
        <button class="btn-calendar" @click="navigateTo('/calendar')">予定を見る</button>
      </div>

      <!-- 送信完了 / 更新完了 -->
      <div v-else-if="report.submitted.value || editSubmitted" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">{{ editSubmitted ? '更新しました！' : '送信完了！' }}</h2>
        <p class="state-text">{{ editSubmitted ? '日報を更新しました' : 'LINEグループに通知しました' }}</p>
        <button v-if="!editSubmitted && nextUnsubmittedDate" class="btn-primary" @click="goToNextReport">
          {{ nextDateLabel }}の日報を入力する →
        </button>
        <button class="btn-history" @click="navigateTo('/history')">{{ editSubmitted ? '履歴に戻る' : '日報履歴を見る' }}</button>
      </div>

      <!-- フォーム -->
      <form v-else @submit.prevent="handleSubmit" class="form">

        <!-- 編集モードバナー -->
        <div v-if="isEditMode" class="edit-banner">
          ✏️ 過去の日報を編集中
        </div>

        <!-- 日付 -->
        <FormSection num="01" title="日付">
          <div class="date-fixed">{{ report.form.value.date }}</div>
          <div v-if="report.form.value.date < new Date().toISOString().split('T')[0]" class="past-date-notice">
            過去の未送信日報です。<br>休み等だった場合は、「稼働なし」を選択して送信してください。
          </div>
        </FormSection>

        <!-- 稼働有無 -->
        <FormSection num="02" title="稼働有無">
          <select v-model="isWorkingStr" class="select" required>
            <option value="working">稼働あり</option>
            <option value="off">稼働なし（休み・移動日等）</option>
          </select>
        </FormSection>

        <!-- 現場ブロック（稼働ありの場合のみ表示） -->
        <template v-if="isWorkingStr === 'working'">

        <!-- 現場ブロック -->
        <FormSection
          v-for="(site, si) in report.form.value.sites"
          :key="si"
          :num="String(si + 3).padStart(2, '0')"
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
              <option value="__other__">＋ 新しい現場を登録する</option>
            </select>
            <input
              v-if="site.siteName === '__other__'"
              v-model="site.customSiteName"
              type="text"
              class="input mt6"
              placeholder="現場名を入力（例: 渋谷プロジェクト）"
              required
            />
          </Field>

          <!-- ── 稼働（現場選択後に表示） ── -->
          <template v-if="site.siteName && site.siteName !== '__other__' || site.siteName === '__other__' && site.customSiteName">
          <div class="sub-section">

            <!-- 作業員（ログインユーザー固定） -->
            <Field>
              <!-- 時刻・休憩 -->
              <template v-if="site.workers[0]">
                <div class="worker-time-rows">
                  <div class="worker-time-row">
                    <div class="time-field">
                      <label class="hours-label">開始</label>
                      <select v-model="site.workers[0].startTime" class="select">
                        <option v-for="t in startTimeOptionsForSite(si)" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                    <span class="time-sep">〜</span>
                    <div class="time-field">
                      <label class="hours-label">終了</label>
                      <select v-model="site.workers[0].endTime" class="select">
                        <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="worker-break-row">
                    <div class="time-field">
                      <label class="hours-label">休憩</label>
                      <span class="break-auto">
                        {{ calcBreakMinutes(site.workers[0].workerRole, site.workers[0].startTime, site.workers[0].endTime) === 0
                          ? 'なし'
                          : calcBreakMinutes(site.workers[0].workerRole, site.workers[0].startTime, site.workers[0].endTime) + '分（自動）' }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- 料率プレビュー（現場跨ぎ累積対応） -->
                <div class="rate-preview">
                  <template v-if="sitePreviewBreakdowns[si] && getRateLines(sitePreviewBreakdowns[si]).length">
                    <div
                      v-for="line in getRateLines(sitePreviewBreakdowns[si])"
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
              </template>
            </Field>

            <!-- 下請け業者 -->
            <Field label="下請け業者">
              <div v-for="(sub, si2) in site.subcontractors" :key="si2">
                <div class="row-worker">
                  <select v-model="sub.subcontractorName" class="select" :class="{ 'select--error': sub.subcontractorName === '' }">
                    <option value="" disabled>業者を選択 *</option>
                    <option v-for="name in master.subcontractorNames.value" :key="name" :value="name">{{ name }}</option>
                    <option value="__other__">その他（新規追加）</option>
                  </select>
                  <input v-model.number="sub.count" type="number" min="1" max="20" class="input select--h" placeholder="人数" />
                  <button type="button" class="btn-icon-sm" @click="report.removeSub(si, si2)">✕</button>
                </div>
                <input
                  v-if="sub.subcontractorName === '__other__'"
                  v-model="sub.customSubcontractorName"
                  class="input"
                  placeholder="業者名を入力 *"
                  style="margin-top: -4px; margin-bottom: 8px;"
                />
              </div>
              <button type="button" class="btn-ghost-sm" @click="report.addSub(si)">＋ 業者を追加</button>
            </Field>
          </div>

          <!-- 経費有無 -->
          <Field label="経費">
            <select :value="siteUsage[si].expense" class="select select--usage" @change="(e) => setUsage(si, 'expense', (e.target as HTMLSelectElement).value)">
              <option value="なし">なし</option>
              <option value="あり">あり</option>
            </select>
          </Field>

          <!-- ── 交通経費 ── -->
          <div v-if="siteUsage[si].expense === 'あり'" class="sub-section">
            <div class="sub-section-title">交通経費</div>

            <!-- 車両 -->
            <Field label="車両">
              <p class="vehicle-note">鍵を持ち出した人が「あり」を選択し詳細を記入してください</p>
              <select :value="siteUsage[si].vehicle" class="select select--usage" @change="(e) => setUsage(si, 'vehicle', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
                <option value="乗合い">乗合い</option>
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
                  <!-- ETCカード -->
                  <div class="mt8">
                    <label class="hours-label">ETCカード</label>
                    <select v-model="veh.etcCard" class="select mt4" @change="veh.etcUsed = !!veh.etcCard">
                      <option value="">なし</option>
                      <option v-for="n in 7" :key="n" :value="`カード${['①','②','③','④','⑤','⑥','⑦'][n-1]}`">
                        カード{{ ['①','②','③','④','⑤','⑥','⑦'][n-1] }}
                      </option>
                    </select>
                  </div>
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addVehicle(si)">＋ 車両を追加</button>
                <div class="mt8">
                  <label class="hours-label">領収書・写真（JPEG/PDF）</label>
                  <input type="file" accept="image/*,.pdf" multiple class="input mt6" @change="(e) => handleExpenseFile(si, 'vehicleFiles', e)" />
                  <div v-if="site.expenses.vehicleFiles?.length" class="photo-preview">
                    <span class="hours-label">{{ site.expenses.vehicleFiles.length }}件選択済み</span>
                  </div>
                </div>
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
                <div class="mt8">
                  <label class="hours-label">領収書（JPEG/PDF）</label>
                  <input type="file" accept="image/*,.pdf" multiple class="input mt6" @change="(e) => handleExpenseFile(si, 'trainFiles', e)" />
                  <div v-if="site.expenses.trainFiles?.length" class="photo-preview">
                    <span class="hours-label">{{ site.expenses.trainFiles.length }}件選択済み</span>
                  </div>
                </div>
              </template>
            </Field>
          </div>

          <!-- ── 現場経費 ── -->
          <div v-if="siteUsage[si].expense === 'あり'" class="sub-section">
            <div class="sub-section-title">現場経費</div>

            <!-- ホテル -->
            <Field label="ホテル">
              <select :value="siteUsage[si].hotel" class="select select--usage" @change="(e) => setUsage(si, 'hotel', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].hotel === 'あり'">
                <div class="mt6">
                  <label class="hours-label">領収書（JPEG/PDF）</label>
                  <input type="file" accept="image/*,.pdf" multiple class="input mt6" @change="(e) => handleExpenseFile(si, 'hotelFiles', e)" />
                  <div v-if="site.expenses.hotelFiles?.length" class="photo-preview">
                    <span class="hours-label">{{ site.expenses.hotelFiles.length }}件選択済み</span>
                    <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-hotelFiles`" @click="analyzeReceipt(si, 'hotelFiles')">
                      {{ receipt.loading.value === `${si}-hotelFiles` ? '解析中...' : '✨ AI解析' }}
                    </button>
                  </div>
                </div>
                <div class="hotel-row mt6">
                  <input v-model="site.expenses.hotelName" type="text" class="input" placeholder="施設名（例: アパホテル）" />
                  <ExpenseField v-model="site.expenses.hotelYen" label="金額" />
                </div>
                <input v-model="site.expenses.hotelRegistration" type="text" class="input mt6" placeholder="登録番号（ない場合はなしと記入）" />
              </template>
            </Field>

            <!-- レオパレス等 -->
            <Field label="レオパレス等">
              <select :value="siteUsage[si].leopalace" class="select select--usage" @change="(e) => setUsage(si, 'leopalace', (e.target as HTMLSelectElement).value)">
                <option value="なし">なし</option>
                <option value="あり">あり</option>
              </select>
              <template v-if="siteUsage[si].leopalace === 'あり'">
                <div class="mt6">
                  <label class="hours-label">領収書（JPEG/PDF）</label>
                  <input type="file" accept="image/*,.pdf" multiple class="input mt6" @change="(e) => handleExpenseFile(si, 'leopalaceFiles', e)" />
                  <div v-if="site.expenses.leopalaceFiles?.length" class="photo-preview">
                    <span class="hours-label">{{ site.expenses.leopalaceFiles.length }}件選択済み</span>
                    <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-leopalaceFiles`" @click="analyzeReceipt(si, 'leopalaceFiles')">
                      {{ receipt.loading.value === `${si}-leopalaceFiles` ? '解析中...' : '✨ AI解析' }}
                    </button>
                  </div>
                </div>
                <div class="hotel-row mt6">
                  <input v-model="site.expenses.leopalaceName" type="text" class="input" placeholder="施設名" />
                  <ExpenseField v-model="site.expenses.leopalaceYen" label="金額" />
                </div>
                <input v-model="site.expenses.leopalaceRegistration" type="text" class="input mt6" placeholder="登録番号（ない場合はなしと記入）" />
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
                  <ExpenseField v-model="site.expenses.garbageFactoryM3" label="木材のみ（m³）" />
                  <ExpenseField v-model="site.expenses.garbageSiteM3"    label="混載（m³）" />
                </div>
                <div v-if="site.expenses.garbageFactoryM3 || site.expenses.garbageSiteM3" class="mt8">
                  <label class="hours-label">ゴミ写真（任意）</label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    class="input mt6"
                    @change="(e) => handleGarbagePhoto(si, e)"
                  />
                  <div v-if="site.expenses.garbagePhotos?.length" class="photo-preview">
                    <span class="hours-label">{{ site.expenses.garbagePhotos.length }}枚選択済み</span>
                  </div>
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
                <div class="mt6">
                  <label class="hours-label">領収書・写真（JPEG/PDF）</label>
                  <input type="file" accept="image/*,.pdf" multiple class="input mt6" @change="(e) => handleExpenseFile(si, 'otherFiles', e)" />
                  <div v-if="site.expenses.otherFiles?.length" class="photo-preview">
                    <span class="hours-label">{{ site.expenses.otherFiles.length }}件選択済み</span>
                    <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-otherFiles`" @click="analyzeReceipt(si, 'otherFiles', 0)">
                      {{ receipt.loading.value === `${si}-otherFiles` ? '解析中...' : '✨ AI解析' }}
                    </button>
                  </div>
                </div>
                <div v-for="(ot, oi) in site.expenses.others" :key="oi" class="lineitems-row mt6">
                  <input v-model="ot.label" type="text" class="input" placeholder="内容" />
                  <ExpenseField v-model="ot.yen" label="金額" />
                  <button v-if="site.expenses.others.length > 1" type="button" class="btn-icon-sm" @click="report.removeOther(si, oi)">✕</button>
                  <input v-model="ot.registrationNumber" type="text" class="input mt6" placeholder="登録番号（ない場合はなしと記入）" />
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
                <div class="mt6">
                  <label class="hours-label">領収書（JPEG/PDF）</label>
                  <input type="file" accept="image/*,.pdf" multiple class="input mt6" @change="(e) => handleExpenseFile(si, 'entertainmentFiles', e)" />
                  <div v-if="site.expenses.entertainmentFiles?.length" class="photo-preview">
                    <span class="hours-label">{{ site.expenses.entertainmentFiles.length }}件選択済み</span>
                    <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-entertainmentFiles`" @click="analyzeReceipt(si, 'entertainmentFiles')">
                      {{ receipt.loading.value === `${si}-entertainmentFiles` ? '解析中...' : '✨ AI解析' }}
                    </button>
                  </div>
                </div>
                <div class="lineitems-row mt6">
                  <input v-model="site.expenses.entertainmentLabel" type="text" class="input" placeholder="内容" />
                  <ExpenseField v-model="site.expenses.entertainmentYen" label="金額" />
                </div>
                <input v-model="site.expenses.entertainmentRegistration" type="text" class="input mt6" placeholder="登録番号（ない場合はなしと記入）" />
              </template>
            </Field>
          </div>
          </template><!-- /現場選択後に表示 -->

        </FormSection>

        <!-- 現場追加 -->
        <button type="button" class="btn-add-site" @click="addSite()">
          <span class="btn-add-site__icon">＋</span>
          <span class="btn-add-site__text">
            {{ report.form.value.sites.length + 1 }}個目の現場を追加する
          </span>
        </button>

        </template><!-- /isWorkingStr === 'working' -->

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
        <div v-if="report.error.value || editError" class="error-banner">
          ⚠️ {{ report.error.value || editError }}
        </div>

        <!-- LINEプレビュー -->
        <div v-if="!isEditMode" class="line-preview">
          <div class="line-preview-label">📲 LINE プレビュー</div>
          <pre class="line-preview-body">{{ linePreview }}</pre>
        </div>

        <!-- 送信ボタン -->
        <button v-if="isDev && !isEditMode" type="button" class="btn-dev" @click="fillTestData">🔧 テストデータ入力</button>
        <button v-if="isDev" type="button" class="btn-dev" :class="{ 'btn-dev--error': forceErrorOnSubmit }" @click="fillErrorTestData">
          {{ forceErrorOnSubmit ? '🚨 次の送信でエラー発火（キャンセルするには再クリック）' : '🚨 エラーテストデータ入力' }}
        </button>
        <button type="submit" class="btn-submit" :disabled="isEditMode ? editSubmitting : report.submitting.value">
          <span v-if="isEditMode ? editSubmitting : report.submitting.value" class="submitting">
            <span class="dot-spin" />{{ isEditMode ? '更新中...' : '送信中...' }}
          </span>
          <span v-else>{{ isEditMode ? '日報を更新する →' : '日報を送信する →' }}</span>
        </button>

      </form>
    </main>

    <!-- AI解析トースト -->
    <Transition name="toast">
      <div v-if="receiptToast" class="receipt-toast" :class="receiptToast.type">
        <span class="material-symbols-rounded receipt-toast-icon">
          {{ receiptToast.type === 'success' ? 'check_circle' : 'error' }}
        </span>
        <span class="receipt-toast-msg">{{ receiptToast.message }}</span>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computeWorkerHours, getRateLines, calcBreakMinutes, parseMin, TIME_OPTIONS } from '~/utils/workerHours'
import type { RateBreakdown } from '~/utils/workerHours'
import { computeDiff } from '~/utils/diffReport'
import type { User } from '~/types'

const config  = useRuntimeConfig()
const route   = useRoute()
const liff    = useLiff()
const master  = useMaster()
const report  = useReport()
const expense  = useExpense()
const receipt  = useReceiptAnalysis()

const currentUser = ref<User | null>(null)

const isDev = computed(() => config.public.appEnv === 'development' || liff.isTester.value)

const initializing = ref(true)

// 編集モード
const forceErrorOnSubmit = ref(false)
const isEditMode      = ref(false)
const originalReport  = ref<any>(null)  // 編集前のSupabaseデータ（差分計算用）
const editSubmitting  = ref(false)
const editSubmitted   = ref(false)
const editError       = ref<string | null>(null)

// AI解析トースト
const receiptToast = ref<{ type: 'success' | 'error'; message: string } | null>(null)
let receiptToastTimer: ReturnType<typeof setTimeout> | null = null
function showReceiptToast(type: 'success' | 'error', message: string) {
  if (receiptToastTimer) clearTimeout(receiptToastTimer)
  receiptToast.value = { type, message }
  receiptToastTimer = setTimeout(() => { receiptToast.value = null }, 4000)
}

// 全送信済み状態
const allSubmitted = ref(false)

// 送信後の次の未送信日
const nextUnsubmittedDate = ref<string | null>(null)

const nextDateLabel = computed(() => {
  if (!nextUnsubmittedDate.value) return ''
  const d = new Date(nextUnsubmittedDate.value + 'T00:00:00')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`
})

// 稼働有無
const isWorkingStr = ref<'working' | 'off'>('working')

// 送信日が日曜かどうか（料率計算に使用）
const isSunday = computed(() =>
  new Date(report.form.value.date + 'T00:00:00').getDay() === 0
)

// 現場跨ぎ残業対応: 各現場の workers[0] のプレビュー用 breakdown（startTime 順で累積）
const sitePreviewBreakdowns = computed((): Record<number, RateBreakdown> => {
  const sites  = report.form.value.sites
  const sun    = isSunday.value
  const accum: Record<string, number> = {}
  const result: Record<number, RateBreakdown> = {}

  const entries = sites
    .map((site, si) => ({ si, w: site.workers[0] }))
    .filter(e => !!e.w)

  entries.sort((a, b) =>
    parseMin(a.w?.startTime || '08:00') - parseMin(b.w?.startTime || '08:00')
  )

  for (const { si, w } of entries) {
    const key = w.workerId || w.workerName || `site-${si}`
    const brk = calcBreakMinutes(w.workerRole, w.startTime, w.endTime)
    const { workedMin, ...breakdown } = computeWorkerHours(w.startTime, w.endTime, brk, sun, accum[key] ?? 0)
    accum[key] = workedMin
    result[si] = breakdown
  }

  return result
})

// ── 各経費セクションの あり/なし 状態（サイトごと） ──
type UsageState = {
  expense:       string
  vehicle:       string
  train:         string
  hotel:         string
  leopalace:     string
  garbage:       string
  other:         string
  entertainment: string
}

const createUsage = (): UsageState => ({
  expense:       'なし',
  vehicle:       'なし',
  train:         'なし',
  hotel:         'なし',
  leopalace:     'なし',
  garbage:       'なし',
  other:         'なし',
  entertainment: 'なし',
})

const siteUsage = ref<UsageState[]>([createUsage()])

// 保存済み経費データから あり/なし 状態を復元する
function reconstructExpenseUsage(exp: any): UsageState {
  const usage = createUsage()
  if (!exp) return usage
  if (exp.carpool) {
    usage.vehicle = '乗合い'
  } else if ((exp.vehicles ?? []).some((v: any) => v.vehicleName || v.distanceKm || v.dieselKm || v.parkingYen || v.highwayYen)) {
    usage.vehicle = 'あり'
  }
  if ((exp.trains ?? []).some((t: any) => t.yen)) usage.train = 'あり'
  if (exp.hotelYen)                                usage.hotel = 'あり'
  if (exp.leopalaceYen)                            usage.leopalace = 'あり'
  if (exp.garbageFactoryM3 || exp.garbageSiteM3)  usage.garbage = 'あり'
  if ((exp.others ?? []).some((o: any) => o.yen || o.label)) usage.other = 'あり'
  if (exp.entertainmentYen)                        usage.entertainment = 'あり'
  // いずれかの経費があれば expense = あり
  if (usage.vehicle !== 'なし' || usage.train !== 'なし' || usage.hotel !== 'なし' ||
      usage.leopalace !== 'なし' || usage.garbage !== 'なし' ||
      usage.other !== 'なし' || usage.entertainment !== 'なし')
    usage.expense = 'あり'
  return usage
}

// Supabaseから日報を読み込んでフォームに反映する
async function loadEditData(date: string) {
  const uid = liff.profile.value?.userId
  if (!uid) return
  const saved = await expense.getReport(uid, date)
  if (!saved) return

  originalReport.value = saved  // 差分計算のために保存

  report.form.value.date = saved.date
  isWorkingStr.value = saved.is_working ? 'working' : 'off'
  report.form.value.note = saved.note ?? ''

  if (saved.sites && saved.sites.length > 0) {
    report.form.value.sites = saved.sites.map((site: any) => ({
      siteName:       site.siteName ?? '',
      customSiteName: site.customSiteName,
      workers: (site.workers ?? []).length > 0
        ? site.workers
        : [{
            ...createWorker(currentUser.value?.worker_role ?? 'site'),
            workerName: currentUser.value?.real_name ?? '',
            workerRole: currentUser.value?.worker_role ?? 'site',
          }],
      expenses: {
        vehicles: [createVehicle()],
        trains:   [createLineItem()],
        others:   [createLineItem()],
        ...(site.expenses ?? {}),
      },
      subcontractors: site.subcontractors ?? [],
    }))
    siteUsage.value = report.form.value.sites.map((site: any) =>
      reconstructExpenseUsage(site.expenses)
    )
  }
}

// 「なし」に戻した時に対応する経費データをクリアする
function setUsage(si: number, key: keyof UsageState, value: string) {
  siteUsage.value[si][key] = value
  const exp = report.form.value.sites[si].expenses
  if (key === 'vehicle') {
    if (value === '乗合い') {
      exp.carpool = true
      exp.vehicles = []
      exp.vehicleFiles = undefined
    } else if (value === 'あり') {
      exp.carpool = false
      if (!exp.vehicles.length) exp.vehicles = [createVehicle()]
    } else {
      exp.carpool = false
      exp.vehicles = [createVehicle()]
      exp.vehicleFiles = undefined
    }
    return
  }
  if (value !== 'なし') return
  switch (key) {
    case 'train':
      exp.trains = [createLineItem()]; exp.trainFiles = undefined
      break
    case 'hotel':
      exp.hotelName = undefined; exp.hotelYen = undefined; exp.hotelRegistration = undefined; exp.hotelFiles = undefined
      break
    case 'leopalace':
      exp.leopalaceName = undefined; exp.leopalaceYen = undefined; exp.leopalaceRegistration = undefined; exp.leopalaceFiles = undefined
      break
    case 'garbage':
      exp.garbageFactoryM3 = undefined; exp.garbageSiteM3 = undefined; exp.garbagePhotos = undefined
      break
    case 'other':
      exp.others = [createLineItem()]; exp.otherFiles = undefined
      break
    case 'entertainment':
      exp.entertainmentLabel = undefined; exp.entertainmentYen = undefined; exp.entertainmentRegistration = undefined; exp.entertainmentFiles = undefined
      break
  }
}

/** 全サイトのworkers[0]をログインユーザーで上書き */
function initWorkers() {
  if (!currentUser.value) return
  report.form.value.sites.forEach(site => {
    site.workers = [{
      ...createWorker(currentUser.value!.worker_role),
      workerName: currentUser.value!.real_name,
      workerRole: currentUser.value!.worker_role,
    }]
  })
}

function addSite() {
  // 追加前に前現場の終了時刻を取得（日跨ぎでなければ次現場の開始時刻に使う）
  const sites = report.form.value.sites
  const prevWorker   = sites.length > 0 ? sites[sites.length - 1].workers[0] : null
  const prevEndTime  = prevWorker?.endTime
  const prevStartMin = parseMin(prevWorker?.startTime || '08:00')
  const prevEndMin   = parseMin(prevEndTime           || '17:30')
  const autoStart    = (prevEndTime && prevEndMin > prevStartMin) ? prevEndTime : undefined
  // 終了時刻 = 開始時刻 + 4h（23:30 を上限）
  const autoEndMin   = autoStart ? Math.min(prevEndMin + 240, 23 * 60 + 30) : undefined
  const autoEnd      = autoEndMin != null
    ? `${String(Math.floor(autoEndMin / 60)).padStart(2, '0')}:${autoEndMin % 60 === 0 ? '00' : '30'}`
    : undefined

  report.addSite()
  siteUsage.value.push(createUsage())
  if (currentUser.value) {
    const newSite = report.form.value.sites[report.form.value.sites.length - 1]
    newSite.workers = [{
      ...createWorker(currentUser.value.worker_role),
      workerName: currentUser.value.real_name,
      workerRole: currentUser.value.worker_role,
      // 2つ目以降: 開始=前現場の終了、終了=開始+4h
      ...(autoStart ? { startTime: autoStart, endTime: autoEnd } : {}),
    }]
  }
}

/** 開始時刻のオプション: si>0 の場合は前現場の終了時刻より前を除外（日跨ぎ除く） */
function startTimeOptionsForSite(si: number): string[] {
  if (si === 0) return TIME_OPTIONS
  const prev = report.form.value.sites[si - 1]?.workers[0]
  if (!prev) return TIME_OPTIONS
  const prevEndMin   = parseMin(prev.endTime   || '17:30')
  const prevStartMin = parseMin(prev.startTime  || '08:00')
  if (prevEndMin <= prevStartMin) return TIME_OPTIONS  // 日跨ぎは制限なし
  return TIME_OPTIONS.filter(t => parseMin(t) >= prevEndMin)
}
function removeSite(i: number) {
  report.removeSite(i)
  siteUsage.value.splice(i, 1)
}

onMounted(async () => {
  const masterPromise = master.fetch()
  if (!liff.initialized.value) await liff.init()

  // ユーザー登録チェック（キャッシュあれば即座。未登録でもフォームは使えるが経費PDFに名前が出ない）
  const userId = liff.profile.value?.userId
  if (userId) {
    currentUser.value = await expense.getUser(userId)
    if (!currentUser.value) {
      await navigateTo('/register')
      return
    }
    initWorkers()
  }

  await masterPromise

  // 編集モード: ?edit=YYYY-MM-DD
  const editDate = route.query.edit as string | undefined
  if (editDate) {
    isEditMode.value = true
    await loadEditData(editDate)
  } else if (userId) {
    // 新規モード: 最初の未送信日を自動セット
    const nextDate = await expense.getNextUnsubmittedDate(userId)
    if (nextDate === null) {
      // null = サービス開始日が設定済み かつ 全送信済み
      allSubmitted.value = true
    } else if (nextDate !== 'NOT_CONFIGURED') {
      // 未送信日が見つかった場合はその日付をセット
      report.form.value.date = nextDate
    }
    // 'NOT_CONFIGURED' の場合はデフォルト（今日）のまま
  }

  initializing.value = false
})

// ── LINE通知プレビュー ──────────────────────────────────────
const linePreview = computed(() => {
  const form      = report.form.value
  const isWorking = isWorkingStr.value === 'working'
  const d         = new Date(form.date + 'T00:00:00')
  const weekdays  = ['日', '月', '火', '水', '木', '金', '土']
  const dateLabel = `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`
  const sunday    = d.getDay() === 0

  const lines: string[] = [
    `📋 ${dateLabel} 日報`,
    `👤 ${currentUser.value?.real_name || '（未登録）'}`,
    '─────────────────',
  ]

  if (!isWorking) {
    if (form.note) lines.push(`\n📝 ${form.note}`)
    else           lines.push('\n稼働なし')
    return lines.join('\n')
  }

  for (const site of form.sites) {
    if (!site.siteName) continue
    const displayName = site.siteName === '__other__'
      ? (site.customSiteName || '新規現場')
      : site.siteName
    lines.push('', `📍 ${displayName}`)

    // 稼働時間（名前なし・時間のみ）
    const workers = (site.workers || []).filter((w: any) => w.workerName)
    if (workers.length > 0) {
      for (const w of workers) {
        const brk = calcBreakMinutes(w.workerRole || 'site', w.startTime || '08:00', w.endTime || '17:30')
        const h   = computeWorkerHours(w.startTime || '08:00', w.endTime || '17:30', brk, sunday)
        const parts: string[] = []
        if (h.hoursNormal)        parts.push(`${h.hoursNormal}h`)
        if (h.hoursSunday)        parts.push(`休日${h.hoursSunday}h`)
        if (h.hoursOT)            parts.push(`残業${h.hoursOT}h`)
        if (h.hoursNight)         parts.push(`深夜${h.hoursNight}h`)
        if (h.hoursOTNight)       parts.push(`深夜残業${h.hoursOTNight}h`)
        if (h.hoursSundayOT)      parts.push(`休日残業${h.hoursSundayOT}h`)
        if (h.hoursSundayNight)   parts.push(`休日深夜${h.hoursSundayNight}h`)
        if (h.hoursSundayOTNight) parts.push(`休日深夜残業${h.hoursSundayOTNight}h`)
        if (parts.length) lines.push('・' + parts.join(' + '))
      }
    }

    // 経費
    const exp = site.expenses || {}
    const expLines: string[] = []
    if (exp.carpool) {
      expLines.push('乗合い')
    } else {
      for (const v of (exp.vehicles || [])) {
        if (!v) continue
        const p: string[] = []
        if (v.vehicleName) p.push(v.vehicleName)
        if (v.distanceKm)  p.push(`往復${v.distanceKm}km`)
        if (v.dieselKm)    p.push(`軽油${v.dieselKm}km`)
        if (v.parkingYen)  p.push(`駐車¥${Number(v.parkingYen).toLocaleString()}`)
        if (v.highwayYen)  p.push(`高速¥${Number(v.highwayYen).toLocaleString()}`)
        if (v.etcUsed)     p.push(`ETC${v.etcCard || ''}`)
        if (p.length) expLines.push(p.join(' '))
      }
    }
    for (const t of (exp.trains || []))
      if (t?.yen) expLines.push(`${t.label || '電車'} ¥${Number(t.yen).toLocaleString()}`)
    for (const o of (exp.others || []))
      if (o?.yen) expLines.push(`${o.label || 'その他'} ¥${Number(o.yen).toLocaleString()}`)
    if (exp.hotelYen)
      expLines.push(`${exp.hotelName || 'ホテル'} ¥${Number(exp.hotelYen).toLocaleString()}`)
    if (exp.leopalaceYen)
      expLines.push(`${exp.leopalaceName || 'レオパレス'} ¥${Number(exp.leopalaceYen).toLocaleString()}`)
    if (exp.garbageFactoryM3 || exp.garbageSiteM3) {
      const g: string[] = []
      if (exp.garbageFactoryM3) g.push(`木材のみ ${exp.garbageFactoryM3}m³`)
      if (exp.garbageSiteM3)    g.push(`混載 ${exp.garbageSiteM3}m³`)
      expLines.push(`ゴミ ${g.join(' ')}`)
    }
    if (exp.entertainmentYen)
      expLines.push(`${exp.entertainmentLabel || '雑経費'} ¥${Number(exp.entertainmentYen).toLocaleString()}`)
    if (expLines.length) { expLines.forEach(l => lines.push(`・${l}`)) }

    // 下請け業者
    const subs = (site.subcontractors || []).filter((s: any) => s.subcontractorName)
    if (subs.length) {
      subs.forEach((s: any) => {
        const name = s.subcontractorName === '__other__' ? (s.customSubcontractorName || '新規業者') : s.subcontractorName
        lines.push(`・${name} ${s.count || 1}人`)
      })
    }
  }

  if (form.note) lines.push(`\n📝 ${form.note}`)
  return lines.join('\n')
})

/** [dev] エラーテストデータ入力 + 次の送信でエラーを強制発火 */
function fillErrorTestData() {
  if (forceErrorOnSubmit.value) {
    // 2回押したらキャンセル
    forceErrorOnSubmit.value = false
    return
  }
  fillTestData()
  forceErrorOnSubmit.value = true
}

/** LINEグループにエラーを通知する（fire-and-forget） */
function notifyErrorToLine(actionName: string, errorMsg: string) {
  const efUrl = config.public.edgeFunctionUrl
  if (!efUrl) return
  const fnPrefix = config.public.appEnv === 'development' ? 'test-' : ''
  fetch(`${efUrl}/${fnPrefix}notify-error`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      sender:     currentUser.value?.real_name || '不明',
      date:       report.form.value.date,
      actionName,
      error:      errorMsg,
    }),
  }).catch(() => {})
}

async function handleSubmit() {
  report.form.value.isWorking = isWorkingStr.value === 'working'

  // ── 編集モード: Supabase のみ更新（GAS には再送しない）──
  if (isEditMode.value) {
    if (editSubmitting.value) return
    editSubmitting.value = true
    editError.value = null
    try {
      const uid = liff.profile.value?.userId
      if (!uid) throw new Error('ログイン情報が取得できませんでした。再読み込みしてください。')

      if (forceErrorOnSubmit.value) {
        forceErrorOnSubmit.value = false
        throw new Error('[テスト] Supabase保存エラー: connection timeout')
      }

      await expense.saveReport(uid, {
        date:      report.form.value.date,
        isWorking: report.form.value.isWorking,
        sites:     report.form.value.sites,
        note:      report.form.value.note,
      })

      // 差分を計算してLINEグループに通知
      const efUrl = config.public.edgeFunctionUrl
      if (originalReport.value && efUrl) {
        const diffs = computeDiff(originalReport.value, {
          isWorking: report.form.value.isWorking,
          sites:     report.form.value.sites,
          note:      report.form.value.note,
        })
        if (diffs.length > 0) {
          const now = new Date()
          const editedAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          const fnPrefix = config.public.appEnv === 'development' ? 'test-' : ''
          fetch(`${efUrl}/${fnPrefix}notify-edit`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              sender:   currentUser.value?.real_name || '',
              date:     report.form.value.date,
              editedAt,
              diffs,
            }),
          }).catch(e => console.error('[Edit] LINE通知エラー:', e))
        }
      }

      editSubmitted.value = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新に失敗しました'
      editError.value = msg
      notifyErrorToLine('日報編集', msg)
    } finally {
      editSubmitting.value = false
    }
    return
  }

  // ── 新規送信 ──
  if (currentUser.value) {
    report.form.value.sender   = currentUser.value.real_name
    report.form.value.senderId = liff.profile.value?.userId ?? ''
  }

  if (forceErrorOnSubmit.value) {
    forceErrorOnSubmit.value = false
    editError.value = '[テスト] GAS送信エラー: network request failed'
    notifyErrorToLine('日報新規送信（テスト）', 'network request failed')
    return
  }

  // ① Supabaseに先に保存（画面を閉じてもデータが消えないよう順序を優先）
  const uid = liff.profile.value?.userId
  if (uid) {
    try {
      await expense.saveReport(uid, {
        date:      report.form.value.date,
        isWorking: report.form.value.isWorking,
        sites:     report.form.value.sites,
        note:      report.form.value.note,
      })
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? e ?? 'Supabase保存エラー')
      console.error('[Report] Supabase保存エラー:', e)
      notifyErrorToLine('日報新規送信（DB保存）', msg)
      if (msg.includes('ユーザーが登録されていません') || msg.includes('foreign key')) {
        expense.clearUserCache(uid)
        currentUser.value = null
        await navigateTo('/register')
        return
      }
      // DB保存失敗でもGAS送信は続行（LINE通知は止めない）
    }
  }

  // ② GASに送信（LINE通知・keepalive: true でページ閉じても通信継続）
  // ※ ファイルアップロードも内部で行われ、*Urls が sites にセットされる
  await report.submit()

  // ③ ファイルアップロード後に *Urls を含めて Supabase を再保存（URLを反映するため）
  if (!report.error.value && uid) {
    expense.saveReport(uid, {
      date:      report.form.value.date,
      isWorking: report.form.value.isWorking,
      sites:     report.form.value.sites,
      note:      report.form.value.note,
    }).catch(e => console.error('[Report] URL再保存エラー:', e))
  }

  // ④ 次の未送信日を取得してサクセス画面に表示
  if (!report.error.value && uid) {
    const next = await expense.getNextUnsubmittedDate(uid).catch(() => null)
    if (next && next !== 'NOT_CONFIGURED') {
      nextUnsubmittedDate.value = next
    }
  }
}

function goToNextReport() {
  const date = nextUnsubmittedDate.value
  if (!date) return
  nextUnsubmittedDate.value = null
  report.reset()
  report.form.value.date = date
  siteUsage.value = [createUsage()]
  isWorkingStr.value = 'working'
  initWorkers()
}

async function handleReset() {
  report.reset()
  siteUsage.value = [createUsage()]
  isWorkingStr.value = 'working'
  initWorkers()
  await master.fetch(true)
}

function handleExpenseFile(
  si: number,
  field: 'vehicleFiles' | 'trainFiles' | 'hotelFiles' | 'leopalaceFiles' | 'otherFiles' | 'entertainmentFiles',
  event: Event
) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  report.form.value.sites[si].expenses[field] = Array.from(input.files)
}

/** 領収書 AI 解析 → フォームに自動入力 */
async function analyzeReceipt(
  si: number,
  field: 'hotelFiles' | 'leopalaceFiles' | 'otherFiles' | 'entertainmentFiles',
  otherIndex?: number,
) {
  const files = report.form.value.sites[si].expenses[field] as File[] | undefined
  if (!files?.length) return
  const file   = files[0]
  const key    = `${si}-${field}`
  const result = await receipt.analyze(file, key)
  if (!result) {
    showReceiptToast('error', receipt.error.value ?? '解析に失敗しました')
    return
  }
  showReceiptToast('success', '解析成功！目視でも必ず確認してください')

  const exp = report.form.value.sites[si].expenses
  const inv = result.invoiceNumber || 'なし'
  if (field === 'hotelFiles') {
    if (result.label) exp.hotelName          = result.label
    if (result.yen)   exp.hotelYen           = result.yen
    exp.hotelRegistration = inv
  } else if (field === 'leopalaceFiles') {
    if (result.label) exp.leopalaceName         = result.label
    if (result.yen)   exp.leopalaceYen          = result.yen
    exp.leopalaceRegistration = inv
  } else if (field === 'entertainmentFiles') {
    if (result.label) exp.entertainmentLabel        = result.label
    if (result.yen)   exp.entertainmentYen          = result.yen
    exp.entertainmentRegistration = inv
  } else if (field === 'otherFiles' && otherIndex !== undefined) {
    const item = exp.others[otherIndex]
    if (item) {
      if (result.label) item.label              = result.label
      if (result.yen)   item.yen                = result.yen
      ;(item as any).registrationNumber = inv
    }
  }
}

function handleGarbagePhoto(si: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  report.form.value.sites[si].expenses.garbagePhotos = Array.from(input.files)
}

function fillTestData() {
  const savedDate = report.form.value.date
  report.reset()
  report.form.value.date = savedDate
  siteUsage.value = [createUsage()]
  initWorkers()  // ログインユーザーをworkerにセット

  report.form.value.note = 'テスト送信'

  // マスタから取得
  const sub = master.subcontractorNames.value

  const hasExisting = master.siteNames.value.length > 0

  if (hasExisting) {
    // ── 現場1（既存現場） ──
    const site0 = report.form.value.sites[0]
    site0.siteName = master.siteNames.value[0]
    // workers はログインユーザー固定 → 時刻だけ上書き
    if (site0.workers[0]) { site0.workers[0].startTime = '08:00'; site0.workers[0].endTime = '17:30' }
    site0.subcontractors = [
      { subcontractorId: '', subcontractorName: sub[0] || '__other__', customSubcontractorName: sub[0] ? '' : 'テスト業者A', count: 2 },
      { subcontractorId: '', subcontractorName: '__other__', customSubcontractorName: '新規テスト業者', count: 1 },
    ]
    siteUsage.value[0].expense = 'あり'
    siteUsage.value[0].vehicle = 'あり'
    site0.expenses.carpool = false
    site0.expenses.vehicles = [{ vehicleName: 'ハイエース', distanceKm: 80, dieselKm: undefined, parkingYen: 500, highwayYen: 1200, etcUsed: true, etcCard: 'カード①' }]
    siteUsage.value[0].train = 'あり'
    site0.expenses.trains = [{ label: '名古屋→大阪', yen: 3000 }]
    siteUsage.value[0].hotel = 'あり'
    site0.expenses.hotelName = 'アパホテル名古屋'
    site0.expenses.hotelYen  = 8000
    site0.expenses.hotelRegistration = 'T1234567890123'
    siteUsage.value[0].leopalace = 'あり'
    site0.expenses.leopalaceName = 'レオパレス栄'
    site0.expenses.leopalaceYen  = 50000
    site0.expenses.leopalaceRegistration = 'T9876543210987'
    siteUsage.value[0].garbage = 'あり'
    site0.expenses.garbageFactoryM3 = 3
    site0.expenses.garbageSiteM3    = 5
    siteUsage.value[0].other = 'あり'
    site0.expenses.others = [{ label: '養生テープ', yen: 1500, registrationNumber: 'なし' }]
    siteUsage.value[0].entertainment = 'あり'
    site0.expenses.entertainmentLabel = '懇親会'
    site0.expenses.entertainmentYen   = 10000
    site0.expenses.entertainmentRegistration = 'T1111222233334'

    // ── 現場2（新規現場「その他」） ── を追加
    addSite()
  }

  // ── 新規現場「その他」（既存あり→2つ目 / 既存なし→1つ目） ──
  const newIdx = hasExisting ? 1 : 0
  const siteN = report.form.value.sites[newIdx]
  siteN.siteName = '__other__'
  siteN.customSiteName = 'テスト新規現場'
  // workers はログインユーザー固定 → addSite() で17:30〜21:30 が自動セット済み
  siteN.subcontractors = [
    { subcontractorId: '', subcontractorName: sub[1] || sub[0] || '__other__', customSubcontractorName: (sub[1] || sub[0]) ? '' : 'テスト業者B', count: 1 },
  ]
  siteUsage.value[newIdx].expense = 'あり'
  siteUsage.value[newIdx].vehicle = '乗合い'
  siteN.expenses.carpool = true
  siteN.expenses.vehicles = []
  siteUsage.value[newIdx].train = 'あり'
  siteN.expenses.trains = [{ label: '大阪→名古屋', yen: 2500 }]
  siteUsage.value[newIdx].garbage = 'あり'
  siteN.expenses.garbageFactoryM3 = 2
  siteN.expenses.garbageSiteM3    = 4
  siteUsage.value[newIdx].other = 'あり'
  siteN.expenses.others = [{ label: 'ビニールシート', yen: 800, registrationNumber: 'なし' }]
  siteUsage.value[newIdx].entertainment = 'あり'
  siteN.expenses.entertainmentLabel = '昼食代'
  siteN.expenses.entertainmentYen   = 5000
  siteN.expenses.entertainmentRegistration = 'なし'
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

.error-icon { font-size: 48px; }
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
.select--error { border-color: #f87171 !important; }
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

/* ── 作業員（自分固定）バッジ ── */
.worker-self {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 10px; padding: 10px 14px; margin-bottom: 10px;
}
.worker-self-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--accent); color: #fff;
  font-size: 15px; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.worker-self-info { display: flex; flex-direction: column; gap: 2px; }
.worker-self-name { font-size: 14px; font-weight: 700; color: var(--text); }
.worker-self-role { font-size: 11px; color: var(--text2); }

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
.vehicle-note {
  font-size: 11px; color: var(--text2);
  margin-top: 4px;
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

.btn-history {
  background: transparent; color: var(--text2);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 11px 24px; font-size: 14px; font-family: var(--font);
  cursor: pointer; transition: border-color 0.15s, color 0.15s;
}
.btn-history:hover { border-color: var(--text2); color: var(--text); }
.btn-calendar {
  background: transparent; color: var(--text2);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 11px 24px; font-size: 14px; font-family: var(--font);
  cursor: pointer; transition: border-color 0.15s, color 0.15s;
  margin-top: 10px;
}
.btn-calendar:hover { border-color: var(--text2); color: var(--text); }

.btn-ai {
  margin-top: 6px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #7C3AED, #4F46E5);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: block;
  width: 100%;
}
.btn-ai:disabled { opacity: .5; cursor: not-allowed; }

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
  width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  background: #f0fdf4;
  border: 2px dashed #86efac; border-radius: var(--radius);
  color: #16a34a; font-size: 15px; font-weight: 700; font-family: var(--font);
  padding: 18px 16px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn-add-site:hover { background: #dcfce7; border-color: var(--accent); }
.btn-add-site__icon { font-size: 20px; line-height: 1; }
.btn-add-site__text { letter-spacing: 0.5px; }

/* ── devツールボタン ── */
.btn-dev {
  width: 100%; padding: 10px; margin-bottom: 8px;
  background: #2d2d2d; color: #aaa; border: 1px dashed #555;
  border-radius: var(--radius); font-size: 13px; cursor: pointer;
}
.btn-dev:hover { color: #fff; border-color: #888; }
.btn-dev--error { border-color: #e53935; color: #e53935; }

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

/* ── 過去日通知 ── */
.past-date-notice {
  margin-top: 8px;
  padding: 8px 12px;
  background: #FFF7ED;
  border: 1px solid #FED7AA;
  border-radius: 8px;
  font-size: 13px;
  color: #C2410C;
  font-weight: 600;
}

/* ── 日付固定表示 ── */
.date-fixed {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 11px 14px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 1px;
}

/* ── 編集モードバナー ── */
.edit-banner {
  background: #fff8e1;
  border: 1px solid #f0c030;
  color: #7a6000;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
}

/* ── LINEプレビュー ── */
.line-preview {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: var(--radius);
  overflow: hidden;
}
.line-preview-label {
  font-size: 11px; font-weight: 800; letter-spacing: 1px;
  color: #06C755; padding: 8px 14px;
  background: #dcfce7; border-bottom: 1px solid #bbf7d0;
}
.line-preview-body {
  font-size: 13px; line-height: 1.7; color: var(--text);
  padding: 12px 14px; white-space: pre-wrap; word-break: break-all;
  font-family: var(--font); margin: 0;
}

/* ── レスポンシブ ── */
@media (max-width: 380px) {
  .expense-grid { grid-template-columns: 1fr; }
  .worker-hours-row { flex-wrap: wrap; }
}

/* ── AI解析トースト ── */
.receipt-toast {
  position: fixed;
  bottom: 80px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px; font-weight: 500;
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
  white-space: nowrap;
  z-index: 9000;
}
.receipt-toast.success {
  background: #1a7a4a; color: #fff;
}
.receipt-toast.error {
  background: #c0392b; color: #fff;
}
.receipt-toast-icon {
  font-size: 20px;
  font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20;
}
.toast-enter-active, .toast-leave-active { transition: all .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(12px); }
</style>
