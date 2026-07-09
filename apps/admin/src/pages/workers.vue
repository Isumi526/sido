<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">作業員マスタ</h1>
      <button class="btn-add" @click="openAdd">＋ 追加</button>
    </div>

    <div class="status-tabs">
      <button
        v-for="tab in STATUS_TABS"
        :key="tab.key"
        class="status-tab"
        :class="{ active: statusTab === tab.key }"
        :data-testid="`status-tab-${tab.key}`"
        @click="statusTab = tab.key"
      >{{ tab.label }} <span class="tab-count">{{ statusCount(tab.key) }}</span></button>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>名前</th>
            <th>所属</th>
            <th>権限</th>
            <th v-if="canViewWages">日当単価</th>
            <th>雇用形態</th>
            <th>入社日</th>
            <th>状態</th>
            <th>ユーザー</th>
            <th>代理人</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in filteredWorkers" :key="w.id">
            <td class="name">{{ w.name }}</td>
            <td><span class="badge" :class="w.role">{{ w.role === 'factory' ? '工場/事務所' : '現場' }}</span></td>
            <td><span class="perm-badge" :class="w.permission_role ?? 'worker'">{{ permLabel(w.permission_role) }}</span></td>
            <td v-if="canViewWages" class="price">
              ¥{{ (w.daily_wage ?? 0).toLocaleString() }}<span class="price-unit">/日</span>
              <template v-if="canViewHourlyWage"><br><span class="price-hourly">時給 ¥{{ (w.hourly_wage ?? 0).toLocaleString() }}</span></template>
            </td>
            <td><span class="emp-badge" :class="w.employment_type ?? 'fulltime'">{{ w.employment_type === 'contractor' ? '業務委託' : (w.employment_type ?? 'fulltime') === 'fulltime' ? '正社員' : `パート(週${w.weekly_scheduled_days ?? '?'}日)` }}</span></td>
            <td class="hire-date">{{ w.hire_date ?? '—' }}</td>
            <td><span class="status" :class="wStatus(w)" data-testid="worker-status">{{ STATUS_LABELS[wStatus(w)] }}</span></td>
            <td><span class="user-link" :class="linkedWorkerIds.has(w.id) ? 'linked' : 'unlinked'">{{ linkedWorkerIds.has(w.id) ? '紐付け済み' : '未紐付け' }}</span></td>
            <td>
              <template v-if="proxyMap.get(w.id)?.length">
                <span v-for="pid in proxyMap.get(w.id)" :key="pid" class="proxy-badge">
                  {{ workerName(pid) }}
                </span>
              </template>
              <span v-else class="proxy-none">—</span>
            </td>
            <td class="actions">
              <button class="btn-edit" @click="openEdit(w)">編集</button>
              <template v-if="wStatus(w) === 'active'">
                <button class="btn-toggle" data-testid="to-retired" @click="setStatus(w, 'retired')">退職</button>
              </template>
              <template v-else-if="wStatus(w) === 'retired'">
                <button class="btn-toggle" data-testid="to-active" @click="setStatus(w, 'active')">復帰</button>
                <button class="btn-toggle" data-testid="to-inactive" @click="setStatus(w, 'inactive')">無効化</button>
              </template>
              <template v-else>
                <button class="btn-toggle" data-testid="to-retired-back" @click="setStatus(w, 'retired')">退職済みへ</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="modal" class="modal-overlay" @click.self="tryCloseModal">
      <div class="modal">
        <h2>{{ modal.id ? '作業員を編集' : '作業員を追加' }}</h2>
        <div class="field">
          <label>名前</label>
          <input v-model="modal.name" class="input" placeholder="例：山田 太郎" />
        </div>
        <div class="field">
          <label>所属</label>
          <div class="toggle">
            <button :class="{ active: modal.role === 'factory' }" @click="modal.role = 'factory'">工場/事務所</button>
            <button :class="{ active: modal.role === 'site' }" @click="modal.role = 'site'">現場</button>
          </div>
        </div>
        <div class="field" v-if="canManageUsers">
          <label>権限ロール</label>
          <div class="toggle role-toggle">
            <button :class="{ active: (modal.permission_role ?? 'worker') === 'admin' }" @click="modal.permission_role = 'admin'">オーナー</button>
            <button :class="{ active: (modal.permission_role ?? 'worker') === 'office' }" @click="modal.permission_role = 'office'">役員・経理</button>
            <button :class="{ active: (modal.permission_role ?? 'worker') === 'site_manager' }" @click="modal.permission_role = 'site_manager'">現場管理者</button>
            <button :class="{ active: (modal.permission_role ?? 'worker') === 'worker' }" @click="modal.permission_role = 'worker'">作業員</button>
          </div>
          <p class="role-hint">権限階層: オーナー &gt; 役員・経理 &gt; 現場管理者 &gt; 作業員。画面/操作の制御は今後のフェーズで適用されます。</p>
        </div>
        <template v-if="canViewWages">
        <div class="field">
          <label>日当単価（円/日・原価設定）</label>
          <input v-model.number="modal.daily_wage" type="number" class="input" placeholder="20000" data-testid="daily-wage" />
          <p class="hint-sm">諸々含めた経費計算用の設定単価。日報・集計は「日当/8h × 稼働時間」で計算（現場管理者も閲覧可）。時給（実質賃金）は下の「詳細情報」内で設定します。</p>
        </div>
        </template>
        <div class="field">
          <label>雇用形態</label>
          <div class="toggle">
            <button :class="{ active: (modal.employment_type ?? 'fulltime') === 'fulltime' }" @click="modal.employment_type = 'fulltime'">正社員</button>
            <button :class="{ active: modal.employment_type === 'parttime' }" @click="modal.employment_type = 'parttime'">パート・アルバイト</button>
            <button :class="{ active: modal.employment_type === 'contractor' }" @click="modal.employment_type = 'contractor'">業務委託</button>
          </div>
        </div>
        <div v-if="modal.employment_type === 'parttime'" class="field">
          <label>週所定労働日数</label>
          <select v-model.number="modal.weekly_scheduled_days" class="input">
            <option :value="null">選択してください</option>
            <option :value="4">週4日</option>
            <option :value="3">週3日</option>
            <option :value="2">週2日</option>
            <option :value="1">週1日</option>
          </select>
        </div>
        <div class="field">
          <label>日報提出開始日（未送信チェックの起点・任意）</label>
          <input v-model="modal.report_start_date" type="date" class="input" data-testid="report-start-date" />
          <p class="hint-sm">この日以降の未送信のみリマインド/未送信者一覧に出ます。未設定なら従来どおり作業員登録日が起点です。</p>
        </div>
        <button type="button" class="detail-toggle" data-testid="detail-toggle" @click="showDetails = !showDetails">
          {{ showDetails ? '▾ 詳細情報を隠す' : '▸ 詳細情報（個人情報・会社・保険・資格・代理人・認証）を表示' }}
        </button>
        <div v-show="showDetails" class="detail-section">
        <!-- 時給・賃金変更（実質賃金＝権限ガード：office以上のみ／#8007 回答A で詳細情報内へ移動） -->
        <div class="field">
          <label>時給（円/h・実質賃金）</label>
          <p v-if="!canViewHourlyWage" class="hint-sm">時給（実質賃金）は権限により非表示です</p>
          <template v-else>
            <input v-model.number="modal.hourly_wage" type="number" class="input" placeholder="2000" data-testid="hourly-wage" />
            <p class="hint-sm">実際に支払う時給。役員・経理以上のみ、月次/現場別集計の「実質賃金」トグルで使用。デフォルトの日当/8ではなく実際の時給を手動設定してください。</p>
          </template>
        </div>
        <div v-if="modal.id" class="field">
          <label>この時給・単価の記録方法</label>
          <div class="toggle">
            <button type="button" :class="{ active: wageEntryMode === 'initial' }" @click="wageEntryMode = 'initial'" data-testid="wage-mode-initial">初期設定（全期間に適用）</button>
            <button type="button" :class="{ active: wageEntryMode === 'raise' }" @click="wageEntryMode = 'raise'" data-testid="wage-mode-raise">昇給（発効日から）</button>
          </div>
          <p class="hint-sm">初期設定＝正しい単価を初めて入れる（履歴を作らず、過去含む全ての出面勤怠に反映・日付不要）。昇給＝ある日から変わった（発効日以降のみ新単価）。</p>
        </div>
        <div v-if="modal.id && wageEntryMode === 'raise'" class="field">
          <label>昇給年月日（発効日・単価を変えた時に記録）</label>
          <input v-model="wageEffectiveDate" type="date" class="input" data-testid="wage-effective-date" />
          <p class="hint-sm">この日以降の稼働が新単価で人件費計算されます（編集した日と違ってもOK）。</p>
        </div>
        <div v-if="modal.id && wageEntryMode === 'raise'" class="field">
          <label>単価変更の理由（任意）</label>
          <input v-model="wageReason" class="input" placeholder="例：定期昇給 / 資格取得" data-testid="wage-reason" />
        </div>
        <div v-if="modal.id && wageHistory.length && canViewHourlyWage" class="field">
          <label>賃金変更履歴（発効日〜 で当時の賃金で計算）</label>
          <ul class="wage-hist" data-testid="wage-history">
            <li v-for="h in wageHistory" :key="h.id">
              <b>{{ (h.effective_date || (h.changed_at || '').slice(0, 10)) }}〜</b>
              日当 <template v-if="histOldDaily(h) !== histDaily(h)">¥{{ histOldDaily(h).toLocaleString() }}→</template>¥{{ histDaily(h).toLocaleString() }}／時給 <template v-if="histOldHourly(h) !== histHourly(h)">¥{{ histOldHourly(h).toLocaleString() }}→</template>¥{{ histHourly(h).toLocaleString() }}
              <span v-if="h.reason" class="wage-reason"> （{{ h.reason }}）</span>
            </li>
          </ul>
        </div>
        <div class="field">
          <label>入社日</label>
          <input v-model="modal.hire_date" type="date" class="input" />
        </div>
        <div class="field">
          <label>生年月日</label>
          <input v-model="modal.birth_date" type="date" class="input" />
        </div>
        <div class="field">
          <label>住所</label>
          <input v-model="modal.address" class="input" placeholder="例：東京都新宿区..." />
        </div>
        <div class="field">
          <label>携帯電話番号</label>
          <input v-model="modal.mobile_phone" class="input" placeholder="例：090-1234-5678" />
        </div>
        <div class="field">
          <label>緊急連絡先</label>
          <input v-model="modal.emergency_contact" class="input" placeholder="例：090-1234-5678（配偶者）" />
        </div>
        <div class="field">
          <label>通知メールアドレス（任意）</label>
          <input v-model="modal.notify_email" class="input" type="email" placeholder="例：worker@example.com" data-testid="notify-email" />
          <p class="hint-sm">編集許可発行などのお知らせをメールで送る場合に設定してください。未設定なら送信しません。</p>
        </div>
        <div class="field">
          <label>家族構成（氏名・続柄・生年月日）</label>
          <div v-for="(fm, i) in familyMembers" :key="i" class="family-row" data-testid="family-row">
            <input v-model="fm.name" class="input" placeholder="氏名 *" />
            <input v-model="fm.relationship" class="input" placeholder="続柄（例：配偶者）" />
            <input v-model="fm.birth_date" type="date" class="input" />
            <button type="button" class="family-del" @click="removeFamily(i)">×</button>
          </div>
          <button type="button" class="btn-add-family" data-testid="add-family" @click="addFamily">＋ 家族を追加</button>
        </div>
        <div class="field">
          <label>会社情報</label>
          <input v-model="modal.company_info" class="input" placeholder="例：株式会社○○／所在地・代表者など" data-testid="company-info" />
        </div>
        <div class="field">
          <label>インボイス登録番号</label>
          <input v-model="modal.invoice_number" class="input" placeholder="例：T1234567890123" data-testid="invoice-number" />
        </div>
        <div class="field">
          <label>会社の保険</label>
          <input v-model="modal.insurance_info" class="input" placeholder="例：労働保険／賠償責任保険 など" data-testid="insurance-info" />
        </div>
        <div v-if="modal.employment_type === 'contractor'" class="field">
          <label>労災保険番号（業務委託）</label>
          <input v-model="modal.labor_insurance_number" class="input" placeholder="例：12-3-45-678901-0" data-testid="labor-insurance-number" />
        </div>
        <div class="field">
          <label>健康診断履歴（受診日・結果）</label>
          <div v-for="(hc, i) in healthCheckups" :key="i" class="checkup-row" data-testid="checkup-row">
            <input v-model="hc.checkup_date" type="date" class="input" />
            <input v-model="hc.result" class="input" placeholder="結果（例：異常なし）" />
            <button type="button" class="family-del" @click="removeCheckup(i)">×</button>
          </div>
          <button type="button" class="btn-add-family" data-testid="add-checkup" @click="addCheckup">＋ 健診を追加</button>
        </div>
        <div v-if="modal.id && canViewHourlyWage" class="field">
          <label>履歴書・書類（PDF/画像・複数可）<span class="hint-sm" style="font-weight:400"> ※権限者のみ・非公開（署名URLで閲覧）</span></label>
          <div v-if="resumes.length" class="resume-list">
            <div v-for="r in resumes" :key="r.id" class="resume-item" data-testid="resume-item">
              <a v-if="r.url" :href="r.url" target="_blank" rel="noopener" class="resume-link"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> {{ r.name || 'ファイル' }}</a>
              <span v-else class="resume-link muted"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> {{ r.name || 'ファイル' }}（読込中…）</span>
              <input v-model="r.name" class="input resume-name" placeholder="名称" @change="renameResume(r)" />
              <button type="button" class="family-del" title="削除" @click="deleteResume(r)">×</button>
            </div>
          </div>
          <div class="resume-dropzone" :class="{ dragover: resumeDragOver, busy: resumeUploading }"
               @drop.prevent="onDropResume" @dragover.prevent="resumeDragOver = true" @dragleave.prevent="resumeDragOver = false">
            <label class="btn-add-family">＋ 履歴書・書類を追加<input type="file" accept="image/*,application/pdf" multiple hidden :disabled="resumeUploading" data-testid="resume-input" @change="onUploadResume" /></label>
            <span class="resume-drop-hint">{{ resumeDragOver ? 'ここにドロップ' : 'またはドラッグ&ドロップ' }}</span>
            <span v-if="resumeUploading" class="muted">アップロード中…</span>
          </div>
        </div>
        <div class="field">
          <label>代理人（LINEを持たない場合、代わりに入力する作業員）</label>
          <div class="proxy-check-list">
            <label
              v-for="w in workers.filter(w => w.id !== modal?.id)"
              :key="w.id"
              class="proxy-check-item"
            >
              <input
                type="checkbox"
                :value="w.id"
                :checked="modalProxyIds.includes(w.id)"
                @change="toggleProxyId(w.id)"
              />
              {{ w.name }}
            </label>
            <span v-if="workers.filter(w => w.id !== modal?.id).length === 0" class="proxy-none">他に作業員がいません</span>
          </div>
        </div>
        </div><!-- /detail-section -->

        <!-- ログイン認証（常時表示＝新規/編集どちらでも／保存ボタンで作業員情報と一体反映） -->
        <div class="field auth-field">
          <label>
            ログイン認証
            <span v-if="modal.auth_user_id" class="auth-status set" data-testid="auth-status-set">認証設定済み</span>
            <span v-else class="auth-status unset">未設定</span>
          </label>
          <div class="auth-mode-toggle">
            <button type="button" :class="{ active: authMode === 'id' }" @click="authMode = 'id'">ID認証（メール無し作業員）</button>
            <button type="button" :class="{ active: authMode === 'email' }" @click="authMode = 'email'">メール認証</button>
          </div>
          <!-- 管理者自身のログイン情報がオートフィルされないよう抑制（作業員の認証を設定する欄のため） -->
          <input v-if="authMode === 'id'" v-model="authLoginId" class="input" type="text" name="worker-login-id" autocomplete="off" placeholder="ログインID（半角英数・. _ - 3文字以上）" data-testid="auth-login-id" />
          <input v-else v-model="authEmail" class="input" type="text" inputmode="email" name="worker-login-email" autocomplete="off" placeholder="email（現場管理者以上は必須）" data-testid="auth-email" />
          <!-- パスワード：未設定なら常時入力欄／設定済みは「変更」ボタンで展開 -->
          <PasswordInput v-if="!modal.auth_user_id || showPwField" v-model="authPassword" class="input" name="worker-login-pass" autocomplete="new-password" placeholder="パスワード（8文字以上）" data-testid="auth-password" />
          <button v-else type="button" class="btn-pw-change" data-testid="auth-pw-change" @click="showPwField = true">パスワードを変更</button>
          <p class="auth-hint">{{ authMode === 'id' ? 'メール無し作業員向け。ログイン画面で「ID＋パスワード」でログインできます（IDはグローバル一意）。' : '現場管理者以上は通知受信のためメール必須。' }}<br>下の「保存」で作業員情報と一緒に反映されます（パスワード欄が空なら認証は変更されません）。</p>
          <p v-if="authMsg" :class="authOk ? 'auth-ok' : 'error'" data-testid="auth-msg">{{ authMsg }}</p>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="tryCloseModal">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
        <p v-if="saveError" class="error">{{ saveError }}</p>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import PasswordInput from '../components/PasswordInput.vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { canViewWages, canViewHourlyWage, canManageUsers } from '../lib/auth'

