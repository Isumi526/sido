<template>
  <div class="app">
    <ReportOnboarding ref="onboardingRef" />
    <AppNav :subtitle="$t('report.subtitle')" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />
    <button type="button" class="ob-replay" @click="onboardingRef?.open()"><span class="material-symbols-rounded ob-replay-icon">help</span>{{ $t('onboarding.replay') }}</button>

    <main class="main">
      <!-- ローディング -->
      <div v-if="initializing" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>

      <!-- 全日送信済み -->
      <div v-else-if="allSubmitted" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">{{ $t('report.allSubmittedTitle') }}</h2>
        <p class="state-text">{{ $t('report.allSubmittedText') }}</p>
        <button class="btn-history" @click="navigateTo('/history')">{{ $t('report.viewHistory') }}</button>
        <button class="btn-calendar" @click="navigateTo('/calendar')">{{ $t('report.viewSchedule') }}</button>
      </div>

      <!-- 送信完了 / 更新完了 -->
      <div v-else-if="report.submitted.value || editSubmitted" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">{{ editSubmitted ? $t('report.updatedTitle') : $t('report.submittedTitle') }}</h2>
        <p class="state-text">{{ editSubmitted ? $t('report.updatedText') : $t('report.submittedText') }}</p>
        <button v-if="!editSubmitted && nextUnsubmittedDate" class="btn-primary" @click="goToNextReport">
          {{ $t('report.enterNextReport', { date: nextDateLabel }) }}
        </button>
        <button class="btn-history" @click="navigateTo('/history')">{{ editSubmitted ? $t('report.backToHistory') : $t('report.viewHistory') }}</button>
      </div>

      <!-- フォーム -->
      <form v-else @submit.prevent="handleSubmit" class="form">

        <!-- 編集モードバナー -->
        <div v-if="isEditMode" class="edit-banner">
          {{ $t('report.editModeBanner') }}
        </div>

        <!-- 下書き復元バナー（新規入力中・自動保存を復元した時のみ）-->
        <div v-if="draftRestored && !isEditMode" class="draft-banner">
          <span class="draft-banner-text"><span class="material-symbols-rounded banner-icon">edit_note</span>{{ $t('report.draftRestored') }}</span>
          <button type="button" class="draft-discard" @click="discardDraft">{{ $t('report.draftDiscard') }}</button>
        </div>

        <!-- 日付 -->
        <FormSection num="01" :title="$t('report.dateSection')">
          <div class="date-fixed">{{ dateWithWeekday }}</div>
          <div v-if="!isEditMode && report.form.value.date < new Date().toISOString().split('T')[0]" class="past-date-notice">
            <span v-html="$t('report.pastDateNotice')" />
          </div>
          <div v-if="currentDateLocked" class="locked-notice">
            <span class="material-symbols-rounded banner-icon">lock</span>{{ $t('report.lockedBanner') }}
            <div class="locked-actions">
              <template v-if="lockGrantStatus === 'pending'">
                <span class="locked-pending"><span class="material-symbols-rounded banner-icon">schedule</span>{{ $t('report.unlockPending') }}</span>
                <button type="button" class="btn-unlock-cancel" :disabled="unlockRequesting" @click="cancelUnlockRequest">{{ $t('report.unlockPendingCancel') }}</button>
              </template>
              <button v-else type="button" class="btn-unlock" @click="openUnlockModal"><span class="material-symbols-rounded banner-icon">lock</span>{{ $t('report.unlockRequest') }}</button>
            </div>
          </div>
        </FormSection>

        <!-- 編集許可の依頼モーダル（未送信×期限切れもこの画面から依頼） -->
        <div v-if="unlockModalOpen" class="req-overlay" @click.self="closeUnlockModal">
          <div class="req-modal">
            <h2 class="req-title">{{ $t('report.unlockRequest') }}</h2>
            <p class="req-sub">{{ $t('report.unlockReasonLabel') }}</p>
            <textarea v-model="unlockReason" class="req-textarea" rows="3" :placeholder="$t('report.unlockReasonPlaceholder')"></textarea>
            <div class="req-actions">
              <button type="button" class="req-cancel" @click="closeUnlockModal">{{ $t('report.unlockReasonCancel') }}</button>
              <button type="button" class="req-submit" :disabled="unlockRequesting" @click="submitUnlockRequest">
                {{ unlockRequesting ? $t('report.unlockRequesting') : $t('report.unlockReasonSubmit') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 稼働有無 -->
        <FormSection num="02" :title="$t('report.workStatusSection')" required>
          <select v-model="isWorkingStr" class="select" required>
            <option value="working">{{ $t('report.working') }}</option>
            <option value="paid_leave">{{ $t('report.paidLeave') }}</option>
            <option value="off">{{ $t('report.off') }}</option>
          </select>
        </FormSection>

        <!-- 現場ブロック（稼働ありの場合のみ表示） -->
        <template v-if="isWorkingStr === 'working'">

        <!-- 出張区分（稼働ありの日のみ・出張手当 +¥3,000/日を集計に計上） -->
        <label class="trip-toggle" data-testid="business-trip-toggle">
          <input type="checkbox" v-model="report.form.value.isBusinessTrip" />
          <span>{{ $t('report.businessTrip') }}</span>
        </label>

        <!-- 本日のガソリン代（日報レベル・現場に紐づかない実費。按分で各現場へ距離比配賦） -->
        <FormSection num="03" :title="$t('report.gasolineSection')">
          <!-- 給油有無（大半の日は給油なし。あり の時だけ金額・領収書を表示） -->
          <label class="hours-label">{{ $t('report.gasolineFueledLabel') }}</label>
          <select :value="gasFueled ? 'yes' : 'no'" class="select mt4" @change="setGasFueled(($event.target as HTMLSelectElement).value === 'yes')">
            <option value="no">{{ $t('report.gasolineFueledNo') }}</option>
            <option value="yes">{{ $t('report.gasolineFueledYes') }}</option>
          </select>

          <template v-if="gasFueled">
            <!-- 給油1回ぶん＝1明細。複数給油はカードを追加 -->
            <div v-for="(g, gi) in report.form.value.gasolineItems" :key="g._id ?? gi" class="lineitem-card mt8">
              <!-- ① 領収書＋AI解析（手入力より上） -->
              <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
              <AttachedFilesBadge :files="gasFilesById[g._id ?? -1] ?? []" :urls="g.fileUrls" @remove-file="(p) => removeGasFile(g, p)" />
              <input type="file" accept="image/*,.pdf" class="input mt4" @change="(e) => onGasItemFile(gi, e)" />
              <p v-if="gasUploadingId === g._id" class="section-hint">{{ $t('report.uploading') }}</p>
              <div v-if="(gasFilesById[g._id ?? -1]?.length) || g.fileUrls?.length" class="photo-preview">
                <button type="button" class="btn-ai" :disabled="gasAnalyzingId === g._id || !(gasFilesById[g._id ?? -1]?.length)" @click="analyzeGasItem(gi)">
                  {{ gasAnalyzingId === g._id ? $t('report.analyzing') : $t('report.aiAnalyzeGas') }}
                </button>
              </div>
              <!-- ② 手入力（支払い先・金額・登録番号） -->
              <div class="lineitems-row mt6">
                <input v-model="g.payee" type="text" class="input" :placeholder="$t('report.gasPayeePlaceholder')" @keydown.enter.prevent />
                <ExpenseField v-model="g.yen" v-model:tategae="g.tategae" with-tategae :label="$t('report.gasolineCost')" />
                <button v-if="(report.form.value.gasolineItems?.length ?? 0) > 1" type="button" class="btn-icon-sm" @click="report.removeGasolineItem(gi)">✕</button>
              </div>
              <input v-model="g.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
              <!-- 燃料種別・給油量（ℓ） -->
              <div class="lineitems-row mt6">
                <select v-model="g.fuelType" class="input">
                  <option value="regular">{{ $t('report.fuelRegular') }}</option>
                  <option value="diesel">{{ $t('report.fuelDiesel') }}</option>
                </select>
                <input v-model.number="g.liters" type="number" inputmode="decimal" step="0.01" min="0" class="input" :placeholder="$t('report.litersPlaceholder')" @keydown.enter.prevent />
              </div>
            </div>
            <button type="button" class="btn-ghost-sm" @click="report.addGasolineItem()">{{ $t('report.addGasoline') }}</button>
          </template>
        </FormSection>

        <!-- 現場ブロック -->
        <FormSection
          v-for="(site, si) in report.form.value.sites"
          :key="si"
          :num="String(si + 4).padStart(2, '0')"
          :title="report.form.value.sites.length > 1 ? $t('report.siteNumbered', { n: si + 1 }) : $t('report.site')"
          accent
        >
          <template #action>
            <button
              v-if="report.form.value.sites.length > 1"
              type="button"
              class="btn-danger-sm"
              @click="removeSite(si)"
            >{{ $t('report.removeBtn') }}</button>
          </template>

          <!-- 元請け業者（任意） -->
          <Field :label="$t('report.contractor')">
            <select v-model="site.contractorName" class="select">
              <option value="">{{ $t('report.selectOptional') }}</option>
              <option v-for="name in master.contractorNames.value" :key="name" :value="name">{{ name }}</option>
              <option value="__other__">{{ $t('report.addNewContractor') }}</option>
            </select>
            <input
              v-if="site.contractorName === '__other__'"
              v-model="site.customContractorName"
              type="text"
              class="input mt6"
              :placeholder="$t('report.contractorPlaceholder')"
              @keydown.enter.prevent
            />
          </Field>

          <!-- 現場名 -->
          <Field :label="$t('report.siteName')" required>
            <select v-model="site.siteName" class="select" required @change="onSiteChange(si)">
              <option value="">{{ $t('common.select') }}</option>
              <option value="__unset__">{{ $t('report.siteUnset') }}</option>
              <template v-if="groupedSiteNames(site.contractorName).linked.length">
                <optgroup :label="$t('report.siteGroupLinked')">
                  <option v-for="name in groupedSiteNames(site.contractorName).linked" :key="name" :value="name">{{ name }}</option>
                </optgroup>
                <optgroup :label="$t('report.siteGroupOther')">
                  <option v-for="name in groupedSiteNames(site.contractorName).others" :key="name" :value="name">{{ name }}</option>
                </optgroup>
              </template>
              <option v-else v-for="name in groupedSiteNames(site.contractorName).others" :key="name" :value="name">{{ name }}</option>
              <option value="__other__">{{ $t('report.addNewSite') }}</option>
            </select>
            <div v-if="site.siteName === '__unset__'" class="unset-hint">
              <HintIcon :text="$t('report.siteUnsetNote')" :label="$t('report.siteUnset')" />
            </div>
            <input
              v-if="site.siteName === '__other__'"
              v-model="site.customSiteName"
              type="text"
              class="input mt6"
              :placeholder="$t('report.siteNamePlaceholder')"
              required
              @keydown.enter.prevent
            />
            <div v-if="site.siteName === '__other__' && siteSimilar(site.customSiteName).length"
                 style="margin-top:6px;font-size:12px;color:#B45309;background:#FEF3C7;border:1px solid #FDE68A;border-radius:6px;padding:8px 10px;line-height:1.5">
              <span class="material-symbols-rounded banner-icon">warning</span>{{ $t('report.similarSiteWarn') }}：<strong>{{ siteSimilar(site.customSiteName).join('、') }}</strong>
            </div>
          </Field>

          <!-- ── 稼働（現場選択後に表示） ── -->
          <template v-if="site.siteName && site.siteName !== '__other__' || site.siteName === '__other__' && site.customSiteName">
          <div class="sub-section">

            <!-- 作業員（ログインユーザー固定） -->
            <Field>
              <!-- 下請けのみ（自分は稼働なし）チェック -->
              <label class="self-off-check">
                <input
                  type="checkbox"
                  :checked="siteUsage[si].selfWorking === 'なし'"
                  @change="(e) => setSelfWorking(si, (e.target as HTMLInputElement).checked ? 'なし' : 'あり')"
                />
                <span>{{ $t('report.subcontractorOnly') }}</span>
              </label>

              <!-- 時刻・休憩（自分の稼働ありのみ） -->
              <template v-if="siteUsage[si].selfWorking === 'あり' && site.workers[0]">
                <div class="worker-time-rows">
                  <div class="worker-time-row">
                    <div class="time-field">
                      <label class="hours-label">{{ $t('report.startTime') }}</label>
                      <select v-model="site.workers[0].startTime" class="select">
                        <option v-for="t in startTimeOptionsForSite(si)" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                    <span class="time-sep">〜</span>
                    <div class="time-field">
                      <label class="hours-label">{{ $t('report.endTime') }}</label>
                      <select v-model="site.workers[0].endTime" class="select">
                        <option v-for="t in endTimeOptionsForSite(si)" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                  </div>
                  <div v-if="siteFixedEnd(site.siteName)" class="fixed-time-note">
                    <template v-if="overtimeApprovedForDate"><span class="material-symbols-rounded banner-icon">check_circle</span>{{ $t('report.overtimeApprovedNote') }}</template>
                    <template v-else>
                      <span class="material-symbols-rounded banner-icon">timer</span>{{ $t('report.fixedTimeNote', { end: siteFixedEnd(site.siteName) }) }}
                      <NuxtLink to="/overtime" class="overtime-link">{{ $t('report.overtimeApplyLink') }}</NuxtLink>
                    </template>
                  </div>
                  <div class="worker-break-row">
                    <div class="time-field">
                      <label class="hours-label">{{ $t('report.break') }}</label>
                      <span class="break-auto">
                        <template v-if="effectiveBreakMinutes(site.workers[0]) === 0">{{ $t('report.breakNone') }}</template>
                        <template v-else-if="site.workers[0].breakSnapshot">{{ effectiveBreakMinutes(site.workers[0]) }}分（現場設定）</template>
                        <template v-else>{{ $t('report.breakMinutesAuto', { min: effectiveBreakMinutes(site.workers[0]) }) }}</template>
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
            <Field :label="$t('report.subcontractor')">
              <div v-for="(sub, si2) in site.subcontractors" :key="si2">
                <div class="row-worker">
                  <select v-model="sub.subcontractorName" class="select" :class="{ 'select--error': sub.subcontractorName === '' }">
                    <option value="" disabled>{{ $t('report.selectSubcontractor') }}</option>
                    <option v-for="name in master.subNamesForSite(site.siteName, sub.subcontractorName)" :key="name" :value="name">{{ name }}</option>
                    <option value="__other__">{{ $t('report.otherNew') }}</option>
                  </select>
                  <input v-model.number="sub.count" type="number" min="1" max="20" class="input select--h" :placeholder="$t('report.people')" @keydown.enter.prevent />
                  <button type="button" class="btn-icon-sm" @click="report.removeSub(si, si2)">✕</button>
                </div>
                <input
                  v-if="sub.subcontractorName === '__other__'"
                  v-model="sub.customSubcontractorName"
                  class="input"
                  :placeholder="$t('report.subcontractorNamePlaceholder')"
                  style="margin-top: -4px; margin-bottom: 8px;"
                />
              </div>
              <button type="button" class="btn-ghost-sm" @click="report.addSub(si)">{{ $t('report.addSubcontractor') }}</button>
            </Field>
          </div>

          <!-- 経費有無 -->
          <Field :label="$t('report.expense')">
            <select :value="siteUsage[si].expense" class="select select--usage" @change="(e) => setUsage(si, 'expense', (e.target as HTMLSelectElement).value)">
              <option value="なし">{{ $t('report.optNone') }}</option>
              <option value="あり">{{ $t('report.optYes') }}</option>
            </select>
          </Field>

          <!-- ── 交通経費 ── -->
          <div v-if="siteUsage[si].expense === 'あり'" class="sub-section">
            <div class="sub-section-title">{{ $t('report.transportExpense') }}</div>

            <!-- 車両 -->
            <Field :label="$t('report.vehicle')" :hint="$t('report.vehicleNote')">
              <select :value="siteUsage[si].vehicle" class="select select--usage" @change="(e) => setUsage(si, 'vehicle', (e.target as HTMLSelectElement).value)">
                <option value="なし">{{ $t('report.optNone') }}</option>
                <option value="あり">{{ $t('report.optYes') }}</option>
                <option value="乗合い">{{ $t('report.optCarpool') }}</option>
              </select>
              <template v-if="siteUsage[si].vehicle === 'あり'">
                <div
                  v-for="(veh, vi) in site.expenses.vehicles"
                  :key="vi"
                  class="vehicle-block"
                >
                  <div class="vehicle-block-header">
                    <span class="vehicle-block-label">{{ site.expenses.vehicles.length > 1 ? $t('report.vehicleNumbered', { n: vi + 1 }) : $t('report.vehicle') }}</span>
                    <button
                      v-if="site.expenses.vehicles.length > 1"
                      type="button"
                      class="btn-danger-sm"
                      @click="report.removeVehicle(si, vi)"
                    >{{ $t('report.removeBtn') }}</button>
                  </div>
                  <input v-model="veh.vehicleName" type="text" class="input" :placeholder="$t('report.vehicleNamePlaceholder')" @keydown.enter.prevent />
                  <div class="expense-grid mt8">
                    <ExpenseField v-model="veh.distanceKm" :label="$t('report.gasoline')" />
                    <ExpenseField v-model="veh.dieselKm"   :label="$t('report.diesel')" />
                  </div>
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addVehicle(si)">{{ $t('report.addVehicle') }}</button>
                <!-- 車両レベルの領収書は廃止（ガソリン/軽油=距離ベースで領収書不要・駐車/高速は各明細に領収書あり） -->

                <!-- 駐車場代（複数・明細ごと領収書）— 車両ありの時のみ -->
                <div class="veh-subexpense">
                  <label class="hours-label">{{ $t('report.parking') }}</label>
                  <div v-for="(pk, pi) in (site.expenses.parkings ?? [])" :key="pi" class="lineitem-card">
                    <div>
                      <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
                      <AttachedFilesBadge :files="pk.files" :urls="pk.fileUrls" @remove-file="(p) => removeItemFile(pk, p)" />
                      <input type="file" accept="image/*,.pdf" multiple class="input mt4" @change="(e) => handleParkingFile(si, pi, e)" />
                      <div v-if="pk.files?.length" class="photo-preview">
                        <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-parking-${pi}`" @click="analyzeReceipt(si, 'parking', pi)">
                          {{ receipt.loading.value === `${si}-parking-${pi}` ? $t('report.analyzing') : $t('report.aiAnalyze') }}
                        </button>
                      </div>
                    </div>
                    <div class="lineitems-row mt6">
                      <ExpenseField v-model="pk.yen" v-model:tategae="pk.tategae" with-tategae :label="$t('report.amountYen')" />
                      <button type="button" class="btn-icon-sm" @click="report.removeParking(si, pi)">✕</button>
                    </div>
                    <input v-model="pk.payee" type="text" class="input mt6" placeholder="支払い先（店名/業者）" @keydown.enter.prevent />
                    <input v-model="pk.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
                  </div>
                  <button type="button" class="btn-ghost-sm" @click="report.addParking(si)">{{ $t('report.addParking') }}</button>
                </div>

                <!-- 高速代（複数・明細ごと領収書＋ETCカード）— 車両ありの時のみ -->
                <div class="veh-subexpense">
                  <label class="hours-label">{{ $t('report.highway') }}</label>
                  <div v-for="(hw, hi) in (site.expenses.highways ?? [])" :key="hi" class="lineitem-card">
                    <div>
                      <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
                      <AttachedFilesBadge :files="hw.files" :urls="hw.fileUrls" @remove-file="(p) => removeItemFile(hw, p)" />
                      <input type="file" accept="image/*,.pdf" multiple class="input mt4" @change="(e) => handleHighwayFile(si, hi, e)" />
                      <div v-if="hw.files?.length" class="photo-preview">
                        <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-highway-${hi}`" @click="analyzeReceipt(si, 'highway', hi)">
                          {{ receipt.loading.value === `${si}-highway-${hi}` ? $t('report.analyzing') : $t('report.aiAnalyze') }}
                        </button>
                      </div>
                    </div>
                    <div class="lineitems-row mt6">
                      <ExpenseField v-model="hw.yen" v-model:tategae="hw.tategae" with-tategae :label="$t('report.amountYen')" />
                      <button type="button" class="btn-icon-sm" @click="report.removeHighway(si, hi)">✕</button>
                    </div>
                    <input v-model="hw.payee" type="text" class="input mt6" placeholder="支払い先（店名/業者）" @keydown.enter.prevent />
                    <input v-model="hw.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
                    <div class="mt6">
                      <label class="hours-label">{{ $t('report.etcCard') }}</label>
                      <select v-model="hw.etcCard" class="select mt4">
                        <option value="">{{ $t('report.optNone') }}</option>
                        <option v-for="n in 7" :key="n" :value="`カード${['①','②','③','④','⑤','⑥','⑦'][n-1]}`">
                          {{ $t('report.cardLabel', { mark: ['①','②','③','④','⑤','⑥','⑦'][n-1] }) }}
                        </option>
                      </select>
                    </div>
                  </div>
                  <button type="button" class="btn-ghost-sm" @click="report.addHighway(si)">{{ $t('report.addHighway') }}</button>
                </div>
              </template>
            </Field>

            <!-- 電車 -->
            <Field :label="$t('report.train')">
              <select :value="siteUsage[si].train" class="select select--usage" @change="(e) => setUsage(si, 'train', (e.target as HTMLSelectElement).value)">
                <option value="なし">{{ $t('report.optNone') }}</option>
                <option value="あり">{{ $t('report.optYes') }}</option>
              </select>
              <template v-if="siteUsage[si].train === 'あり'">
                <div v-for="(tr, ti) in site.expenses.trains" :key="ti" class="lineitem-card">
                  <div>
                    <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
                    <AttachedFilesBadge :files="tr.files" :urls="tr.fileUrls" @remove-file="(p) => removeItemFile(tr, p)" />
                    <input type="file" accept="image/*,.pdf" multiple class="input mt4" @change="(e) => handleTrainFile(si, ti, e)" />
                    <div v-if="tr.files?.length" class="photo-preview">
                      <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-train-${ti}`" @click="analyzeReceipt(si, 'train', ti)">
                        {{ receipt.loading.value === `${si}-train-${ti}` ? $t('report.analyzing') : $t('report.aiAnalyze') }}
                      </button>
                    </div>
                  </div>
                  <div class="lineitems-row mt6">
                    <input v-model="tr.label" type="text" class="input" :placeholder="$t('report.trainRoutePlaceholder')" @keydown.enter.prevent />
                    <ExpenseField v-model="tr.yen" v-model:tategae="tr.tategae" with-tategae :label="$t('report.amount')" />
                    <button v-if="site.expenses.trains.length > 1" type="button" class="btn-icon-sm" @click="report.removeTrain(si, ti)">✕</button>
                  </div>
                  <input v-model="tr.payee" type="text" class="input mt6" placeholder="支払い先（店名/業者）" @keydown.enter.prevent />
                  <input v-model="tr.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addTrain(si)">{{ $t('report.add') }}</button>
              </template>
            </Field>
          </div>

          <!-- ── 現場経費 ── -->
          <div v-if="siteUsage[si].expense === 'あり'" class="sub-section">
            <div class="sub-section-title">{{ $t('report.siteExpense') }}</div>

            <!-- 宿泊費（ホテル・レオパレス等／複数登録可） -->
            <Field :label="$t('report.hotel')">
              <select :value="siteUsage[si].hotel" class="select select--usage" @change="(e) => setUsage(si, 'hotel', (e.target as HTMLSelectElement).value)">
                <option value="なし">{{ $t('report.optNone') }}</option>
                <option value="あり">{{ $t('report.optYes') }}</option>
              </select>
              <template v-if="siteUsage[si].hotel === 'あり'">
                <div v-for="(ho, hi) in (site.expenses.hotels ?? [])" :key="hi" class="lineitem-card mt6 hotel-item">
                  <button v-if="(site.expenses.hotels?.length ?? 0) > 1" type="button" class="btn-remove-card" :aria-label="$t('report.removeHotel')" @click="report.removeHotel(si, hi)">✕</button>
                  <div>
                    <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
                    <AttachedFilesBadge :files="ho.files" :urls="ho.fileUrls" @remove-file="(p) => removeItemFile(ho, p)" />
                    <input type="file" accept="image/*,.pdf" multiple class="input mt4" @change="(e) => handleHotelFile(si, hi, e)" />
                    <div v-if="ho.files?.length" class="photo-preview">
                      <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-hotel-${hi}`" @click="analyzeReceipt(si, 'hotel', hi)">
                        {{ receipt.loading.value === `${si}-hotel-${hi}` ? $t('report.analyzing') : $t('report.aiAnalyze') }}
                      </button>
                    </div>
                  </div>
                  <div class="lineitems-row mt6">
                    <input v-model="ho.label" type="text" class="input" :placeholder="$t('report.facilityNameHotelPlaceholder')" @keydown.enter.prevent />
                    <ExpenseField v-model="ho.yen" v-model:tategae="ho.tategae" with-tategae :label="$t('report.amount')" />
                  </div>
                  <input v-model="ho.payee" type="text" class="input mt6" placeholder="支払い先（店名/業者）" @keydown.enter.prevent />
                  <input v-model="ho.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addHotel(si)">{{ $t('report.addHotel') }}</button>
              </template>
            </Field>

            <!-- ゴミ -->
            <Field :label="$t('report.garbage')">
              <select :value="siteUsage[si].garbage" class="select select--usage" @change="(e) => setUsage(si, 'garbage', (e.target as HTMLSelectElement).value)">
                <option value="なし">{{ $t('report.optNone') }}</option>
                <option value="あり">{{ $t('report.optYes') }}</option>
              </select>
              <template v-if="siteUsage[si].garbage === 'あり'">
                <div class="expense-grid mt6">
                  <ExpenseField v-model="site.expenses.garbageFactoryM3" :label="$t('report.garbageWood')" decimal />
                  <ExpenseField v-model="site.expenses.garbageSiteM3"    :label="$t('report.garbageMixed')" decimal />
                </div>
                <div v-if="site.expenses.garbageFactoryM3 || site.expenses.garbageSiteM3" class="mt8">
                  <label class="hours-label">{{ $t('report.garbagePhotoLabel') }}</label>
                  <AttachedFilesBadge :files="site.expenses.garbagePhotos" @remove-file="(p) => site.expenses.garbagePhotos?.splice(p.index, 1)" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    class="input mt6"
                    @change="(e) => handleGarbagePhoto(si, e)"
                  />
                </div>
              </template>
            </Field>

            <!-- その他（資材等） -->
            <Field :label="$t('report.other')">
              <select :value="siteUsage[si].other" class="select select--usage" @change="(e) => setUsage(si, 'other', (e.target as HTMLSelectElement).value)">
                <option value="なし">{{ $t('report.optNone') }}</option>
                <option value="あり">{{ $t('report.optYes') }}</option>
              </select>
              <template v-if="siteUsage[si].other === 'あり'">
                <div v-for="(ot, oi) in site.expenses.others" :key="oi" class="lineitem-card mt6">
                  <div>
                    <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
                    <AttachedFilesBadge :files="ot.files" :urls="ot.fileUrls" @remove-file="(p) => removeItemFile(ot, p)" />
                    <input type="file" accept="image/*,.pdf" multiple class="input mt4" @change="(e) => handleOtherFile(si, oi, e)" />
                    <div v-if="ot.files?.length" class="photo-preview">
                      <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-other-${oi}`" @click="analyzeReceipt(si, 'other', oi)">
                        {{ receipt.loading.value === `${si}-other-${oi}` ? $t('report.analyzing') : $t('report.aiAnalyze') }}
                      </button>
                    </div>
                  </div>
                  <div class="lineitems-row mt6">
                    <input v-model="ot.label" type="text" class="input" :placeholder="$t('report.contentPlaceholder')" @keydown.enter.prevent />
                    <ExpenseField v-model="ot.yen" v-model:tategae="ot.tategae" with-tategae :label="$t('report.amount')" />
                    <button v-if="site.expenses.others.length > 1" type="button" class="btn-icon-sm" @click="report.removeOther(si, oi)">✕</button>
                  </div>
                  <input v-model="ot.payee" type="text" class="input mt6" placeholder="支払い先（店名/業者）" @keydown.enter.prevent />
                  <input v-model="ot.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addOther(si)">{{ $t('report.addOther') }}</button>
              </template>
            </Field>

            <!-- その他雑経費 -->
            <Field :label="$t('report.miscExpense')">
              <select :value="siteUsage[si].entertainment" class="select select--usage" @change="(e) => setUsage(si, 'entertainment', (e.target as HTMLSelectElement).value)">
                <option value="なし">{{ $t('report.optNone') }}</option>
                <option value="あり">{{ $t('report.optYes') }}</option>
              </select>
              <template v-if="siteUsage[si].entertainment === 'あり'">
                <div v-for="(ent, ei) in (site.expenses.entertainments ?? [])" :key="ei" class="lineitem-card mt6">
                  <div>
                    <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
                    <AttachedFilesBadge :files="ent.files" :urls="ent.fileUrls" @remove-file="(p) => removeItemFile(ent, p)" />
                    <input type="file" accept="image/*,.pdf" multiple class="input mt4" @change="(e) => handleEntertainmentFile(si, ei, e)" />
                    <div v-if="ent.files?.length" class="photo-preview">
                      <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-entertainment-${ei}`" @click="analyzeReceipt(si, 'entertainment', ei)">
                        {{ receipt.loading.value === `${si}-entertainment-${ei}` ? $t('report.analyzing') : $t('report.aiAnalyze') }}
                      </button>
                    </div>
                  </div>
                  <div class="lineitems-row mt6">
                    <input v-model="ent.label" type="text" class="input" :placeholder="$t('report.contentPlaceholder')" @keydown.enter.prevent />
                    <ExpenseField v-model="ent.yen" v-model:tategae="ent.tategae" with-tategae :label="$t('report.amount')" />
                    <button v-if="(site.expenses.entertainments?.length ?? 0) > 1" type="button" class="btn-icon-sm" @click="report.removeEntertainment(si, ei)">✕</button>
                  </div>
                  <input v-model="ent.payee" type="text" class="input mt6" placeholder="支払い先（店名/業者）" @keydown.enter.prevent />
                  <input v-model="ent.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addEntertainment(si)">{{ $t('report.addMiscExpense') }}</button>
              </template>
            </Field>
          </div>

          <!-- 現場備考 -->
          <Field :label="$t('report.siteNote')">
            <textarea
              v-model="site.siteNote"
              class="textarea"
              :placeholder="$t('report.siteNotePlaceholder')"
              rows="2"
            />
          </Field>
          </template><!-- /現場選択後に表示 -->

        </FormSection>

        <!-- 現場追加 -->
        <button type="button" class="btn-add-site" @click="addSite()">
          <span class="btn-add-site__icon">＋</span>
          <span class="btn-add-site__text">
            {{ $t('report.addSite', { n: report.form.value.sites.length + 1 }) }}
          </span>
        </button>

        </template><!-- /isWorkingStr === 'working' -->

        <!-- 備考 -->
        <FormSection num="✎" :title="$t('report.noteSection')">
          <textarea
            v-model="report.form.value.note"
            class="textarea"
            :placeholder="$t('report.notePlaceholder')"
            rows="3"
          />
        </FormSection>

        <!-- エラー表示 -->
        <div v-if="report.error.value || editError" class="error-banner">
          <span class="material-symbols-rounded banner-icon">warning</span>{{ report.error.value || editError }}
        </div>

        <!-- 送信前の最終確認テーブル（新規・編集とも全体をプレビュー） -->
        <div class="preview-block">
          <div class="preview-label">
            <span class="material-symbols-rounded" style="font-size:1.1em;vertical-align:middle;line-height:1">fact_check</span>
            {{ isEditMode ? $t('report.editPreviewLabel') : $t('report.linePreviewLabel') }}
          </div>
          <div class="preview-head">
            <span>{{ previewData.dateLabel }} {{ $t('report.subtitle') }}</span>
            <span class="preview-sender">{{ previewData.senderName }}</span>
          </div>

          <p v-if="previewData.mode === 'paid_leave'" class="preview-leave">{{ $t('report.badgePaidLeave') }}</p>
          <p v-else-if="previewData.mode === 'off'" class="preview-leave">{{ $t('report.badgeOff') }}</p>
          <template v-else>
            <div v-if="!previewData.sites.length" class="preview-empty">{{ $t('report.previewEmptySites') }}</div>
            <div v-for="(site, si) in previewData.sites" :key="si" class="preview-site-wrap">
              <div class="preview-site-title">
                <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">location_on</span>
                {{ site.name }}
                <span v-if="site.contractor" class="preview-contractor">（{{ site.contractor }}）</span>
              </div>
              <table v-if="site.workers.length" class="preview-table">
                <thead><tr><th>{{ $t('report.workerName') }}</th><th>{{ $t('report.workTime') }}</th><th>{{ $t('report.workHours') }}</th></tr></thead>
                <tbody>
                  <tr v-for="(w, wi) in site.workers" :key="wi"><td>{{ w.name }}</td><td class="preview-time">{{ w.timeRange }}</td><td>{{ w.hours }}</td></tr>
                </tbody>
              </table>
              <ul v-if="site.expenses.length" class="preview-list">
                <li v-for="(e, ei) in site.expenses" :key="ei">
                  <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">payments</span> {{ e }}
                </li>
              </ul>
              <ul v-if="site.subs.length" class="preview-list">
                <li v-for="(s, sbi) in site.subs" :key="sbi">
                  <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">handshake</span> {{ s }}
                </li>
              </ul>
              <p v-if="site.note" class="preview-note">{{ site.note }}</p>
            </div>
          </template>
          <p v-if="previewData.note" class="preview-note preview-note-main">{{ previewData.note }}</p>
        </div>

        <!-- 送信前の記入忘れ確認（新規送信時のみ・習慣化のため必須） -->
        <label v-if="!isEditMode" class="submit-confirm">
          <input type="checkbox" v-model="omissionConfirmed" />
          <span>{{ $t('report.omissionConfirm') }}</span>
        </label>

        <!-- 送信ボタン -->
        <button v-if="isDev && !isEditMode" type="button" class="btn-dev" @click="fillTestData">{{ $t('report.fillTestData') }}</button>
        <button v-if="isDev" type="button" class="btn-dev" :class="{ 'btn-dev--error': forceErrorOnSubmit }" @click="fillErrorTestData">
          {{ forceErrorOnSubmit ? $t('report.cancelErrorTest') : $t('report.fillErrorTestData') }}
        </button>
        <button type="submit" class="btn-submit" :disabled="currentDateLocked || (isEditMode ? editSubmitting : (report.submitting.value || !omissionConfirmed))">
          <span v-if="isEditMode ? editSubmitting : report.submitting.value" class="submitting">
            <span class="dot-spin" />{{ isEditMode ? $t('report.updating') : $t('report.submitting') }}
          </span>
          <span v-else>{{ isEditMode ? $t('report.updateReportBtn') : $t('report.submitReportBtn') }}</span>
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
import { computeWorkerHours, getRateLines, calcBreakMinutes, effectiveBreakMinutes, effectiveBreakWindows, parseMin, TIME_OPTIONS } from '~/utils/workerHours'
import type { RateBreakdown } from '~/utils/workerHours'
import { computeDiff } from '~/utils/diffReport'
import { findSimilarSiteNames } from '~/utils/siteSimilarity'
import { uploadExpenseFiles } from '~/utils/uploadExpenseFiles'
import { createGasolineItem } from '~/composables/useReport'
import { useI18n } from 'vue-i18n'
import type { User } from '~/types'

const { t } = useI18n()

// オンボーディングを手動で再表示するための参照（使い方ガイドボタン）
const onboardingRef = ref<{ open: () => void } | null>(null)

// 新規現場の手入力時、既存に似た現場があれば重複候補を返す（重複登録の気づき）
function siteSimilar(name?: string): string[] {
  return findSimilarSiteNames(name ?? '', master.siteNames.value)
}

// 現場プルダウン: 元請けが選択されていれば、その元請けに紐づく現場を優先表示。
//  紐づけ忘れで現場が選べない不便を防ぐため、紐づいていない現場も「その他の現場」として
//  下部に残す（元請け未選択/その他の時は linked=[] で全件が others に入る＝後方互換）。
function groupedSiteNames(contractorName?: string): { linked: string[]; others: string[] } {
  // '__unset__' という名前の現場行は「現場未設定」用の特殊値で、専用optionを別途出すため除外
  const all = master.siteNames.value.filter((n) => n !== '__unset__')
  const cn = (contractorName ?? '').trim()
  if (!cn || cn === '__other__') return { linked: [], others: all }
  const map = master.siteContractors.value
  const linked = all.filter((n) => map[n] === cn)
  const others = all.filter((n) => map[n] !== cn)
  return { linked, others }
}

// クエリ（?edit=YYYY-MM-DD）が変わったらページを再マウントさせ、編集/新規の
//  初期化（onMounted）を必ず再実行する。これが無いと、編集画面を開いた後に
//  アプリ内メニュー「日報登録」(/report) を押しても再マウントされず、編集状態
//  （isEditMode・日付）が残ってしまう。
definePageMeta({ key: route => route.fullPath })

const config  = useRuntimeConfig()
const route   = useRoute()
const liff    = useLiff()
const master  = useMaster()
const report  = useReport()
const expense  = useExpense()
const receipt  = useReceiptAnalysis()
const proxy   = useProxyMode()

const selfUser = ref<User | null>(null)

// 代理中は代理先作業員の情報をUser形式で返す、それ以外は自分
const currentUser = computed(() => {
  const t = proxy.proxyTarget.value
  if (t) {
    return {
      ...selfUser.value,
      real_name:    t.name,
      worker_role:  t.worker_role,
      line_user_id: t.line_user_id ?? selfUser.value?.line_user_id ?? '',
      worker_id:    t.id,
    } as User
  }
  return selfUser.value
})

const isDev = computed(() => config.public.appEnv === 'development' || liff.isTester.value)

// ── 過去3日編集ロック（提出/編集の期限ガード）──
const lock = useReportLock()
const currentDateLocked = ref(false)
const lockGrantStatus = ref<'none' | 'pending' | 'approved' | 'rejected'>('none')
async function refreshLock() {
  const d = report.form.value.date
  const wid = currentUser.value?.worker_id ?? null
  if (!wid || !lock.isPastLockWindow(d)) { currentDateLocked.value = false; lockGrantStatus.value = 'none'; return }
  lockGrantStatus.value = await lock.grantStatus(wid, d)
  currentDateLocked.value = lockGrantStatus.value !== 'approved'
}
watch([() => report.form.value.date, () => currentUser.value?.worker_id], refreshLock, { immediate: true })

// ── ロック日の「編集の許可を依頼」（未送信×期限切れもこの画面から依頼できる）──
const unlockModalOpen  = ref(false)
const unlockReason     = ref('')
const unlockRequesting = ref(false)
function openUnlockModal()  { unlockReason.value = ''; unlockModalOpen.value = true }
function closeUnlockModal() { unlockModalOpen.value = false; unlockReason.value = '' }
async function submitUnlockRequest() {
  const d = report.form.value.date
  const wid = currentUser.value?.worker_id ?? null
  if (!d || !wid || unlockRequesting.value) return
  unlockRequesting.value = true
  const r = await lock.requestGrant(wid, d, unlockReason.value.trim())
  unlockRequesting.value = false
  if (r.ok) { lockGrantStatus.value = 'pending'; closeUnlockModal() }
  else alert(t('report.unlockRequestFailed'))
}
async function cancelUnlockRequest() {
  const d = report.form.value.date
  const wid = currentUser.value?.worker_id ?? null
  if (!d || !wid || unlockRequesting.value) return
  unlockRequesting.value = true
  const r = await lock.cancelRequest(wid, d)
  unlockRequesting.value = false
  if (r.ok) lockGrantStatus.value = 'none'
}

// 管理画面で承認したら日報画面へ自動反映（リロード不要・ブラウザ開きっぱなしでも反映）。
//  ① Realtime: 承認の瞬間に push 受信（即時）。② ポーリング: webview等でwebsocketが切れても確実に追従。
//  ③ タブ復帰: フォーカス時にも再取得。
function refreshGates() { refreshLock(); refreshOvertime() }
function onVisible() { if (typeof document !== 'undefined' && document.visibilityState === 'visible') refreshGates() }
let gatePoll: ReturnType<typeof setInterval> | null = null
function stopGatePoll() { if (gatePoll) { clearInterval(gatePoll); gatePoll = null } }
function startGatePoll() { stopGatePoll(); gatePoll = setInterval(refreshGates, 15000) }

// Realtime購読（自分のworkerの許可/残業の変更を即時受信）
let gateChannel: ReturnType<ReturnType<typeof useSupabase>['channel']> | null = null
function stopRealtime() { if (gateChannel) { useSupabase().removeChannel(gateChannel); gateChannel = null } }
function startRealtime() {
  stopRealtime()
  const wid = currentUser.value?.worker_id
  if (!wid) return
  gateChannel = useSupabase()
    .channel(`report-gates-${wid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'report_edit_grants', filter: `worker_id=eq.${wid}` }, () => refreshGates())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_requests',  filter: `worker_id=eq.${wid}` }, () => refreshGates())
    .subscribe()
}

// 申請中(pending)の間だけポーリング（承認/却下で止まる）。Realtimeは常時。
watch(lockGrantStatus, (s) => { if (s === 'pending') startGatePoll(); else stopGatePoll() }, { immediate: true })
watch(() => currentUser.value?.worker_id, () => startRealtime())
onMounted(() => {
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  startRealtime()
})
onUnmounted(() => {
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  stopGatePoll(); stopRealtime()
})

// ── 残業申請（架空残業対策）: 承認済みの worker×date は固定終了の上限を解放 ──
const overtime = useOvertimeRequest()
const overtimeApprovedForDate = ref(false)
async function refreshOvertime() {
  const d = report.form.value.date
  const wid = currentUser.value?.worker_id ?? null
  overtimeApprovedForDate.value = (wid && d) ? await overtime.isApproved(wid, d) : false
}
watch([() => report.form.value.date, () => currentUser.value?.worker_id], refreshOvertime, { immediate: true })

const initializing = ref(true)

// ── 下書き自動保存／復元（新規入力のみ・編集/代理では使わない）──
const draft = useReportDraft()
const draftRestored = ref(false)   // 復元バナー表示
let draftRestoring = false         // 復元適用中は watcher の保存を抑止
// 新規入力の下書き対象か（編集/代理モードや初期化中・送信済みは対象外）
const draftEligible = () =>
  !initializing.value && !isEditMode.value && !proxy.proxyTarget.value
  && !report.submitted.value && !!liff.profile.value?.userId

// 編集モード
const forceErrorOnSubmit = ref(false)
const omissionConfirmed  = ref(false)  // 送信前の記入忘れ確認（新規送信時のみ。チェックで送信を有効化）
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
const isWorkingStr = ref<'working' | 'paid_leave' | 'off'>('working')

// 送信日が日曜かどうか（料率計算に使用）
const isSunday = computed(() =>
  new Date(report.form.value.date + 'T00:00:00').getDay() === 0
)

// 日付表示用（曜日併記）: 2026-06-29（月）
const dateWithWeekday = computed(() => {
  const ds = report.form.value.date
  if (!ds) return ''
  const d = new Date(ds + 'T00:00:00')
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  return `${ds}（${weekdays[d.getDay()]}）`
})

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
    const wins = effectiveBreakWindows(w)
    const brk = wins ? 0 : effectiveBreakMinutes(w)
    const { workedMin, ...breakdown } = computeWorkerHours(w.startTime, w.endTime, brk, sun, accum[key] ?? 0, wins)
    accum[key] = workedMin
    result[si] = breakdown
  }

  return result
})

// ── 各経費セクションの あり/なし 状態（サイトごと） ──
type UsageState = {
  selfWorking:   string
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
  selfWorking:   'あり',
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
  } else if (
    (exp.vehicles ?? []).some((v: any) => v.vehicleName || v.distanceKm || v.dieselKm || v.parkingYen || v.highwayYen) ||
    (exp.parkings ?? []).some((p: any) => p.yen) ||
    (exp.highways ?? []).some((h: any) => h.yen)
  ) {
    // 新形式: 駐車場代・高速代は車両ブロック内（車両=あり時のみ表示）なので、
    //   それらだけ入力された日報も編集時に車両=あり として復元する
    usage.vehicle = 'あり'
  }
  if ((exp.trains ?? []).some((t: any) => t.yen)) usage.train = 'あり'
  // 宿泊費: 新形式 hotels[] か旧スカラー(hotel/leopalace)のどちらかに金額があれば あり
  if ((exp.hotels ?? []).some((h: any) => h.yen || h.label) || exp.hotelYen || exp.leopalaceYen) usage.hotel = 'あり'
  if (exp.garbageFactoryM3 || exp.garbageSiteM3)  usage.garbage = 'あり'
  if ((exp.others ?? []).some((o: any) => o.yen || o.label)) usage.other = 'あり'
  if (exp.entertainmentYen || (exp.entertainments ?? []).some((e: any) => e.yen || e.label)) usage.entertainment = 'あり'
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

  let saved: any = null
  const proxyT = proxy.proxyTarget.value
  if (proxyT) {
    // 代理モード: 代理先のDBユーザーIDで取得
    const { data: proxyUserData } = await useSupabase()
      .from('users').select('id').eq('worker_id', proxyT.id).maybeSingle()
    if (proxyUserData) {
      saved = await expense.getReportByUserId(proxyUserData.id, date)
    }
  } else {
    saved = await expense.getReport(uid, date)
  }
  if (!saved) return

  originalReport.value = saved  // 差分計算のために保存

  report.form.value.date = saved.date
  isWorkingStr.value = saved.leave_type === 'paid_leave' ? 'paid_leave' : saved.is_working ? 'working' : 'off'
  report.form.value.isBusinessTrip = !!saved.is_business_trip
  report.form.value.note = saved.note ?? ''
  // 日報レベルのガソリン代（複数給油）を復元（_id は createGasolineItem 由来で一意）
  report.form.value.gasolineItems = (Array.isArray(saved.gasoline_items) ? saved.gasoline_items : []).map((g: any) => ({
    ...createGasolineItem(), payee: g.payee ?? '', yen: g.yen != null ? Number(g.yen) : undefined,
    registrationNumber: g.registrationNumber ?? '',
    liters: g.liters != null ? Number(g.liters) : undefined,
    fuelType: g.fuelType === 'diesel' ? 'diesel' : 'regular',
    tategae: !!g.tategae, fileUrls: Array.isArray(g.fileUrls) ? g.fileUrls : [],
  }))
  gasFueled.value = (report.form.value.gasolineItems?.length ?? 0) > 0

  if (saved.sites && saved.sites.length > 0) {
    report.form.value.sites = saved.sites.map((site: any) => ({
      siteName:       site.siteName ?? '',
      customSiteName: site.customSiteName,
      contractorName: site.contractorName ?? '',
      customContractorName: site.customContractorName,
      siteNote:       site.siteNote ?? '',
      // workers が空配列 = 本人稼働なし（下請けのみ）の意図的な状態なので温存する。
      // workers 自体が欠落している旧データのみ本人をデフォルト復元する。
      workers: Array.isArray(site.workers)
        ? site.workers
        : [{
            ...createWorker(currentUser.value?.worker_role ?? 'site'),
            workerName: currentUser.value?.real_name ?? '',
            workerRole: currentUser.value?.worker_role ?? 'site',
          }],
      expenses: {
        vehicles: [createVehicle()],
        parkings: [],
        highways: [],
        trains:   [createTrain()],
        others:   [createLineItem()],
        entertainments: [createLineItem()],
        ...(site.expenses ?? {}),
      },
      subcontractors: site.subcontractors ?? [],
    }))
    // 旧形式（スカラーのその他雑経費）を新形式（entertainments配列）へ移行＋スカラーをクリア（金額の二重計上を防ぐ）
    report.form.value.sites.forEach((s: any) => {
      const e = s.expenses
      if (e.entertainmentYen && !(e.entertainments ?? []).some((x: any) => x.yen)) {
        e.entertainments = [{ label: e.entertainmentLabel, yen: e.entertainmentYen, registrationNumber: e.entertainmentRegistration, tategae: e.entertainmentTategae, fileUrls: e.entertainmentUrls }]
        e.entertainmentLabel = undefined; e.entertainmentYen = undefined; e.entertainmentRegistration = undefined; e.entertainmentTategae = undefined; e.entertainmentFiles = undefined; e.entertainmentUrls = undefined
      }
      // 旧スカラーの宿泊費(hotel/leopalace)を新形式 hotels[] へ移行＋スカラーをクリア（二重計上を防ぐ）
      if (!(e.hotels ?? []).some((x: any) => x.yen) && (e.hotelYen || e.leopalaceYen)) {
        const migrated: any[] = []
        if (e.hotelYen)     migrated.push({ label: e.hotelName, yen: e.hotelYen, registrationNumber: e.hotelRegistration, tategae: e.hotelTategae, fileUrls: e.hotelUrls })
        if (e.leopalaceYen) migrated.push({ label: e.leopalaceName, yen: e.leopalaceYen, registrationNumber: e.leopalaceRegistration, tategae: e.leopalaceTategae, fileUrls: e.leopalaceUrls })
        e.hotels = migrated
        e.hotelName = undefined; e.hotelYen = undefined; e.hotelRegistration = undefined; e.hotelTategae = undefined; e.hotelFiles = undefined; e.hotelUrls = undefined
        e.leopalaceName = undefined; e.leopalaceYen = undefined; e.leopalaceRegistration = undefined; e.leopalaceTategae = undefined; e.leopalaceFiles = undefined; e.leopalaceUrls = undefined
      }
    })
    siteUsage.value = report.form.value.sites.map((site: any) => {
      const usage = reconstructExpenseUsage(site.expenses)
      // 本人の作業員レコードが無ければ「自分の稼働なし」として復元
      usage.selfWorking = (site.workers ?? []).some((w: any) => w.workerName) ? 'あり' : 'なし'
      return usage
    })
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
      // 車両なし → 駐車場代・高速代は発生しないのでクリア
      exp.parkings = []
      exp.highways = []
    } else if (value === 'あり') {
      exp.carpool = false
      if (!exp.vehicles.length) exp.vehicles = [createVehicle()]
    } else {
      exp.carpool = false
      exp.vehicles = [createVehicle()]
      exp.vehicleFiles = undefined
      // 車両なし → 駐車場代・高速代は発生しないのでクリア
      exp.parkings = []
      exp.highways = []
    }
    return
  }
  // 宿泊費を「あり」にしたら明細を1件用意（複数登録可・hotels[]）
  if (key === 'hotel' && value === 'あり') {
    if (!(exp.hotels?.length)) exp.hotels = [createLineItem()]
    return
  }
  if (value !== 'なし') return
  switch (key) {
    case 'train':
      exp.trains = [createTrain()]; exp.trainFiles = undefined
      break
    case 'hotel':
      // 宿泊費なし → 新形式 hotels[] と旧スカラー(hotel/leopalace)を両方クリア
      exp.hotels = [createLineItem()]
      exp.hotelName = undefined; exp.hotelYen = undefined; exp.hotelRegistration = undefined; exp.hotelFiles = undefined; exp.hotelUrls = undefined
      exp.leopalaceName = undefined; exp.leopalaceYen = undefined; exp.leopalaceRegistration = undefined; exp.leopalaceFiles = undefined; exp.leopalaceUrls = undefined
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
      exp.entertainments = [createLineItem()]
      exp.entertainmentLabel = undefined; exp.entertainmentYen = undefined; exp.entertainmentRegistration = undefined; exp.entertainmentTategae = undefined; exp.entertainmentFiles = undefined; exp.entertainmentUrls = undefined
      break
  }
}

/**
 * 現場ごとの「自分の稼働 あり/なし」切り替え。
 * なし = 本人は稼働せず下請けのみ → workers を空にして送信データ・給与集計から本人を除外。
 * あり = 本人の作業員レコードをデフォルト時刻で復元。
 */
function setSelfWorking(si: number, value: string) {
  siteUsage.value[si].selfWorking = value
  const site = report.form.value.sites[si]
  if (value === 'なし') {
    site.workers = []
  } else {
    site.workers = [{
      ...createWorker(currentUser.value?.worker_role ?? 'site'),
      workerName: currentUser.value?.real_name ?? '',
      workerRole: currentUser.value?.worker_role ?? 'site',
    }]
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
  // iPad Safariで現場を追加すると、フォームの高さ変化＋再描画の際にブラウザが
  // スクロール位置を勝手に戻すことがある（#現場追加スクロール位置）。
  // 追加前の位置を保持し、再描画後(nextTick)に明示的に復元して打ち消す。
  const prevScrollY = window.scrollY
  nextTick(() => { window.scrollTo(0, prevScrollY) })

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
  const s = report.form.value.sites[si]
  const cur = s?.workers?.[0]?.startTime
  let floorMin = -1   // この値「以上」のみ選択可（複数の下限の最大を採る）
  // ※ 前現場終了以降の制限は撤廃（前現場終了より前でも設定可＝80c2）。重複は送信時にバリデートする。
  // 現場の固定開始以降のみ維持（固定開始より前=早出は不可・遅刻=後ろ倒しは可）
  const fStart = siteFixedStart(s?.siteName)
  if (fStart) floorMin = Math.max(floorMin, parseMin(fStart))
  if (floorMin < 0) return TIME_OPTIONS
  // 編集で開いた古い下限割れ値は snap させないため、現在値は必ず含める。
  return TIME_OPTIONS.filter(t => parseMin(t) >= floorMin || t === cur)
}

// 送信バリデート: 同一作業員の複数現場の作業時間帯が重複していないか（重複していたらエラー文言を返す・無ければ null）
function findWorkerTimeOverlap(): string | null {
  const segs: { name: string; start: number; end: number }[] = []
  for (const s of (report.form.value.sites ?? [])) {
    const w = s?.workers?.[0]
    if (!w?.startTime || !w?.endTime) continue          // 稼働なし/未入力の現場はスキップ
    let start = parseMin(w.startTime)
    let end   = parseMin(w.endTime)
    if (end <= start) end += 1440                        // 日跨ぎ補正
    const name = s.siteName === '__other__' ? (s.customSiteName || '新規現場') : (s.siteName || '現場')
    segs.push({ name, start, end })
  }
  segs.sort((a, b) => a.start - b.start)
  for (let i = 0; i + 1 < segs.length; i++) {
    if (segs[i].end > segs[i + 1].start) {               // 前の終了 > 次の開始 = 重複
      return t('report.timeOverlapError', { a: segs[i].name, b: segs[i + 1].name })
    }
  }
  return null
}

// ── 現場の固定勤務時刻（master・name keyed）。__other__/__unset__/未設定は null ──
function siteFixedTimes(siteName: string | undefined): { start: string | null; end: string | null } | null {
  if (!siteName || siteName === '__other__' || siteName === '__unset__') return null
  return master.siteWorkTimes.value[siteName] ?? null
}
function siteFixedEnd(siteName: string | undefined): string {
  return siteFixedTimes(siteName)?.end || ''
}
function siteFixedStart(siteName: string | undefined): string {
  return siteFixedTimes(siteName)?.start || ''
}
// 現場の既定休憩[{start,minutes}]。設定ある現場のみ返す。
function siteFixedBreaks(siteName: string | undefined): { start: string; minutes: number }[] | null {
  if (!siteName || siteName === '__other__' || siteName === '__unset__') return null
  const v = master.siteBreaks.value[siteName]
  return (Array.isArray(v) && v.length) ? v : null
}
// 現場を選び直した時、固定時刻/既定休憩があれば作業時刻の既定にする（新規入力のみ。編集中の既存値は触らない）。
function onSiteChange(si: number) {
  if (isEditMode.value) return
  const s = report.form.value.sites[si]
  const w = s?.workers?.[0]
  if (!w) return
  const ft = siteFixedTimes(s?.siteName)
  if (ft?.start) w.startTime = ft.start
  if (ft?.end) w.endTime = ft.end
  // 現場に既定休憩があれば、その複数時間帯をスナップショット（breakSnapshot=trueで人件費計算が保存値を尊重）。
  //  設定が無ければ従来どおり自動計算のまま（breakSnapshotは付けない＝レガシー挙動）。
  const brks = siteFixedBreaks(s?.siteName)
  if (brks) {
    w.breaks = brks.map(b => ({ start: b.start, minutes: b.minutes }))
    w.breakMinutes = brks.reduce((sum, b) => sum + (Number(b.minutes) || 0), 0)  // 表示/後方互換用の合計
    w.breakSnapshot = true
  } else if (w.breakSnapshot) {
    w.breakSnapshot = false; w.breaks = undefined  // 休憩なし現場へ選び直したらスナップショット解除
  }
}
// 終了時刻の選択肢: 固定終了がある現場は それ以下に制限（残業申請が無い限り超過不可・早退は可）。
//  編集で開いた古い超過値は snap させないため、現在値は必ず含める。
function endTimeOptionsForSite(si: number): string[] {
  const s = report.form.value.sites[si]
  const endCap = siteFixedEnd(s?.siteName)
  if (!endCap) return TIME_OPTIONS
  // 残業申請が承認済みの日付は固定終了の上限を解放（架空残業対策の例外）。
  if (overtimeApprovedForDate.value) return TIME_OPTIONS
  const capMin = parseMin(endCap)
  const cur = s?.workers?.[0]?.endTime
  return TIME_OPTIONS.filter(t => parseMin(t) <= capMin || t === cur)
}
function removeSite(i: number) {
  report.removeSite(i)
  siteUsage.value.splice(i, 1)
}

onMounted(async () => {
  // フォームを開くたびに Supabase から最新マスタを取得し、直近に登録した
  //  下請け業者などがプルダウンに確実に反映されるようにする（編集パスと統一）。
  const masterPromise = master.fetch(true)
  if (!liff.initialized.value) await liff.init()

  // ユーザー登録チェック（キャッシュあれば即座。未登録でもフォームは使えるが経費PDFに名前が出ない）
  const userId = liff.profile.value?.userId
  if (userId) {
    selfUser.value = await expense.getUser(userId)
    if (!selfUser.value) {
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
    // 新規モード: 最初の未送信日を自動セット（代理モード時は代理先を確認）
    let nextDate: string | null
    const proxyT = proxy.proxyTarget.value
    if (proxyT) {
      // 代理モード: 代理先ユーザーのDBレコードを探してそちらの未送信日を確認
      const { data: proxyUserData } = await useSupabase()
        .from('users').select('id').eq('worker_id', proxyT.id).maybeSingle()
      // ユーザーレコードがない場合はnil UUIDで呼ぶ → 日報0件扱いでservice_start_dateが返る
      nextDate = await expense.getNextUnsubmittedDateById(
        proxyUserData?.id ?? '00000000-0000-0000-0000-000000000000'
      )
    } else {
      nextDate = await expense.getNextUnsubmittedDate(userId)
    }
    if (nextDate === null) {
      // null = サービス開始日が設定済み かつ 全送信済み
      allSubmitted.value = true
    } else if (nextDate !== 'NOT_CONFIGURED') {
      // 未送信日が見つかった場合はその日付をセット
      report.form.value.date = nextDate
    }
    // 'NOT_CONFIGURED' の場合はデフォルト（今日）のまま
  }

  // 新規モードのみ: 同じ日付の下書きがあれば復元（編集/代理は対象外）。
  //  テキスト/選択は localStorage、領収書画像(File[])は IndexedDB から復元する。
  if (!isEditMode.value && !proxy.proxyTarget.value && userId) {
    const d = draft.load(userId, report.form.value.date)
    if (d && d.form) {
      draftRestoring = true
      try {
        report.form.value = d.form
        gasFueled.value = (report.form.value.gasolineItems?.length ?? 0) > 0   // 下書きにガソリン明細があれば「給油あり」を復元
        if (d.isWorkingStr) isWorkingStr.value = d.isWorkingStr as 'working' | 'paid_leave' | 'off'
        if (Array.isArray(d.siteUsage) && d.siteUsage.length) siteUsage.value = d.siteUsage
        // 画像（File[]）を IndexedDB から復元してフォームへ再注入
        const fm = await draft.loadFiles(userId, report.form.value.date)
        if (fm) applyDraftFiles(report.form.value, fm)
        draftRestored.value = true
      } finally {
        draftRestoring = false
      }
    }
  }

  initializing.value = false
})

// ── 下書き自動保存（新規入力中・800ms デバウンス・送信ロジックには触れない）──
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [report.form.value, isWorkingStr.value, siteUsage.value],
  () => {
    if (draftRestoring || !draftEligible()) return
    if (draftSaveTimer) clearTimeout(draftSaveTimer)
    draftSaveTimer = setTimeout(() => {
      const uid = liff.profile.value?.userId
      if (uid && draftEligible()) {
        const date = report.form.value.date
        draft.save(uid, date, {
          form:         report.form.value,
          isWorkingStr: isWorkingStr.value,
          siteUsage:    siteUsage.value,
        })
        // 画像（File[]）は IndexedDB へ（fire-and-forget）
        draft.saveFiles(uid, date, collectDraftFiles(report.form.value))
      }
    }, 800)
  },
  { deep: true },
)

// 送信成功で下書き破棄（新規送信の成功＝report.submitted）
watch(() => report.submitted.value, (v) => {
  if (!v) return
  const uid = liff.profile.value?.userId
  if (uid) { draft.clear(uid, report.form.value.date); draft.clearFiles(uid, report.form.value.date) }
  draftRestored.value = false
})

// フォームから「パス→File[]」マップを収集（IndexedDB保存用）
const DRAFT_FORM_FILE_KEYS = ['vehicleFiles', 'hotelFiles', 'leopalaceFiles', 'otherFiles', 'entertainmentFiles', 'garbagePhotos']
const DRAFT_PER_ITEM = ['parkings', 'highways', 'trains', 'others', 'entertainments', 'hotels']
function collectDraftFiles(form: any): Record<string, File[]> {
  const map: Record<string, File[]> = {}
  ;(form?.sites ?? []).forEach((site: any, si: number) => {
    const exp = site?.expenses || {}
    // ※ reactive Proxy 配列のままだと IndexedDB の structured-clone で失敗するため、
    //   プレーン配列（Array.from）にアンラップして渡す。File 自体は非reactive。
    for (const k of DRAFT_FORM_FILE_KEYS) {
      if (Array.isArray(exp[k]) && exp[k].length) map[`${si}::${k}`] = Array.from(exp[k])
    }
    for (const arrKey of DRAFT_PER_ITEM) {
      ;(exp[arrKey] ?? []).forEach((item: any, ii: number) => {
        if (Array.isArray(item?.files) && item.files.length) map[`${si}::${arrKey}::${ii}`] = Array.from(item.files)
      })
    }
  })
  return map
}
// 収集したマップを復元後フォームの同じパスへ再注入
function applyDraftFiles(form: any, map: Record<string, File[]>) {
  for (const [path, files] of Object.entries(map || {})) {
    const parts = path.split('::')
    const site = form?.sites?.[Number(parts[0])]
    if (!site?.expenses) continue
    if (parts.length === 2) {
      site.expenses[parts[1]] = files
    } else {
      const item = site.expenses[parts[1]]?.[Number(parts[2])]
      if (item) item.files = files
    }
  }
}

// バナーから「破棄して新規入力」: 下書き削除＋当日付のまま初期化
function discardDraft() {
  const uid = liff.profile.value?.userId
  const curDate = report.form.value.date
  if (uid) { draft.clear(uid, curDate); draft.clearFiles(uid, curDate) }
  draftRestoring = true
  report.reset()
  report.form.value.date = curDate
  isWorkingStr.value = 'working'
  siteUsage.value = [createUsage()]
  initWorkers()
  draftRestored.value = false
  nextTick(() => { draftRestoring = false })
}

// ── LINE通知プレビュー ──────────────────────────────────────
// 送信前の最終確認テーブル用データ。実際の保存(saveReportById等)と同じ form/computeWorkerHours
// から組むため、プレビューと保存後表示のズレが起きない（旧LINE風テキスト<pre>から移行・2026-07-10）。
type PreviewWorkerRow = { name: string; hours: string; timeRange: string }
type PreviewSite = {
  name: string
  contractor: string
  workers: PreviewWorkerRow[]
  expenses: string[]
  subs: string[]
  note: string
}
type PreviewData = {
  dateLabel: string
  senderName: string
  mode: 'paid_leave' | 'off' | 'working'
  note: string
  sites: PreviewSite[]
}
const previewData = computed<PreviewData>(() => {
  const form      = report.form.value
  const isWorking = isWorkingStr.value === 'working'
  const d         = new Date(form.date + 'T00:00:00')
  const weekdays  = ['日', '月', '火', '水', '木', '金', '土']
  const dateLabel = `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`
  const sunday    = d.getDay() === 0
  const senderName = currentUser.value?.real_name || '（未登録）'

  if (isWorkingStr.value === 'paid_leave') {
    return { dateLabel, senderName, mode: 'paid_leave', note: form.note || '', sites: [] }
  }
  if (!isWorking) {
    return { dateLabel, senderName, mode: 'off', note: form.note || '', sites: [] }
  }

  const sites: PreviewSite[] = []
  for (const site of form.sites) {
    if (!site.siteName) continue
    const displayName = site.siteName === '__other__'
      ? (site.customSiteName || '新規現場')
      : site.siteName
    const contractorName = site.contractorName === '__other__'
      ? (site.customContractorName || '')
      : (site.contractorName || '')

    const workers: PreviewWorkerRow[] = []
    for (const w of (site.workers || []).filter((w: any) => w.workerName)) {
      const wins = effectiveBreakWindows(w)
      const brk = wins ? 0 : effectiveBreakMinutes(w)
      const h   = computeWorkerHours(w.startTime || '08:00', w.endTime || '17:30', brk, sunday, 0, wins)
      const parts: string[] = []
      if (h.hoursNormal)        parts.push(`${h.hoursNormal}h`)
      if (h.hoursSunday)        parts.push(`休日${h.hoursSunday}h`)
      if (h.hoursOT)            parts.push(`残業${h.hoursOT}h`)
      if (h.hoursNight)         parts.push(`深夜${h.hoursNight}h`)
      if (h.hoursOTNight)       parts.push(`深夜残業${h.hoursOTNight}h`)
      if (h.hoursSundayOT)      parts.push(`休日残業${h.hoursSundayOT}h`)
      if (h.hoursSundayNight)   parts.push(`休日深夜${h.hoursSundayNight}h`)
      if (h.hoursSundayOTNight) parts.push(`休日深夜残業${h.hoursSundayOTNight}h`)
      const timeRange = w.startTime && w.endTime ? `${w.startTime}〜${w.endTime}` : '—'
      workers.push({ name: w.workerName, hours: parts.join(' + ') || '—', timeRange })
    }

    const exp = site.expenses || {}
    const expenses: string[] = []
    if (exp.carpool) {
      expenses.push('乗合い')
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
        if (p.length) expenses.push(p.join(' '))
      }
    }
    for (const t of (exp.trains || []))
      if (t?.yen) expenses.push(`${t.label || '電車'} ¥${Number(t.yen).toLocaleString()}`)
    for (const o of (exp.others || []))
      if (o?.yen) expenses.push(`${o.label || 'その他'} ¥${Number(o.yen).toLocaleString()}`)
    for (const ho of (exp.hotels || []))
      if (ho?.yen) expenses.push(`${ho.label || 'ホテル'} ¥${Number(ho.yen).toLocaleString()}`)
    const _hasHotelsArr = (exp.hotels || []).some((h: any) => h?.yen)
    if (exp.hotelYen && !_hasHotelsArr)
      expenses.push(`${exp.hotelName || 'ホテル'} ¥${Number(exp.hotelYen).toLocaleString()}`)
    if (exp.leopalaceYen && !_hasHotelsArr)
      expenses.push(`${exp.leopalaceName || 'レオパレス'} ¥${Number(exp.leopalaceYen).toLocaleString()}`)
    if (exp.garbageFactoryM3 || exp.garbageSiteM3) {
      const g: string[] = []
      if (exp.garbageFactoryM3) g.push(`木材のみ ${exp.garbageFactoryM3}m³`)
      if (exp.garbageSiteM3)    g.push(`混載 ${exp.garbageSiteM3}m³`)
      expenses.push(`ゴミ ${g.join(' ')}`)
    }
    if (exp.entertainmentYen)
      expenses.push(`${exp.entertainmentLabel || '雑経費'} ¥${Number(exp.entertainmentYen).toLocaleString()}`)

    const subs: string[] = (site.subcontractors || [])
      .filter((s: any) => s.subcontractorName)
      .map((s: any) => {
        const name = s.subcontractorName === '__other__' ? (s.customSubcontractorName || '新規業者') : s.subcontractorName
        return `${name} ${s.count || 1}人`
      })

    sites.push({ name: displayName, contractor: contractorName, workers, expenses, subs, note: site.siteNote || '' })
  }

  return { dateLabel, senderName, mode: 'working', note: form.note || '', sites }
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
  report.form.value.isWorking  = isWorkingStr.value === 'working' || isWorkingStr.value === 'paid_leave'
  report.form.value.leaveType  = isWorkingStr.value === 'paid_leave' ? 'paid_leave' : null

  // ── 過去3日ロック: ロック窓(3日以上前)かつ未承認なら 提出/編集を弾く（バックストップ）──
  {
    const lockDate = report.form.value.date
    if (lock.isPastLockWindow(lockDate)) {
      const wid = currentUser.value?.worker_id ?? null
      if (await lock.isLocked(wid, lockDate)) {
        currentDateLocked.value = true
        const msg = t('report.lockedSubmit')
        if (isEditMode.value) editError.value = msg
        alert(msg)
        return
      }
    }
  }

  // ── 送信バリデート: 稼働ありで複数現場の作業時間帯が重複していたら弾く（80c2・開始時刻の制限撤廃に伴う安全網）──
  if (report.form.value.isWorking) {
    const overlapMsg = findWorkerTimeOverlap()
    if (overlapMsg) {
      if (isEditMode.value) editError.value = overlapMsg
      alert(overlapMsg)
      return
    }
  }

  // ── 編集モード: Supabase のみ更新（GAS には再送しない）──
  if (isEditMode.value) {
    if (editSubmitting.value) return
    editSubmitting.value = true
    editError.value = null
    try {
      const uid = liff.profile.value?.userId
      if (!uid) throw new Error(t('report.errorNoLogin'))

      if (forceErrorOnSubmit.value) {
        forceErrorOnSubmit.value = false
        throw new Error('[テスト] Supabase保存エラー: connection timeout')
      }

      // 代理モード時は代理先のユーザーIDで保存
      const editProxyT = proxy.proxyTarget.value
      if (editProxyT) {
        const editTargetId = await expense.findOrCreateProxyUser(editProxyT.id, editProxyT.name, editProxyT.worker_role)
        await expense.saveReportById(editTargetId, {
          date:      report.form.value.date,
          isWorking:  report.form.value.isWorking,
          leaveType:  isWorkingStr.value === 'paid_leave' ? 'paid_leave' : null,
          isBusinessTrip: isWorkingStr.value === 'working' ? !!report.form.value.isBusinessTrip : false,
          sites:      report.form.value.sites,
          note:       report.form.value.note,
          gasolineItems:   isWorkingStr.value === 'working' ? (report.form.value.gasolineItems ?? []) : [],
        })
      } else {
        await expense.saveReport(uid, {
          date:      report.form.value.date,
          isWorking:  report.form.value.isWorking,
          leaveType:  isWorkingStr.value === 'paid_leave' ? 'paid_leave' : null,
          isBusinessTrip: isWorkingStr.value === 'working' ? !!report.form.value.isBusinessTrip : false,
          sites:      report.form.value.sites,
          note:       report.form.value.note,
          gasolineItems:   isWorkingStr.value === 'working' ? (report.form.value.gasolineItems ?? []) : [],
        })
      }

      // 差分を計算してLINEグループに通知
      const efUrl = config.public.edgeFunctionUrl
      if (originalReport.value && efUrl) {
        const diffs = computeDiff(originalReport.value, {
          isWorking:  report.form.value.isWorking,
          leaveType:  isWorkingStr.value === 'paid_leave' ? 'paid_leave' : null,
          sites:      report.form.value.sites,
          note:       report.form.value.note,
        })
        if (diffs.length > 0) {
          const now = new Date()
          const editedAt = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          const fnPrefix = config.public.appEnv === 'development' ? 'test-' : ''
          // 身元優先のスラッグ（email/pwは自テナント・LINEはenv）
          const acctSlug = await useAccount().effectiveSlug()
          fetch(`${efUrl}/${fnPrefix}notify-edit`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              sender:      currentUser.value?.real_name || '',
              date:        report.form.value.date,
              editedAt,
              diffs,
              accountSlug: acctSlug,
            }),
          }).catch(e => console.error('[Edit] LINE通知エラー:', e))
        }
      }

      editSubmitted.value = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('report.errorUpdateFailed')
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
    // 代理入力中は代理先の line_user_id を使用（自分のLINE IDではなく対象者として記録）
    report.form.value.senderId = currentUser.value.line_user_id
  }

  if (forceErrorOnSubmit.value) {
    forceErrorOnSubmit.value = false
    editError.value = '[テスト] GAS送信エラー: network request failed'
    notifyErrorToLine('日報新規送信（テスト）', 'network request failed')
    return
  }

  // ① Supabaseに先に保存（画面を閉じてもデータが消えないよう順序を優先）
  const uid = liff.profile.value?.userId

  // 代理モード時はA-sanのuser_idを取得（なければ自動作成）
  let targetUserId: string | null = null
  const proxyT = proxy.proxyTarget.value
  if (proxyT) {
    try {
      targetUserId = await expense.findOrCreateProxyUser(proxyT.id, proxyT.name, proxyT.worker_role)
    } catch (e) {
      console.error('[Report] 代理ユーザー取得失敗:', e)
    }
  } else if (uid) {
    targetUserId = selfUser.value?.id ?? null
  }

  if (targetUserId) {
    try {
      await expense.saveReportById(targetUserId, {
        date:      report.form.value.date,
        isWorking: report.form.value.isWorking,
        leaveType: report.form.value.leaveType,
        isBusinessTrip: isWorkingStr.value === 'working' ? !!report.form.value.isBusinessTrip : false,
        sites:     report.form.value.sites,
        note:      report.form.value.note,
        gasolineItems:   isWorkingStr.value === 'working' ? (report.form.value.gasolineItems ?? []) : [],
      })
    } catch (e: unknown) {
      const msg = String((e as any)?.message ?? e ?? 'Supabase保存エラー')
      console.error('[Report] Supabase保存エラー:', e)
      notifyErrorToLine('日報新規送信（DB保存）', msg)
      if (!proxyT && (msg.includes('ユーザーが登録されていません') || msg.includes('foreign key'))) {
        if (uid) expense.clearUserCache(uid)
        selfUser.value = null
        await navigateTo('/register')
        return
      }
      // DB保存失敗でもGAS送信は続行
    }
  }

  // ② GASに送信（LINE通知・keepalive: true でページ閉じても通信継続）
  await report.submit()

  // ③ ファイルアップロード後に *Urls を含めて Supabase を再保存（URLを反映するため）
  if (!report.error.value && targetUserId) {
    expense.saveReportById(targetUserId, {
      date:      report.form.value.date,
      isWorking: report.form.value.isWorking,
      leaveType: report.form.value.leaveType,
      isBusinessTrip: isWorkingStr.value === 'working' ? !!report.form.value.isBusinessTrip : false,
      sites:     report.form.value.sites,
      note:      report.form.value.note,
      gasolineItems:   isWorkingStr.value === 'working' ? (report.form.value.gasolineItems ?? []) : [],
    }).catch(e => console.error('[Report] URL再保存エラー:', e))
  }

  // ④ 次の未送信日を取得してサクセス画面に表示（自己・代理とも）
  //    targetUserId は代理なら代理先・自己なら自分の user.id。これで統一して
  //    代理入力でも「翌日分の日報」ボタンを出す。
  if (!report.error.value && targetUserId) {
    const next = await expense.getNextUnsubmittedDateById(targetUserId).catch(() => null)
    if (next && next !== 'NOT_CONFIGURED') {
      nextUnsubmittedDate.value = next
    }
  }
}

// 代理モード切り替え時にフォームをリセット・日付を再セット
watch(() => proxy.proxyTarget.value, async (newTarget, oldTarget) => {
  // onMounted の初回セット時は無視
  if (!selfUser.value) return
  const userId = liff.profile.value?.userId
  if (!userId) return

  // フォームをリセット
  report.reset()
  siteUsage.value = [createUsage()]
  isWorkingStr.value = 'working'
  allSubmitted.value = false
  initializing.value = true

  let nextDate: string | null
  if (newTarget) {
    const { data: proxyUserData } = await useSupabase()
      .from('users').select('id').eq('worker_id', newTarget.id).maybeSingle()
    nextDate = await expense.getNextUnsubmittedDateById(
      proxyUserData?.id ?? '00000000-0000-0000-0000-000000000000'
    )
  } else {
    nextDate = await expense.getNextUnsubmittedDate(userId)
  }

  if (nextDate === null) {
    allSubmitted.value = true
  } else if (nextDate !== 'NOT_CONFIGURED') {
    report.form.value.date = nextDate
  }

  initWorkers()
  initializing.value = false
})

function goToNextReport() {
  const date = nextUnsubmittedDate.value
  if (!date) return
  nextUnsubmittedDate.value = null
  report.reset()
  omissionConfirmed.value = false
  report.form.value.date = date
  siteUsage.value = [createUsage()]
  isWorkingStr.value = 'working'
  initWorkers()
}

async function handleReset() {
  report.reset()
  omissionConfirmed.value = false
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

// 駐車場代・高速代は明細ごとに個別の領収書を持つ
// 添付ファイルの削除（AttachedFilesBadge の ✕ から）。source='file'=選択中File / 'url'=保存済みfileUrls。
function removeItemFile(item: { files?: File[]; fileUrls?: string[] } | null | undefined, p: { source: 'file' | 'url'; index: number }) {
  if (!item) return
  if (p.source === 'file') item.files?.splice(p.index, 1)
  else item.fileUrls?.splice(p.index, 1)
}
// ガソリン明細はFileを gasFilesById(map) に持つため別ハンドラ。
function removeGasFile(g: { _id?: number; fileUrls?: string[] }, p: { source: 'file' | 'url'; index: number }) {
  if (p.source === 'file') gasFilesById.value[g._id ?? -1]?.splice(p.index, 1)
  else g.fileUrls?.splice(p.index, 1)
}

function handleParkingFile(si: number, pi: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const pk = report.form.value.sites[si].expenses.parkings?.[pi]
  if (pk) pk.files = Array.from(input.files)
}
function handleHighwayFile(si: number, hi: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const hw = report.form.value.sites[si].expenses.highways?.[hi]
  if (hw) hw.files = Array.from(input.files)
}
function handleTrainFile(si: number, ti: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const tr = report.form.value.sites[si].expenses.trains?.[ti]
  if (tr) tr.files = Array.from(input.files)
}
function handleOtherFile(si: number, oi: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const ot = report.form.value.sites[si].expenses.others?.[oi]
  if (ot) ot.files = Array.from(input.files)
}
function handleEntertainmentFile(si: number, ei: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const ent = report.form.value.sites[si].expenses.entertainments?.[ei]
  if (ent) ent.files = Array.from(input.files)
}

function handleHotelFile(si: number, hi: number, event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const ho = report.form.value.sites[si].expenses.hotels?.[hi]
  if (ho) ho.files = Array.from(input.files)
}

/** 領収書 AI 解析 → フォームに自動入力 */
// ── 本日のガソリン代（日報レベル・複数給油）：給油有無トグル＋明細ごとの領収書アップロード＋AI解析 ──
const gasFueled = ref(false)   // 本日 給油あり/なし。なし の時は明細を隠す
const gasFilesById = ref<Record<number, File[]>>({})   // 明細(_id)ごとの選択File（AI/表示用・非永続）
const gasUploadingId = ref<number | null>(null)
const gasAnalyzingId = ref<number | null>(null)

function setGasFueled(yes: boolean) {
  gasFueled.value = yes
  if (yes) {
    // 「あり」にしたら明細が無ければ1件用意
    if (!(report.form.value.gasolineItems?.length)) report.addGasolineItem()
  } else {
    // 「なし」に戻したら明細をクリア（誤集計防止）
    report.form.value.gasolineItems = []
    gasFilesById.value = {}
  }
}

async function onGasItemFile(gi: number, e: Event) {
  const item = report.form.value.gasolineItems?.[gi]
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!item || !f) return
  const id = item._id ?? -1
  gasFilesById.value = { ...gasFilesById.value, [id]: [f] }
  // 即アップロード → item.fileUrls に格納（送信時のアップロード配線に依存しない）
  gasUploadingId.value = id
  try {
    const slug = await useAccount().effectiveSlug()
    const date = report.form.value.date
    const period = Number(date.slice(8, 10)) <= 15 ? 'first' : 'second'
    const lineIdToken = (await liff.getIdToken()) ?? ''
    const urls = await uploadExpenseFiles(useSupabase(), [f], date, currentUser.value?.real_name || 'worker', 'gasoline', `gasoline_${gi}`, slug, period, lineIdToken, {
      edgeFunctionUrl: config.public.edgeFunctionUrl as string,
      supabaseUrl: config.public.supabaseUrl as string,
      supabaseAnonKey: config.public.supabaseAnonKey as string,
    })
    item.fileUrls = urls
  } catch (err) {
    showReceiptToast('error', t('report.gasUploadFailed'))
  } finally {
    gasUploadingId.value = null
  }
  // AI解析は自動では走らせない（任意・「領収書から金額」ボタンで実行）。
}

async function analyzeGasItem(gi: number) {
  const item = report.form.value.gasolineItems?.[gi]
  if (!item) return
  const id = item._id ?? -1
  const f = gasFilesById.value[id]?.[0]
  if (!f) return
  gasAnalyzingId.value = id
  const result = await receipt.analyze(f, `gasoline-${id}`)
  gasAnalyzingId.value = null
  if (!result || (!result.yen && !result.label && !result.invoiceNumber)) { showReceiptToast('error', t('report.gasAnalyzeFailed')); return }
  if (result.yen) item.yen = result.yen
  if (result.storeName) item.payee = result.storeName
  if (result.invoiceNumber) item.registrationNumber = result.invoiceNumber
  showReceiptToast('success', t('report.analyzeSuccess'))
}

async function analyzeReceipt(
  si: number,
  field: 'hotelFiles' | 'leopalaceFiles' | 'hotel' | 'other' | 'entertainment' | 'parking' | 'highway' | 'train',
  otherIndex?: number,
) {
  const exp = report.form.value.sites[si].expenses
  // 明細ごと領収書（駐車/高速/電車）は item.files[0] を解析
  let file: File | undefined
  let key: string
  if (field === 'parking') { file = exp.parkings?.[otherIndex!]?.files?.[0]; key = `${si}-parking-${otherIndex}` }
  else if (field === 'highway') { file = exp.highways?.[otherIndex!]?.files?.[0]; key = `${si}-highway-${otherIndex}` }
  else if (field === 'train') { file = exp.trains?.[otherIndex!]?.files?.[0]; key = `${si}-train-${otherIndex}` }
  else if (field === 'other') { file = exp.others?.[otherIndex!]?.files?.[0]; key = `${si}-other-${otherIndex}` }
  else if (field === 'entertainment') { file = exp.entertainments?.[otherIndex!]?.files?.[0]; key = `${si}-entertainment-${otherIndex}` }
  else if (field === 'hotel') { file = exp.hotels?.[otherIndex!]?.files?.[0]; key = `${si}-hotel-${otherIndex}` }
  else {
    file = (report.form.value.sites[si].expenses[field] as File[] | undefined)?.[0]
    key = `${si}-${field}`
  }
  if (!file) return
  const result = await receipt.analyze(file, key)
  if (!result) {
    showReceiptToast('error', receipt.error.value ?? t('report.analyzeFailed'))
    return
  }
  showReceiptToast('success', t('report.analyzeSuccess'))

  const inv = result.invoiceNumber || 'なし'
  // 明細ごと（駐車=金額／高速=金額／電車=区間＋金額）
  if (field === 'parking') {
    const item = exp.parkings?.[otherIndex!]
    if (item) {
      if (result.yen) item.yen = result.yen
      if (result.storeName) item.payee = result.storeName
      item.registrationNumber = inv   // AI解析の登録番号を反映（読めなければ「なし」）
    }
    return
  }
  if (field === 'highway') {
    const item = exp.highways?.[otherIndex!]
    if (item) {
      if (result.yen) item.yen = result.yen
      if (result.storeName) item.payee = result.storeName
      item.registrationNumber = inv
    }
    return
  }
  if (field === 'train') {
    const item = exp.trains?.[otherIndex!]
    if (item) {
      if (result.label) item.label = result.label
      if (result.storeName) item.payee = result.storeName
      if (result.yen)   item.yen   = result.yen
      item.registrationNumber = inv
    }
    return
  }
  if (field === 'other') {
    const item = exp.others?.[otherIndex!]
    if (item) {
      if (result.label) item.label              = result.label
      if (result.label) item.payee              = result.label
      if (result.yen)   item.yen                = result.yen
      item.registrationNumber = inv
    }
    return
  }
  if (field === 'entertainment') {
    const item = exp.entertainments?.[otherIndex!]
    if (item) {
      if (result.label) item.label              = result.label
      if (result.label) item.payee              = result.label
      if (result.yen)   item.yen                = result.yen
      item.registrationNumber = inv
    }
    return
  }
  if (field === 'hotel') {
    const item = exp.hotels?.[otherIndex!]
    if (item) {
      if (result.label) item.label              = result.label
      if (result.label) item.payee              = result.label
      if (result.yen)   item.yen                = result.yen
      item.registrationNumber = inv
    }
    return
  }
  if (field === 'hotelFiles') {
    if (result.label) exp.hotelName          = result.label
    if (result.yen)   exp.hotelYen           = result.yen
    exp.hotelRegistration = inv
  } else if (field === 'leopalaceFiles') {
    if (result.label) exp.leopalaceName         = result.label
    if (result.yen)   exp.leopalaceYen          = result.yen
    exp.leopalaceRegistration = inv
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
    // 元請け業者: マスタにあれば既存を選択、なければ「その他」で新規入力をテスト
    const con = master.contractorNames.value
    site0.contractorName       = con[0] || '__other__'
    site0.customContractorName = con[0] ? '' : 'テスト元請け建設'
    // 自分の稼働あり → 時刻を上書き
    siteUsage.value[0].selfWorking = 'あり'
    if (site0.workers[0]) { site0.workers[0].startTime = '08:00'; site0.workers[0].endTime = '17:30' }
    site0.subcontractors = [
      { subcontractorId: '', subcontractorName: sub[0] || '__other__', customSubcontractorName: sub[0] ? '' : 'テスト業者A', count: 2 },
      { subcontractorId: '', subcontractorName: '__other__', customSubcontractorName: '新規テスト業者', count: 1 },
    ]
    siteUsage.value[0].expense = 'あり'
    siteUsage.value[0].vehicle = 'あり'
    site0.expenses.carpool = false
    // 個人建て替え（tategae）は true/false を混在させ、PDFの「全経費／個人建て替え分のみ」両方を検証可能に
    site0.expenses.vehicles = [{ vehicleName: 'ハイエース', distanceKm: 80, dieselKm: undefined, parkingYen: 500, highwayYen: 1200, etcUsed: true, etcCard: 'カード①', gasTategae: false, parkingTategae: true, highwayTategae: true }]
    siteUsage.value[0].train = 'あり'
    site0.expenses.trains = [{ label: '名古屋→大阪', yen: 3000, tategae: true }]
    siteUsage.value[0].hotel = 'あり'
    site0.expenses.hotels = [
      { label: 'アパホテル名古屋', yen: 8000,  tategae: false, registrationNumber: 'T1234567890123' },
      { label: 'レオパレス栄',     yen: 50000, tategae: false, registrationNumber: 'T9876543210987' },
    ]
    siteUsage.value[0].garbage = 'あり'
    site0.expenses.garbageFactoryM3 = 3
    site0.expenses.garbageSiteM3    = 5
    siteUsage.value[0].other = 'あり'
    site0.expenses.others = [{ label: '養生テープ', yen: 1500, registrationNumber: 'なし', tategae: true }]
    siteUsage.value[0].entertainment = 'あり'
    site0.expenses.entertainmentLabel = '懇親会'
    site0.expenses.entertainmentYen   = 10000
    site0.expenses.entertainmentTategae = false
    site0.expenses.entertainmentRegistration = 'T1111222233334'

    // ── 現場2（新規現場「その他」） ── を追加
    addSite()
  }

  // ── 新規現場「その他」（既存あり→2つ目 / 既存なし→1つ目） ──
  const newIdx = hasExisting ? 1 : 0
  const siteN = report.form.value.sites[newIdx]
  siteN.siteName = '__other__'
  siteN.customSiteName = 'テスト新規現場'
  // 元請け業者: 「その他」で新規入力をテスト
  siteN.contractorName       = '__other__'
  siteN.customContractorName = '新規テスト元請け'
  // workers はログインユーザー固定 → addSite() で17:30〜21:30 が自動セット済み（現場跨ぎ残業の検証）
  siteN.subcontractors = [
    { subcontractorId: '', subcontractorName: sub[1] || sub[0] || '__other__', customSubcontractorName: (sub[1] || sub[0]) ? '' : 'テスト業者B', count: 1 },
  ]
  siteUsage.value[newIdx].expense = 'あり'
  siteUsage.value[newIdx].vehicle = '乗合い'
  siteN.expenses.carpool = true
  siteN.expenses.vehicles = []
  siteUsage.value[newIdx].train = 'あり'
  siteN.expenses.trains = [{ label: '大阪→名古屋', yen: 2500, tategae: true }]
  siteUsage.value[newIdx].garbage = 'あり'
  siteN.expenses.garbageFactoryM3 = 2
  siteN.expenses.garbageSiteM3    = 4
  siteUsage.value[newIdx].other = 'あり'
  siteN.expenses.others = [{ label: 'ビニールシート', yen: 800, registrationNumber: 'なし', tategae: false }]
  siteUsage.value[newIdx].entertainment = 'あり'
  siteN.expenses.entertainmentLabel = '昼食代'
  siteN.expenses.entertainmentYen   = 5000
  siteN.expenses.entertainmentTategae = true
  siteN.expenses.entertainmentRegistration = 'なし'
}
</script>

<style>
/* ── リセット＆変数 ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* 使い方ガイド再表示ボタン */
.ob-replay { display: block; margin: 8px auto 0; background: #fff; border: 1px solid #d6dde2; color: #5a6b78; border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
.ob-replay:hover { background: #f4f7f9; }
.ob-replay-icon { font-size: 13px; vertical-align: -2px; margin-right: 2px; }
.banner-icon { font-size: 14px; vertical-align: -2px; margin-right: 2px; }

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
.self-off-check {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; color: var(--text1); cursor: pointer; user-select: none;
}
.self-off-check input { width: 18px; height: 18px; flex-shrink: 0; cursor: pointer; }
.worker-time-rows { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.worker-time-row  { display: flex; gap: 6px; align-items: flex-end; }
.worker-time-row .time-field { flex: 1; }
.worker-break-row .time-field { width: auto; min-width: 140px; }
.break-auto { white-space: nowrap; }
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
.unset-hint { margin-top: 6px; }
.fixed-time-note { margin-top: 4px; font-size: 12px; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 6px 10px; line-height: 1.5; }
.overtime-link { display: inline-block; margin-top: 2px; color: #b45309; font-weight: 700; text-decoration: underline; }
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

/* 駐車場代・高速代の明細カード（金額＋個別領収書） */
.lineitem-card {
  border: 1px solid var(--border); border-radius: 8px;
  padding: 10px; background: var(--surface2); margin-bottom: 8px;
}
/* 宿泊先カード: 削除✕はカード右上（金額横ではなく「この宿泊先を削除」と分かる位置） */
.hotel-item { position: relative; padding-top: 14px; }
.hotel-item .btn-remove-card {
  position: absolute; top: 6px; right: 6px; z-index: 1;
  width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: #888; font-size: 14px; line-height: 1; cursor: pointer;
}
/* 車両ブロック内の駐車場代・高速代サブ項目 */
.veh-subexpense { margin-top: 12px; }
.veh-subexpense > .hours-label { display: block; font-weight: 700; margin-bottom: 4px; }

/* ── その他共通経費 ── */
.hotel-row { display: flex; flex-direction: column; gap: 6px; }
.trip-toggle { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 10px 12px; background: #f6f8ff; border: 1px solid #d8e0ff; border-radius: 8px; font-size: 14px; font-weight: 600; color: #34406b; cursor: pointer; }
.trip-toggle input { width: 18px; height: 18px; }
.lineitems-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; margin-bottom: 6px; }
/* ExpenseField の入れ子(.expense-item)を解いて、行直下のフレックス要素として並べる */
.lineitems-row .expense-item { display: contents; }
.lineitems-row .expense-label { display: none; }      /* 行内では「金額」ラベルは省略 */
.lineitems-row > .input { flex: 1 1 auto; min-width: 0; } /* 内容入力（直下の子のみ） */
.lineitems-row .expense-input { flex: 0 0 120px; }    /* 金額入力は固定幅で内容の右に */
.lineitems-row .btn-icon-sm { flex: 0 0 auto; }       /* ✕ ボタン */
/* 立替チェックは全幅で次行・左詰め（タップしやすいよう余白はコンポーネント側で確保） */
.lineitems-row .tategae-check { flex-basis: 100%; order: 1; }
/* 登録番号は全幅で最後の行へ */
.lineitems-row .input.mt6 { flex-basis: 100%; order: 2; margin-top: 0; }

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
.submit-confirm {
  display: flex; align-items: center; gap: 10px;
  margin: 4px 0 8px; padding: 12px 14px;
  background: #fff8e1; border: 1px solid #ffe082; border-radius: var(--radius);
  font-size: 14px; font-weight: 700; color: #111; cursor: pointer;
}
.submit-confirm input { width: 20px; height: 20px; flex-shrink: 0; }

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
.locked-notice {
  margin-top: 8px;
  padding: 8px 12px;
  background: #FEF2F2;
  border: 1px solid #FECACA;
  border-radius: 8px;
  font-size: 13px;
  color: #B91C1C;
  font-weight: 700;
  line-height: 1.6;
}
/* ロック日の許可依頼ボタン／申請中表示＋モーダル */
.locked-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.btn-unlock { font-size: 13px; font-weight: 700; color: #b45309; background: #fff; border: 1px solid #fbbf24; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
.btn-unlock-cancel { font-size: 12px; color: #64748b; background: #f1f5f9; border: none; border-radius: 8px; padding: 7px 12px; cursor: pointer; }
.locked-pending { font-size: 12px; color: #b45309; font-weight: 700; }
.req-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 100; }
.req-modal { background: #fff; border-radius: 14px; padding: 20px; width: 100%; max-width: 420px; }
.req-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; color: #111827; }
.req-sub { font-size: 12px; color: #6b7280; margin: 0 0 10px; line-height: 1.5; }
.req-textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font-size: 14px; resize: vertical; }
.req-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
.req-cancel { font-size: 14px; color: #64748b; background: #f1f5f9; border: none; border-radius: 8px; padding: 9px 16px; cursor: pointer; }
.req-submit { font-size: 14px; font-weight: 700; color: #fff; background: #06C755; border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; }
.req-submit:disabled { opacity: .6; cursor: default; }

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

/* 下書き復元バナー */
.draft-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #e8f5e9;
  border: 1px solid #06C755;
  color: #1b5e20;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
}
.draft-banner-text { line-height: 1.5; }
.draft-discard {
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #06C755;
  color: #06C755;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

/* ── 送信前の最終確認テーブル ── */
.preview-block {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: var(--radius);
  overflow: hidden;
}
.preview-label {
  font-size: 11px; font-weight: 800; letter-spacing: 1px;
  color: #475569; padding: 8px 14px;
  background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
}
.preview-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 10px 14px 0; font-size: 13px; font-weight: 700; color: var(--text);
}
.preview-sender { font-weight: 400; color: #64748b; }
.preview-leave { padding: 12px 14px; font-size: 13px; color: var(--text); margin: 0; }
.preview-empty { padding: 12px 14px; font-size: 13px; color: #94a3b8; margin: 0; }
.preview-site-wrap { padding: 10px 14px; border-top: 1px solid #e2e8f0; }
.preview-site-wrap:first-of-type { border-top: none; }
.preview-site-title { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.preview-contractor { font-weight: 400; color: #64748b; font-size: 12px; }
.preview-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
.preview-table th {
  text-align: left; font-weight: 700; color: #64748b; font-size: 11px;
  padding: 4px 8px; border-bottom: 1px solid #e2e8f0;
}
.preview-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; color: var(--text); }
.preview-table td.preview-time { white-space: nowrap; color: #64748b; font-size: 11px; }
.preview-list { list-style: none; margin: 0 0 6px; padding: 0; font-size: 12px; color: var(--text); }
.preview-list li { padding: 2px 0; }
.preview-note { font-size: 12px; color: #64748b; margin: 0; }
.preview-note-main { padding: 8px 14px 12px; border-top: 1px solid #e2e8f0; }

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