type Worker = {
  id: string
  name: string
  role: 'factory' | 'site'
  permission_role?: 'admin' | 'office' | 'site_manager' | 'worker'
  daily_wage: number
  hourly_wage: number
  active: boolean
  status?: 'active' | 'retired' | 'inactive'   // ライフサイクル状態（active=有効 / retired=退職済み / inactive=無効）。active(bool) と同義に保つ。
  hire_date: string | null
  birth_date: string | null
  address: string | null
  mobile_phone: string | null
  notify_email: string | null
  emergency_contact: string | null
  employment_type: 'fulltime' | 'parttime' | 'contractor' | null
  weekly_scheduled_days: number | null
  company_info: string | null
  invoice_number: string | null
  insurance_info: string | null
  labor_insurance_number: string | null
  report_start_date: string | null
  auth_user_id: string | null
}

const workers         = ref<Worker[]>([])
// 状態タブ（有効/退職済み/無効）。status 未設定の既存行は active から導出。
type WStatus = 'active' | 'retired' | 'inactive'
const STATUS_TABS: { key: WStatus; label: string }[] = [
  { key: 'active',   label: '有効' },
  { key: 'retired',  label: '退職済み' },
  { key: 'inactive', label: '無効' },
]
const STATUS_LABELS: Record<WStatus, string> = { active: '有効', retired: '退職済み', inactive: '無効' }
const statusTab = ref<WStatus>('active')
function wStatus(w: Worker): WStatus { return w.status ?? (w.active ? 'active' : 'inactive') }
function statusCount(s: WStatus): number { return workers.value.filter(w => wStatus(w) === s).length }
const filteredWorkers = computed(() => workers.value.filter(w => wStatus(w) === statusTab.value))
const linkedWorkerIds = ref<Set<string>>(new Set())
// worker_id → 代理人の worker_id 配列
const proxyMap        = ref<Map<string, string[]>>(new Map())
const modal           = ref<Partial<Worker> | null>(null)
// モーダルで選択中の代理人 ID リスト
const modalProxyIds   = ref<string[]>([])
const saving          = ref(false)
// 昇給履歴（単価変更ログ）
type WageHist = { id: string; old_unit_price: number | null; new_unit_price: number; reason: string | null; changed_at: string; effective_date: string | null; wage_type: string | null; old_wage_type: string | null; old_daily_wage: number | null; new_daily_wage: number | null; old_hourly_wage: number | null; new_hourly_wage: number | null }
// 履歴の日当/時給（新カラム優先・旧行は unit_price+wage_type から推定＝migrationのバックフィル規則と一致）
function histDaily(h: WageHist): number {
  if (h.new_daily_wage != null) return h.new_daily_wage
  return h.wage_type === 'hourly' ? (h.new_unit_price ?? 0) * 8 : (h.new_unit_price ?? 0)
}
function histHourly(h: WageHist): number {
  if (h.new_hourly_wage != null) return h.new_hourly_wage
  return h.wage_type === 'hourly' ? (h.new_unit_price ?? 0) : Math.round((h.new_unit_price ?? 0) / 8)
}
function histOldDaily(h: WageHist): number {
  if (h.old_daily_wage != null) return h.old_daily_wage
  return h.old_wage_type === 'hourly' ? (h.old_unit_price ?? 0) * 8 : (h.old_unit_price ?? 0)
}
function histOldHourly(h: WageHist): number {
  if (h.old_hourly_wage != null) return h.old_hourly_wage
  return h.old_wage_type === 'hourly' ? (h.old_unit_price ?? 0) : Math.round((h.old_unit_price ?? 0) / 8)
}
const wageHistory      = ref<WageHist[]>([])
const wageReason       = ref('')
const wageEffectiveDate = ref('')   // 昇給年月日（発効日）。この日以降の稼働は新単価で人件費計算される。
// 賃金の記録方法: 'initial'=初期設定(履歴を作らず基準単価を上書き＝過去含む全期間に反映)/'raise'=昇給(発効日付き履歴)
const wageEntryMode    = ref<'initial' | 'raise'>('initial')
const origDaily        = ref<number | null>(null)
const origHourly       = ref<number | null>(null)
const origName         = ref<string | null>(null)
const todayStr = () => new Date().toISOString().slice(0, 10)
// 家族構成
type FamilyMember = { id?: string; name: string; relationship: string | null; birth_date: string | null }
const familyMembers = ref<FamilyMember[]>([])
function addFamily()           { familyMembers.value.push({ name: '', relationship: null, birth_date: null }) }
function removeFamily(i: number){ familyMembers.value.splice(i, 1) }
async function loadFamily(workerId: string) {
  const { data } = await supabase.from('worker_family_members')
    .select('id, name, relationship, birth_date').eq('worker_id', workerId).order('sort_order')
  familyMembers.value = ((data ?? []) as any[]).map(f => ({ id: f.id, name: f.name, relationship: f.relationship, birth_date: f.birth_date }))
}
// 家族の同期（名前ありの行のみ。既存idは更新・新規は挿入・外れた既存は削除）
async function syncFamily(workerId: string, accountId: string, want: FamilyMember[]) {
  const valid = want.filter(f => f.name?.trim())
  const { data } = await supabase.from('worker_family_members').select('id').eq('worker_id', workerId)
  const haveIds = ((data ?? []) as { id: string }[]).map(h => h.id)
  const keepIds = valid.map(f => f.id).filter(Boolean) as string[]
  const toDel = haveIds.filter(id => !keepIds.includes(id))
  for (const [i, f] of valid.entries()) {
    const row = { worker_id: workerId, account_id: accountId, name: f.name.trim(), relationship: f.relationship?.trim() || null, birth_date: f.birth_date || null, sort_order: i, updated_at: new Date().toISOString() }
    if (f.id) await supabase.from('worker_family_members').update(row).eq('id', f.id)
    else      await supabase.from('worker_family_members').insert(row)
  }
  if (toDel.length) await supabase.from('worker_family_members').delete().in('id', toDel)
}
// 健康診断履歴（1作業員に複数）
type HealthCheckup = { id?: string; checkup_date: string | null; result: string | null }
const healthCheckups = ref<HealthCheckup[]>([])
function addCheckup()            { healthCheckups.value.push({ checkup_date: null, result: null }) }
function removeCheckup(i: number){ healthCheckups.value.splice(i, 1) }
async function loadCheckups(workerId: string) {
  const { data } = await supabase.from('worker_health_checkups')
    .select('id, checkup_date, result').eq('worker_id', workerId).order('sort_order')
  healthCheckups.value = ((data ?? []) as any[]).map(r => ({ id: r.id, checkup_date: r.checkup_date, result: r.result }))
}

// 履歴書・書類の添付（非公開バケット worker-attachments・権限者=office以上のみ・署名URL閲覧）
type WorkerResume = { id: string; worker_id: string; kind: string; name: string | null; path: string; url?: string | null }
const RESUME_BUCKET = 'worker-attachments'
const resumes = ref<WorkerResume[]>([])
const resumeUploading = ref(false)
const resumeDragOver = ref(false)
// ローカルの storage host(kong:8000)を VITE_SUPABASE_URL に揃える（ブラウザから開けるように）
function normalizeStorageUrl(url: string): string {
  try {
    const base = new URL(import.meta.env.VITE_SUPABASE_URL as string)
    const u = new URL(url)
    if (u.host !== base.host) { u.protocol = base.protocol; u.host = base.host }
    return u.toString()
  } catch { return url }
}
async function resumeSignedUrl(attachmentId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('worker-attachment-url', { body: { attachment_id: attachmentId } })
    if (error || !data?.ok) return null
    return normalizeStorageUrl(data.url as string)
  } catch { return null }
}
async function loadResumes(workerId: string) {
  const { data } = await supabase.from('worker_attachments')
    .select('id, worker_id, kind, name, path').eq('worker_id', workerId).order('created_at')
  const list = (data ?? []) as WorkerResume[]
  await Promise.all(list.map(async (r) => { r.url = await resumeSignedUrl(r.id) }))
  resumes.value = list
}
async function processResumeFile(file: File | undefined | null) {
  if (!file || !modal.value?.id) return
  const ok = file.type.startsWith('image/') || file.type === 'application/pdf'
  if (!ok) { saveError.value = 'PDFまたは画像ファイルを選択してください'; return }
  resumeUploading.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
    // path 先頭フォルダ = account_id（storage RLS の account スコープに使用）
    const path = `${accountId}/${modal.value.id}/resume-${Date.now()}-${Math.round(file.size % 100000)}.${ext}`
    const { error: upErr } = await supabase.storage.from(RESUME_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (upErr) throw upErr
    await supabase.from('worker_attachments').insert({ account_id: accountId, worker_id: modal.value.id, kind: 'resume', name: file.name, path })
    await loadResumes(modal.value.id)
  } catch (e: any) { saveError.value = e.message ?? 'アップロードに失敗しました' }
  finally { resumeUploading.value = false }
}
function onUploadResume(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (files) for (const f of Array.from(files)) processResumeFile(f)
  ;(e.target as HTMLInputElement).value = ''
}
function onDropResume(e: DragEvent) {
  resumeDragOver.value = false
  const files = e.dataTransfer?.files
  if (files) for (const f of Array.from(files)) processResumeFile(f)
}
async function renameResume(r: WorkerResume) {
  await supabase.from('worker_attachments').update({ name: (r.name ?? '').trim() || null }).eq('id', r.id)
}
async function deleteResume(r: WorkerResume) {
  if (!confirm('この書類を削除しますか？')) return
  await supabase.storage.from(RESUME_BUCKET).remove([r.path])
  await supabase.from('worker_attachments').delete().eq('id', r.id)
  if (modal.value?.id) await loadResumes(modal.value.id)
}
async function syncCheckups(workerId: string, accountId: string, want: HealthCheckup[]) {
  const valid = want.filter(r => r.checkup_date || r.result?.trim())
  const { data } = await supabase.from('worker_health_checkups').select('id').eq('worker_id', workerId)
  const haveIds = ((data ?? []) as { id: string }[]).map(h => h.id)
  const keepIds = valid.map(r => r.id).filter(Boolean) as string[]
  const toDel = haveIds.filter(id => !keepIds.includes(id))
  for (const [i, r] of valid.entries()) {
    const row = { worker_id: workerId, account_id: accountId, checkup_date: r.checkup_date || null, result: r.result?.trim() || null, sort_order: i, updated_at: new Date().toISOString() }
    if (r.id) await supabase.from('worker_health_checkups').update(row).eq('id', r.id)
    else      await supabase.from('worker_health_checkups').insert(row)
  }
  if (toDel.length) await supabase.from('worker_health_checkups').delete().in('id', toDel)
}
const saveError       = ref('')
// email/password 認証（Phase 2a）＋ ID/password 認証（メール無し作業員）
const authMode        = ref<'email' | 'id'>('email')
const authEmail       = ref('')
const authLoginId     = ref('')
const authPassword    = ref('')
const showPwField     = ref(false)   // 認証設定済みの時、パスワード欄は「変更」ボタンで展開
const authMsg         = ref('')
const authOk          = ref(false)

// 未保存の離脱確認：フォームに変更があれば閉じる前に確認する
const formDirty = ref(false)
let   formReady = false   // 開いた直後の初期化による watch 発火を dirty 扱いしないためのガード
watch([modal, authLoginId, authEmail, authPassword, authMode, modalProxyIds, familyMembers, healthCheckups, wageReason, wageEffectiveDate],
  () => { if (formReady) formDirty.value = true }, { deep: true })
function markFormLoaded() { formDirty.value = false; formReady = false; nextTick(() => { formReady = true }) }
function tryCloseModal() {
  if (formDirty.value && !confirm('未保存の変更があります。破棄して閉じてもよろしいですか？')) return
  formReady = false; modal.value = null
}

function workerName(id: string | null) {
  if (!id) return ''
  return workers.value.find(w => w.id === id)?.name ?? '不明'
}

const PERM_LABELS: Record<string, string> = { admin: 'オーナー', office: '役員・経理', site_manager: '現場管理者', worker: '作業員' }
function permLabel(r: string | null | undefined): string {
  return PERM_LABELS[r ?? 'worker'] ?? '作業員'
}

// 編集ダイアログ: よく使う項目だけ常時表示し、個人情報/会社/保険/資格/代理人/認証は折りたたむ。
const showDetails = ref(false)

function toggleProxyId(id: string) {
  const idx = modalProxyIds.value.indexOf(id)
  if (idx >= 0) modalProxyIds.value.splice(idx, 1)
  else modalProxyIds.value.push(id)
}

async function load() {
  const accountId = await getAccountId()
  const [{ data: workersData }, { data: usersData }, { data: proxyData }] = await Promise.all([
    supabase.from('workers').select('id, name, role, permission_role, daily_wage, hourly_wage, active, status, hire_date, birth_date, address, mobile_phone, notify_email, emergency_contact, employment_type, weekly_scheduled_days, company_info, invoice_number, insurance_info, labor_insurance_number, report_start_date, auth_user_id').eq('account_id', accountId).order('name'),
    supabase.from('users').select('worker_id').eq('account_id', accountId).not('worker_id', 'is', null),
    supabase.from('worker_proxies').select('worker_id, proxy_operator_id').eq('account_id', accountId),
  ])
  workers.value = (workersData ?? []) as Worker[]
  linkedWorkerIds.value = new Set((usersData ?? []).map((u: any) => u.worker_id as string))

  const map = new Map<string, string[]>()
  for (const row of (proxyData ?? []) as any[]) {
    const arr = map.get(row.worker_id) ?? []
    arr.push(row.proxy_operator_id)
    map.set(row.worker_id, arr)
  }
  proxyMap.value = map
}

onMounted(load)

function openAdd() {
  modal.value = { name: '', role: 'site', permission_role: 'worker', daily_wage: 20000, hourly_wage: 2000, hire_date: null, birth_date: null, address: null, mobile_phone: null, notify_email: null, emergency_contact: null, employment_type: 'fulltime', weekly_scheduled_days: null, company_info: null, invoice_number: null, insurance_info: null, labor_insurance_number: null, report_start_date: null }
  modalProxyIds.value = []
  familyMembers.value = []
  healthCheckups.value = []
  resumes.value = []
  saveError.value = ''
  // 新規でも認証UIを出す（保存で一体作成・二度手間回避）＝状態を初期化
  authEmail.value = ''; authLoginId.value = ''; authMode.value = 'id'; authPassword.value = ''
  showPwField.value = false; authMsg.value = ''; authOk.value = false
  showDetails.value = false   // 詳細情報（時給含む）は毎回たたんで開く
  origName.value = null
  markFormLoaded()
}

async function openEdit(w: Worker) {
  modal.value = { ...w }
  modalProxyIds.value = [...(proxyMap.value.get(w.id) ?? [])]
  saveError.value = ''
  authEmail.value = ''
  authLoginId.value = ''
  authMode.value = 'email'
  authPassword.value = ''
  showPwField.value = false
  authMsg.value = ''
  authOk.value = false
  // 昇給履歴：変更前の日当・時給を控える
  origDaily.value  = w.daily_wage ?? null
  origHourly.value = w.hourly_wage ?? null
  // users.real_name 同期判定用：変更前の名前を控える
  origName.value = w.name ?? null
  wageReason.value = ''
  wageEffectiveDate.value = todayStr()
  wageEntryMode.value = 'initial'   // 既定は初期設定（正しい単価を入れ直す＝全期間反映）。昇給時のみ切替。
  wageHistory.value = []
  showDetails.value = false   // 詳細情報（時給含む）は毎回たたんで開く
  familyMembers.value = []
  healthCheckups.value = []
  resumes.value = []
  // 非同期ロードは await してから dirty 監視を開始（ロード発火を誤って dirty 扱いしない）
  await Promise.all([
    w.auth_user_id ? loadAuthEmail(w.id) : Promise.resolve(),
    loadWageHistory(w.id), loadFamily(w.id), loadCheckups(w.id),
    canViewHourlyWage.value ? loadResumes(w.id) : Promise.resolve(),
  ])
  markFormLoaded()
}

async function loadWageHistory(workerId: string) {
  const { data } = await supabase.from('worker_wage_history')
    .select('id, old_unit_price, new_unit_price, reason, changed_at, effective_date, wage_type, old_wage_type, old_daily_wage, new_daily_wage, old_hourly_wage, new_hourly_wage')
    .eq('worker_id', workerId).order('effective_date', { ascending: false, nullsFirst: false }).order('changed_at', { ascending: false })
  wageHistory.value = (data ?? []) as WageHist[]
}

// 認証済み作業員の現在のログインメールを取得して email 欄に表示（mode='get'）
async function loadAuthEmail(workerId: string) {
  try {
    const { data, error } = await supabase.functions.invoke('worker-auth-setup', { body: { worker_id: workerId, mode: 'get' } })
    if (error || !data?.ok) return
    // モーダルが別の作業員に切り替わっていたら反映しない
    if (modal.value?.id !== workerId) return
    if (data.login_id) { authMode.value = 'id'; authLoginId.value = data.login_id }   // ID認証の作業員
    else if (data.email) { authMode.value = 'email'; authEmail.value = data.email }
  } catch { /* 取得失敗時は空のまま（手入力可） */ }
}

// 認証は save() に統一（別ボタン廃止）。作成/更新は保存ボタンで一緒に反映する。

async function save() {
  if (!modal.value?.name?.trim()) { saveError.value = '名前を入力してください'; return }
  saving.value = true
  saveError.value = ''
  try {
    const accountId = await getAccountId()
    let workerId = modal.value.id

    const workerPayload = {
      name:                  modal.value.name!.trim(),
      role:                  modal.value.role ?? 'site',
      permission_role:       modal.value.permission_role ?? 'worker',
      daily_wage:            modal.value.daily_wage ?? 0,
      hourly_wage:           modal.value.hourly_wage ?? 0,
      hire_date:             modal.value.hire_date || null,
      birth_date:            modal.value.birth_date || null,
      address:               modal.value.address?.trim() || null,
      mobile_phone:          modal.value.mobile_phone?.trim() || null,
      notify_email:          modal.value.notify_email?.trim() || null,
      emergency_contact:     modal.value.emergency_contact?.trim() || null,
      employment_type:       modal.value.employment_type ?? 'fulltime',
      weekly_scheduled_days: modal.value.employment_type === 'parttime' ? (modal.value.weekly_scheduled_days ?? null) : null,
      company_info:           modal.value.company_info?.trim() || null,
      invoice_number:         modal.value.invoice_number?.trim() || null,
      insurance_info:         modal.value.insurance_info?.trim() || null,
      // 労災保険番号は区分=業務委託のときのみ保持（他区分では常にnull）
      labor_insurance_number: modal.value.employment_type === 'contractor' ? (modal.value.labor_insurance_number?.trim() || null) : null,
      report_start_date:      modal.value.report_start_date || null,
    }

    if (workerId) {
      await supabase.from('workers').update(workerPayload).eq('id', workerId)
      // users.real_name はLINE登録時のスナップショットのまま追従しないため、
      // 名前変更時はここで同期する（以降の日報保存で正しい名前がJSONBに書かれるようにする。
      // 既存の過去日報のJSONBスナップショットは遡及されない）。
      if (origName.value != null && workerPayload.name !== origName.value) {
        await supabase.from('users').update({ real_name: workerPayload.name }).eq('worker_id', workerId)
      }
      // 日当 or 時給 が変わったら昇給履歴を1行記録（発効日以降の日報がこの値で計算される）
      const newDaily  = modal.value.daily_wage ?? 0
      const newHourly = modal.value.hourly_wage ?? 0
      const dailyChanged  = origDaily.value  != null && newDaily  !== origDaily.value
      const hourlyChanged = origHourly.value != null && newHourly !== origHourly.value
      // 昇給(raise)のときだけ発効日付き履歴を記録。初期設定(initial)は履歴を作らず基準単価の上書きのみ＝
      // 履歴が無い→wageForDate/出面勤怠は現在単価を全期間に適用＝過去の出面勤怠にも反映される。
      if ((dailyChanged || hourlyChanged) && wageEntryMode.value === 'raise') {
        const effDate = wageEffectiveDate.value || todayStr()
        // べき等化: (worker_id, effective_date) の一意indexで upsert=同一発効日の再送/連打でも二重登録しない。
        await supabase.from('worker_wage_history').upsert({
          worker_id: workerId, account_id: accountId,
          // 後方互換: old/new_unit_price には日当を入れ、wage_type='daily' 固定（旧集計との互換）
          old_unit_price: origDaily.value, new_unit_price: newDaily, wage_type: 'daily', old_wage_type: 'daily',
          old_daily_wage:  origDaily.value,  new_daily_wage:  newDaily,
          old_hourly_wage: origHourly.value, new_hourly_wage: newHourly,
          reason: wageReason.value.trim() || null,
          effective_date: effDate,
        }, { onConflict: 'worker_id,effective_date' })
      }
      // 同一セッションでの再保存が履歴を再検知しないよう、基準値を新値に更新（初期設定/昇給いずれも）
      if (dailyChanged || hourlyChanged) { origDaily.value = newDaily; origHourly.value = newHourly }
    } else {
      const { data, error: insErr } = await supabase.from('workers').insert({ ...workerPayload, account_id: accountId, status: 'active' }).select('id').single()
      if (insErr || !data) {
        // 作業員名は一意制約あり＝同名が既にいると 23505。分かりやすいメッセージに。
        if ((insErr as any)?.code === '23505') throw new Error('同じ名前の作業員が既に登録されています。名前を変えてください。')
        throw new Error(insErr?.message ?? '作業員の作成に失敗しました')
      }
      workerId = data.id
      if (modal.value) modal.value.id = workerId   // 以降のエラー時に再保存で二重insertしないよう即idを持たせる
    }

    // 代理人関係を全削除して再挿入
    await supabase.from('worker_proxies').delete().eq('worker_id', workerId).eq('account_id', accountId)
    if (modalProxyIds.value.length > 0) {
      await supabase.from('worker_proxies').insert(
        modalProxyIds.value.map(pid => ({
          worker_id:         workerId,
          proxy_operator_id: pid,
          account_id:        accountId,
        }))
      )
    }

    // 家族構成・健診履歴の同期
    await syncFamily(workerId!, accountId, familyMembers.value)
    await syncCheckups(workerId!, accountId, healthCheckups.value)

    // ログイン認証（保存ボタンに統一）：パスワードが入力された時だけ作成/更新する。
    //  空なら認証は変更しない（＝通常の作業員編集で毎回パス入力を求めない）。
    if (authPassword.value) {
      const useId = authMode.value === 'id'
      const cred = (useId ? authLoginId.value : authEmail.value).trim()
      if (!cred) throw new Error(useId ? 'ログインIDを入力してください' : 'メールアドレスを入力してください')
      // フォーマット検証（EFに投げる前に分かりやすいメッセージを出す）
      if (useId) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/.test(cred)) throw new Error('ログインIDは半角英数（. _ -）で3文字以上にしてください')
      } else {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cred)) throw new Error('有効なメールアドレスを入力してください（例: name@example.com）。メール無し作業員は「ID認証」タブを使ってください')
      }
      if (authPassword.value.length < 8) throw new Error('パスワードは8文字以上で入力してください')
      const { data: ad, error: ae } = await supabase.functions.invoke('worker-auth-setup', {
        body: useId
          ? { worker_id: workerId, login_id: cred, password: authPassword.value }
          : { worker_id: workerId, email: cred, password: authPassword.value },
      })
      if (ae) {
        // 非2xx時は EF 本文の message/error を取り出して分かりやすく表示（'non-2xx status code' の握り潰し回避）
        let msg = '認証設定に失敗しました'
        try { const b = await (ae as any).context?.json?.(); if (b) msg = b.message ?? b.error ?? msg } catch { /* 本文取れなければ既定 */ }
        throw new Error(msg)
      }
      if (!ad?.ok) throw new Error(ad?.message ?? ad?.error ?? '認証設定に失敗しました')
      // 旧authの無効化に失敗した場合は警告（旧資格が残る可能性）
      if (ad.old_auth_cleanup === 'failed') { saveError.value = '保存しました（※旧ログインの無効化に失敗。旧資格でログインできる可能性があります）' }
    }

    formReady = false; formDirty.value = false
    modal.value = null
    await load()
  } catch (e: any) {
    saveError.value = e.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

// 状態遷移（有効⇄退職済み⇄無効）。active(boolean) は status='active' と同義に保つ（既存フィルタ互換）。
async function setStatus(w: Worker, status: WStatus) {
  await supabase.from('workers').update({ status, active: status === 'active' }).eq('id', w.id)
  await load()
}

</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.table td { padding: 14px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
/* タブで状態を分けるため行のグレーアウトは廃止（状態カラムのバッジで表現） */
.name { font-weight: 600; }
.price { font-variant-numeric: tabular-nums; }
.price-unit { font-size: 11px; color: #888; }
.price-hourly { font-size: 11px; color: #4338ca; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.badge.factory { background: #e8f4ff; color: #1a6fc4; }
.badge.site { background: #e8fff0; color: #0a8a3a; }
.perm-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; background: #f1f5f9; color: #475569; }
.perm-badge.admin { background: #fee2e2; color: #b91c1c; }
.perm-badge.office { background: #ffedd5; color: #c2410c; }
.perm-badge.site_manager { background: #e0e7ff; color: #4338ca; }
.perm-badge.worker { background: #f1f5f9; color: #475569; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.retired { background: #fff4e5; color: #b96a00; }
.status.inactive { background: #f5f5f5; color: #aaa; }
/* 状態タブ */
.status-tabs { display: flex; gap: 4px; margin-bottom: 14px; }
.status-tab { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; }
.status-tab.active { background: #06C755; border-color: #06C755; color: #fff; }
.status-tab .tab-count { font-size: 11px; opacity: .8; margin-left: 2px; }
.actions { display: flex; gap: 8px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-toggle { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: #888; }
.proxy-badge { display: inline-block; font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #fee2e2; color: #dc2626; font-weight: 700; margin-right: 4px; }
.proxy-none { font-size: 12px; color: #ccc; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 520px; max-width: 92vw; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
.role-toggle button { font-size: 12px; padding: 9px 4px; }
.role-hint { font-size: 11px; color: #94a3b8; margin: 6px 0 0; line-height: 1.5; }
.detail-toggle {
  width: 100%; text-align: left; margin: 14px 0 4px; padding: 10px 12px;
  background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px;
  font-size: 13px; font-weight: 700; color: #475569; cursor: pointer;
}
.detail-toggle:hover { background: #f1f5f9; }
.detail-section { border-left: 2px solid #e2e8f0; padding-left: 10px; margin-top: 4px; }
.proxy-check-list { display: flex; flex-direction: column; gap: 8px; background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; max-height: 160px; overflow-y: auto; }
.proxy-check-item { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.proxy-check-item input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
.modal-actions { display: flex; gap: 12px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
.user-link { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.user-link.linked { background: #e8f4ff; color: #1a6fc4; }
.user-link.unlinked { background: #f5f5f5; color: #bbb; }
.emp-badge { font-size: 11px; padding: 3px 8px; border-radius: 4px; font-weight: 700; }
.emp-badge.fulltime { background: #f0f4ff; color: #4f46e5; }
.emp-badge.parttime { background: #fff7ed; color: #c2710c; }
.emp-badge.contractor { background: #ecfdf5; color: #047857; }
.wage-hist { list-style: none; margin: 0; padding: 8px 12px; background: #f9fafb; border: 1px solid #eee; border-radius: 8px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; }
.wage-hist .wage-reason { color: #888; }
.wage-hist .wage-from { color: #aaa; font-size: 11px; }
.hint-sm { font-size: 11px; color: #999; margin: 2px 0 0; }
.family-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
.checkup-row { display: grid; grid-template-columns: 1fr 1.6fr auto; gap: 6px; align-items: center; margin-bottom: 6px; }
.checkup-row .input { padding: 8px 10px; font-size: 13px; }
.family-row .input { padding: 8px 10px; font-size: 13px; }
.family-del { background: none; border: 1px solid #f0caca; color: #c0392b; border-radius: 6px; width: 30px; height: 32px; cursor: pointer; font-size: 14px; }
.btn-add-family { background: #f0f0f0; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #555; align-self: flex-start; }
.resume-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.resume-item { display: grid; grid-template-columns: 1fr 1.2fr auto; gap: 6px; align-items: center; }
.resume-link { color: #1a56c4; text-decoration: none; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resume-link.muted { color: #aaa; }
.resume-name { font-size: 12px; }
.resume-dropzone { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border: 1px dashed #d0d0d0; border-radius: 8px; padding: 10px; background: #fafafa; }
.resume-dropzone.dragover { border-color: #06C755; background: #eafbf1; }
.resume-dropzone.busy { opacity: .6; }
.resume-drop-hint { font-size: 12px; color: #aaa; }
.hire-date { font-size: 12px; color: #666; font-variant-numeric: tabular-nums; }
.auth-field { border-top: 1px solid #f0f0f0; padding-top: 16px; }
.auth-mode-toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; margin-bottom: 8px; }
.auth-mode-toggle button { flex: 1; padding: 8px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 12px; }
.auth-mode-toggle button.active { background: #1a6fc4; color: #fff; font-weight: 700; }
.auth-hint { font-size: 11px; color: #94a3b8; margin: 6px 0; line-height: 1.5; }
.btn-pw-change { align-self: flex-start; background: #eef2ff; color: #4338ca; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
.auth-status { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 700; margin-left: 8px; }
.auth-status.set { background: #e8f4ff; color: #1a6fc4; }
.auth-status.unset { background: #f5f5f5; color: #bbb; }
.btn-auth { background: #1a6fc4; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-auth:disabled { opacity: .5; }
.auth-ok { color: #0a8a3a; font-size: 13px; }
</style>
