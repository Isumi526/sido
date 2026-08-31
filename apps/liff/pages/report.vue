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
      <div v-else-if="report.submitted.value || editSubmitted || lateSubmitted" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">{{ editSubmitted ? $t('report.updatedTitle') : lateSubmitted ? $t('report.lateSubmittedTitle') : $t('report.submittedTitle') }}</h2>
        <!-- ★「LINEグループに通知しました」は実際に飛んだ時だけ出す。
             通知はクロステナント漏洩の対策で全テナントOFFにしてあり、無条件に出していたので
             画面が嘘をついていた（2026-08-18 大塚さん「LINEグループに通知してんの？」）。 -->
        <p class="state-text">{{ editSubmitted ? $t('report.updatedText') : lateSubmitted ? $t('report.lateSubmittedText') : (report.lineNotified.value ? $t('report.submittedText') : $t('report.submittedTextPlain')) }}</p>
        <button v-if="!editSubmitted && !lateSubmitted && nextUnsubmittedDate" class="btn-primary" @click="goToNextReport">
          {{ $t('report.enterNextReport', { date: nextDateLabel }) }}
        </button>
        <button class="btn-history" @click="navigateTo('/history')">{{ (editSubmitted || lateSubmitted) ? $t('report.backToHistory') : $t('report.viewHistory') }}</button>
      </div>

      <!-- フォーム -->
      <form v-else @submit.prevent="handleSubmit" class="form">

        <!-- ★退勤打刻から自動で送られてきた時。なぜここに居るのかを言う。
             黙って画面が変わると「押し間違えた」と思って戻る人が出る（2026-08-31）。 -->
        <div v-if="fromCheckout" class="pending-banner" data-testid="from-checkout-banner">
          <span class="material-symbols-rounded banner-icon">logout</span>{{ $t('report.fromCheckoutBanner') }}
        </div>

        <!-- 簡易入力モード（?mode=simple）: 経費欄を畳んで現場・稼働・主要項目だけ表示 -->
        <div v-if="simpleMode" class="pending-banner" data-testid="simple-mode-banner">
          <span class="material-symbols-rounded banner-icon">bolt</span>{{ $t('report.simpleModeBanner') }}
        </div>

        <!-- 編集モードバナー -->
        <div v-if="isEditMode" class="edit-banner">
          {{ $t('report.editModeBanner') }}
        </div>
        <!-- 既に承認待ちの編集がある日報。今見えているのは「編集前（承認済み）」の内容 -->
        <div v-if="isEditMode && hasPendingEdit" class="pending-banner" data-testid="edit-pending-banner">
          {{ $t('report.editPendingBanner') }}
        </div>

        <!-- 下書き復元バナー（新規入力中・自動保存を復元した時のみ）-->
        <div v-if="draftRestored && !isEditMode" class="draft-banner">
          <span class="draft-banner-text"><span class="material-symbols-rounded banner-icon">edit_note</span>{{ $t('report.draftRestored') }}</span>
          <button type="button" class="draft-discard" @click="discardDraft">{{ $t('report.draftDiscard') }}</button>
        </div>

        <!-- 日付 -->
        <FormSection num="01" :title="$t('report.dateSection')">
          <div class="date-fixed">{{ dateWithWeekday }}</div>
          <!-- ★過去日の案内は日付のすぐ下に1つだけ出す。期限切れ(承認制)の時は
               「過去の未送信日報です」と重ねず、承認制の説明に置き換える（同じ話を2回言わない）。 -->
          <div v-if="isLateDate" class="pending-banner" data-testid="late-notice">
            <span v-html="$t('report.lateNoticeBanner')" />
          </div>
          <div v-else-if="!isEditMode && report.form.value.date < todayJst" class="past-date-notice">
            <span v-html="$t('report.pastDateNotice')" />
          </div>
        </FormSection>

        <!-- 稼働有無 -->
        <FormSection num="02" :title="$t('report.workStatusSection')" required>
          <select v-model="isWorkingStr" class="select" required>
            <option value="working">{{ $t('report.working') }}</option>
            <option value="paid_leave">{{ $t('report.paidLeave') }}</option>
            <option value="off">{{ $t('report.off') }}</option>
          </select>
          <!-- 有給の単位（2026-08-30）。
               ★半日は法令上の定めが無く労使協定は不要＝常に出す。
                時間単位は労基法39条4項で労使協定が必須・年5日ぶんが上限なので、
                協定を締結しているアカウント（設定でON）だけに出す。 -->
          <div v-if="isWorkingStr === 'paid_leave'" class="leave-unit" data-testid="leave-unit">
            <label class="hours-label">{{ $t('report.leaveUnitLabel') }}</label>
            <select v-model="leaveUnit" class="select mt4" data-testid="leave-unit-select">
              <option value="day">{{ $t('report.leaveUnitDay') }}</option>
              <option value="half">{{ $t('report.leaveUnitHalf') }}</option>
              <option v-if="hourlyLeaveEnabled" value="hour">{{ $t('report.leaveUnitHour') }}</option>
            </select>
            <input
              v-if="leaveUnit === 'hour'"
              v-model.number="leaveHours"
              type="number" inputmode="decimal" step="0.5" min="0.5"
              class="input mt6" data-testid="leave-hours"
              :placeholder="$t('report.leaveHoursPlaceholder')" @keydown.enter.prevent
            />
            <p v-if="leaveUnitError" class="section-hint" style="color:#b91c1c" data-testid="leave-unit-error">{{ leaveUnitError }}</p>
          </div>

          <!-- 有給残が不足している時: 二重承認が要る旨を先に伝える（送信は可能・承認待ちになる） -->
          <div v-if="needsPaidLeaveApproval" class="pending-banner" data-testid="paid-leave-over-notice">
            {{ $t('report.paidLeaveOverNotice') }}
          </div>
        </FormSection>

        <!-- 現場ブロック（稼働ありの場合のみ表示） -->
        <template v-if="isWorkingStr === 'working'">

        <!-- 音声入力（8/19会議）: 話す→AIが項目に展開→必ず確認してから反映。
             非対応環境（voice.isSupported=false）ではボタンを出さず従来入力のまま。 -->
        <!-- ★機能フラグ(settings.voice_input_enabled)がONのアカウントだけに出す。
             未設定＝OFF なので、既定では誰にも出ない（2026-08-30 優先順位を下げて一旦停止）。
             解禁は該当アカウントの settings に1行入れるだけ＝再デプロイ不要。 -->
        <div v-if="voiceInputEnabled && voice.isSupported.value" class="voice-row">
          <button type="button" class="voice-btn" :class="{ listening: voice.listening.value }"
                  data-testid="voice-input-btn" :disabled="voiceBusy" @click="onVoiceClick">
            <span class="material-symbols-rounded">{{ voice.listening.value ? 'graphic_eq' : 'mic' }}</span>
            {{ voice.listening.value ? $t('report.voiceListening') : (voiceBusy ? $t('report.voiceParsing') : $t('report.voiceStart')) }}
          </button>
          <span v-if="voiceError" class="voice-error" data-testid="voice-error">{{ voiceError }}</span>
        </div>

        <!-- 確認モーダル: 反映前に「この内容で反映していいですか」（会議合意）。修正してから確定 -->
        <div v-if="voiceConfirm" class="voice-modal-back" data-testid="voice-confirm">
          <div class="voice-modal">
            <h3>{{ $t('report.voiceConfirmTitle') }}</h3>
            <p class="voice-heard"><span class="material-symbols-rounded">hearing</span>{{ voiceDraft.raw }}</p>
            <!-- ★話した現場の数だけブロックを出す（1日に複数現場を回る運用がある）。
                 まとめて1件にすると時間が現場を跨いで合算され、人件費の集計が狂う。 -->
            <div v-for="(d, di) in voiceDraft.sites" :key="di" class="voice-site-block" :data-testid="`voice-site-block-${di}`">
              <div v-if="voiceDraft.sites.length > 1" class="voice-site-no">{{ $t('report.siteNumbered', { n: di + 1 }) }}</div>
              <label class="voice-field">
                <span>{{ $t('report.site') }}</span>
                <select v-model="d.siteName" class="select" :data-testid="`voice-site-${di}`">
                  <option value="">{{ $t('report.voiceNoChange') }}</option>
                  <option v-for="n in voiceSiteChoices" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>
              <label class="voice-field">
                <span>{{ $t('report.workCategory') }}</span>
                <select v-model="d.workCategoryId" class="select" :data-testid="`voice-workcat-${di}`">
                  <option value="">{{ $t('report.voiceNoChange') }}</option>
                  <option v-for="c in workCategoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </label>
              <div class="voice-field-row">
                <label class="voice-field">
                  <span>{{ $t('report.startTime') }}</span>
                  <select v-model="d.startTime" class="select" :data-testid="`voice-start-${di}`">
                    <option value="">--</option>
                    <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
                  </select>
                </label>
                <label class="voice-field">
                  <span>{{ $t('report.endTime') }}</span>
                  <select v-model="d.endTime" class="select" :data-testid="`voice-end-${di}`">
                    <option value="">--</option>
                    <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
                  </select>
                </label>
              </div>
              <label class="voice-field">
                <span>{{ $t('report.siteNote') }}</span>
                <textarea v-model="d.note" class="input" rows="2" :data-testid="`voice-note-${di}`" />
              </label>
            </div>
            <label class="voice-field">
              <span>{{ $t('report.noteSection') }}</span>
              <textarea v-model="voiceDraft.note" class="input" rows="2" data-testid="voice-note" />
            </label>
            <div class="voice-modal-btns">
              <button type="button" class="btn-cancel" data-testid="voice-cancel" @click="voiceConfirm = false">{{ $t('report.voiceCancel') }}</button>
              <button type="button" class="btn-apply" data-testid="voice-apply" @click="applyVoiceDraft">{{ $t('report.voiceApply') }}</button>
            </div>
          </div>
        </div>

        <!-- 出張区分（稼働ありの日のみ・出張手当 +¥3,000/日を集計に計上） -->
        <label class="trip-toggle" data-testid="business-trip-toggle">
          <input type="checkbox" v-model="report.form.value.isBusinessTrip" />
          <span>{{ $t('report.businessTrip') }}</span>
        </label>

        <!-- 現場ブロック -->
        <FormSection
          v-for="(site, si) in report.form.value.sites"
          :key="si"
          :num="String(si + 3).padStart(2, '0')"
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

          <!-- ★元請け業者は入力させない（2026-08-17）。
               現場名のプルダウンが元請けごとに区切られているので、現場を選べば元請けは決まる。
               二度同じことを聞いていた＝入力が1つ無駄で、しかも食い違う余地があった。
               現場マスタから逆算して site.contractorName に入れる（onSiteChange）。
               ★保存し続ける理由: 「あの人は今どこの元請けの仕事をしているか」を
                把握したいという要望があるため。ただし日報の入力画面は本人しか見ないので
                ここには出さない。見せるのは管理画面側。 -->

          <!-- 現場名 -->
          <Field :label="$t('report.siteName')" required>
            <select v-model="site.siteName" class="select" required :data-testid="`site-select-${si}`" @change="onSiteChange(si)">
              <option value="">{{ $t('common.select') }}</option>
              <option value="__unset__">{{ $t('report.siteUnset') }}</option>
              <!-- ★終わって無効化された現場の日報を編集で開いた時の受け皿。
                   マスタは有効な現場しか返さないので、選択中の名前が候補に無いと
                   select が空表示になり、必須チェックで保存できない＝過去の日報を
                   二度と直せなくなる（本番で192件が該当・2026-08-14 実測）。
                   経費の領収書を後から付ける運用がまさにこれで詰まる。
                   ★新規入力では出ない（そこでは siteName が空なので条件が偽）。
                   「終わった現場をプルダウンから消す」という無効化の目的は損なわない。 -->
              <option v-if="isRetiredOption(site.siteName, master.siteNames.value)"
                      :value="site.siteName" :data-testid="`retired-site-${si}`">
                {{ $t('report.retiredOption', { name: site.siteName }) }}
              </option>
              <!-- ★常に元請けごとに区切る。元請けを別に選ばせるのをやめたので分岐も要らない -->
              <template v-for="grp in master.siteGroupsByContractor.value" :key="grp.contractorName ?? '__unlinked__'">
                <optgroup :label="grp.contractorName ?? $t('report.siteGroupUnlinked')">
                  <option v-for="name in grp.sites" :key="name" :value="name">{{ name }}</option>
                </optgroup>
              </template>
              <!-- 現場の新規作成は権限者(admin/office/site_manager)のみ。職人には選択肢自体を出さない -->
              <option v-if="canCreateSite" value="__other__">{{ $t('report.addNewSite') }}</option>
            </select>
            <div v-if="site.siteName === '__unset__'" class="unset-hint">
              <HintIcon :text="$t('report.siteUnsetNote')" :label="$t('report.siteUnset')" />
            </div>
            <!-- ★現場名を文字で残せるようにする（2026-08-27）。
                 これが無いと「現場未設定」を選んだ時点で “どの現場だったか” がシステム上
                 どこにも残らず、後から管理者が記憶を頼りに紐付けるしかなかった。
                 職人は現場を新規作成できない（__other__ が出ない）ので、未登録現場で働いた日は
                 必ずここに落ちる。任意入力・マスタには登録しない（紐付けの手がかり専用）。 -->
            <input
              v-if="site.siteName === '__unset__'"
              v-model="site.customSiteName"
              type="text"
              class="input mt6"
              :data-testid="`unset-site-memo-${si}`"
              :placeholder="$t('report.siteUnsetNamePlaceholder')"
              @keydown.enter.prevent
            />
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
              <span class="material-symbols-rounded banner-icon">warning</span>{{ $t('report.similarSiteWarn') }}：<template v-for="(name, i) in siteSimilar(site.customSiteName)" :key="name"><span
                class="similar-site-pick" role="button" tabindex="0" data-testid="similar-site-pick"
                @click="pickSimilarSite(si, name)"
                @keydown.enter.prevent="pickSimilarSite(si, name)"
              >{{ name }}</span>{{ i < siteSimilar(site.customSiteName).length - 1 ? '、' : '' }}</template>
            </div>
            <!-- 新規現場は逆算できないので、その時だけ元請けを選ばせる -->
            <select
              v-if="site.siteName === '__other__'"
              v-model="site.contractorName"
              class="select mt6"
              :data-testid="`new-site-contractor-${si}`"
            >
              <option value="">{{ $t('report.contractor') }}{{ $t('report.selectOptional') }}</option>
              <option v-for="name in master.contractorNames.value" :key="name" :value="name">{{ name }}</option>
            </select>
          </Field>

          <!-- 作業区分（現場作業/見積/事務…）。既定で「現場作業」が入っている。
               ★1つの現場に複数の作業があり、定時が違う（見積・事務は現場の定時の外）。
                区分を選ぶと siteFixedTimes が「現場×区分」の定時を優先して引き、
                作業時刻の既定・終了の上限・残業判定まで連動する。
                区分が1つ以下の会社では出さない（選ばせる意味がない）。
               ★現場を選ぶまで出さない。先に空の区分だけ見えていると
                「何を選べばいいのか分からない空欄」になる（2026-08-17 本番で指摘）。 -->
          <Field v-if="workCategoryOptions.length > 1 && isSiteChosen(site)" :label="$t('report.workCategory')">
            <select v-model="site.workCategoryId" class="select" :data-testid="`work-category-${si}`" @change="onSiteChange(si)">
              <option v-for="c in workCategoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
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
                      <select v-model="site.workers[0].startTime" class="select" :data-testid="`start-time-${si}`">
                        <option v-for="t in startTimeOptionsForSite(si)" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                    <span class="time-sep">〜</span>
                    <div class="time-field">
                      <label class="hours-label">{{ $t('report.endTime') }}</label>
                      <select v-model="site.workers[0].endTime" class="select" :data-testid="`end-time-${si}`">
                        <option v-for="t in endTimeOptionsForSite(si)" :key="t" :value="t">{{ t }}</option>
                      </select>
                    </div>
                  </div>
                  <!-- ★その日の実打刻。表示だけで、作業時刻には入れない
                       （人件費は管理者が決めた時間がマスタ・2026-08-10 大塚さん）。
                       打刻が無い日は行ごと出さない（0:00 のように見せない）。 -->
                  <div v-if="punchOf(si)" class="punch-row" :data-testid="`punch-row-${si}`">
                    <span class="material-symbols-rounded punch-icon">how_to_reg</span>
                    <span class="punch-label">{{ $t('report.punchLabel') }}</span>
                    <span class="punch-time">{{ punchOf(si)?.checkin ?? '—' }} 〜 {{ punchOf(si)?.checkout ?? '—' }}</span>
                    <span v-if="punchGap(si)" class="punch-gap" :class="{ big: punchGapBig(si) }" :data-testid="`punch-gap-${si}`">
                      {{ punchGap(si) }}
                    </span>
                  </div>
                  <div v-if="siteFixedEnd(site.siteName, si)" class="fixed-time-note">
                    <template v-if="overtimeApprovedForDate">
                      <span class="material-symbols-rounded banner-icon">check_circle</span>{{ $t('report.overtimeApprovedNote') }}
                      <span v-if="approvedAdjust?.startTime" class="approved-extra" data-testid="approved-early-start">
                        {{ $t('report.earlyStartApproved', { time: approvedAdjust.startTime }) }}
                      </span>
                    </template>
                    <template v-else>
                      <span class="material-symbols-rounded banner-icon">timer</span>{{ $t('report.fixedTimeNote', { end: siteFixedEnd(site.siteName, si) }) }}
                      <NuxtLink to="/overtime" class="overtime-link">{{ $t('report.overtimeApplyLink') }}</NuxtLink>
                    </template>
                  </div>
                  <div class="worker-break-row">
                    <div class="time-field">
                      <label class="hours-label">{{ $t('report.break') }}</label>
                      <span class="break-auto">
                        <!-- ★休憩なし/短縮が承認された日は、その分数を使う（管理者が承認した内容がその日の正） -->
                        <template v-if="approvedAdjust?.breakMinutes !== null && approvedAdjust?.breakMinutes !== undefined">
                          <span data-testid="approved-break">{{ approvedAdjust.breakMinutes === 0 ? $t('report.breakNone') : `${approvedAdjust.breakMinutes}分` }}（{{ $t('report.breakApproved') }}）</span>
                        </template>
                        <template v-else-if="effectiveBreakMinutes(site.workers[0]) === 0">{{ $t('report.breakNone') }}</template>
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

          <!-- 経費有無（簡易モードでは経費入力を丈ごと畳む） -->
          <Field v-if="!simpleMode" :label="$t('report.expense')">
            <select :value="siteUsage[si].expense" class="select select--usage" @change="(e) => setUsage(si, 'expense', (e.target as HTMLSelectElement).value)">
              <option value="なし">{{ $t('report.optNone') }}</option>
              <option value="あり">{{ $t('report.optYes') }}</option>
            </select>
          </Field>

          <!-- ── 交通経費 ── -->
          <div v-if="!simpleMode && siteUsage[si].expense === 'あり'" class="sub-section">
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
                      <input v-if="needsReceiptReason(pk, '駐車代')" v-model="pk.noReceiptReason" type="text"
                             class="input mt6" :class="{ 'input-required': !pk.noReceiptReason?.trim() }"
                             :data-testid="`no-receipt-reason-parking-${si}-${pi}`"
                             :placeholder="$t('report.noReceiptReasonPlaceholder')" @keydown.enter.prevent />
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
                      <!-- ETCカードを選ぶとこの欄は消える（利用明細で後日精算＝その場で領収書が出ない） -->
                      <input v-if="needsReceiptReason(hw, '高速代')" v-model="hw.noReceiptReason" type="text"
                             class="input mt6" :class="{ 'input-required': !hw.noReceiptReason?.trim() }"
                             :data-testid="`no-receipt-reason-highway-${si}-${hi}`"
                             :placeholder="$t('report.noReceiptReasonPlaceholder')" @keydown.enter.prevent />
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
                        <!-- 物品マスタ（ETCカード）があればそれを出す。無ければ従来の固定カードにフォールバック（壊さない） -->
                        <template v-if="master.etcCardNames.value.length">
                          <option v-for="nm in master.etcCardNames.value" :key="nm" :value="nm">{{ nm }}</option>
                          <!-- 既に選択済みの値が候補に無くても消えないよう残す（マスタ変更/旧データ対策） -->
                          <option v-if="hw.etcCard && !master.etcCardNames.value.includes(hw.etcCard)" :value="hw.etcCard">{{ hw.etcCard }}</option>
                        </template>
                        <template v-else>
                          <option v-for="n in 7" :key="n" :value="`カード${['①','②','③','④','⑤','⑥','⑦'][n-1]}`">
                            {{ $t('report.cardLabel', { mark: ['①','②','③','④','⑤','⑥','⑦'][n-1] }) }}
                          </option>
                        </template>
                      </select>
                    </div>
                  </div>
                  <button type="button" class="btn-ghost-sm" @click="report.addHighway(si)">{{ $t('report.addHighway') }}</button>
                </div>
              </template>
            </Field>

            <!-- ガソリン代（本日ぶん）。2026-08-30 に独立ブロック「本日のガソリン代」から
                 経費の車両欄のすぐ下へ移設した（入力位置だけの変更）。
                 ★保存先は日報直下(gasoline_items)のままで、現場ごとではない＝1日1回だけ出す。
                  距離按分の台帳（内部原価）には入らず、経費項目としてのみ計上する。 -->
            <div v-if="si === 0" class="veh-subexpense" data-testid="gas-section">
              <label class="hours-label">{{ $t('report.gasolineSection') }}</label>
              <!-- 給油有無（大半の日は給油なし。あり の時だけ金額・領収書を表示） -->
              <label class="hours-label">{{ $t('report.gasolineFueledLabel') }}</label>
              <select :value="gasFueled ? 'yes' : 'no'" class="select mt4" data-testid="gas-fueled" @change="setGasFueled(($event.target as HTMLSelectElement).value === 'yes')">
                <option value="no">{{ $t('report.gasolineFueledNo') }}</option>
                <option value="yes">{{ $t('report.gasolineFueledYes') }}</option>
              </select>

              <template v-if="gasFueled">
                <!-- 給油1回ぶん＝1明細。複数給油はカードを追加 -->
                <div v-for="(g, gi) in report.form.value.gasolineItems" :key="g._id ?? gi" class="lineitem-card mt8" :data-testid="`gas-item-${gi}`">
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
                  <!-- ★判定は fileUrls だけを見る（選択時に即アップロードされる）。
                       ローカルの File を「添付あり」に数えると、アップロードに失敗した時に
                       入力欄が出ないまま送信だけ弾かれて直せなくなる。 -->
                  <input v-if="needsReceiptReason(g, 'ガソリン代（本日）')"
                         v-model="g.noReceiptReason" type="text"
                         class="input mt6" :class="{ 'input-required': !g.noReceiptReason?.trim() }"
                         :data-testid="`no-receipt-reason-gas-${gi}`"
                         :placeholder="$t('report.noReceiptReasonPlaceholder')" @keydown.enter.prevent />
                  <!-- ② 手入力（支払い先・金額・登録番号） -->
                  <div class="lineitems-row mt6">
                    <input v-model="g.payee" type="text" class="input" :data-testid="`gas-payee-${gi}`" :placeholder="$t('report.gasPayeePlaceholder')" @keydown.enter.prevent />
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
            </div>

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
                    <input v-if="needsReceiptReason(tr, '電車代')" v-model="tr.noReceiptReason" type="text"
                           class="input mt6" :class="{ 'input-required': !tr.noReceiptReason?.trim() }"
                           :data-testid="`no-receipt-reason-train-${si}-${ti}`"
                           :placeholder="$t('report.noReceiptReasonPlaceholder')" @keydown.enter.prevent />
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
          <div v-if="!simpleMode && siteUsage[si].expense === 'あり'" class="sub-section">
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
                    <input v-if="needsReceiptReason(ho, '宿泊費')" v-model="ho.noReceiptReason" type="text"
                           class="input mt6" :class="{ 'input-required': !ho.noReceiptReason?.trim() }"
                           :data-testid="`no-receipt-reason-hotel-${si}-${hi}`"
                           :placeholder="$t('report.noReceiptReasonPlaceholder')" @keydown.enter.prevent />
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

            <!-- その他（資材等・雑経費を統合。仕分けは科目に任せる） -->
            <Field :label="$t('report.other')">
              <select :value="siteUsage[si].other" class="select select--usage" @change="(e) => setUsage(si, 'other', (e.target as HTMLSelectElement).value)">
                <option value="なし">{{ $t('report.optNone') }}</option>
                <option value="あり">{{ $t('report.optYes') }}</option>
              </select>
              <template v-if="siteUsage[si].other === 'あり'">
                <div v-for="(ot, oi) in site.expenses.others" :key="oi" class="lineitem-card mt6" :data-testid="`other-item-${si}-${oi}`">
                  <div>
                    <label class="hours-label">{{ $t('report.receiptLabel') }}</label>
                    <AttachedFilesBadge :files="ot.files" :urls="ot.fileUrls" @remove-file="(p) => removeItemFile(ot, p)" />
                    <input type="file" accept="image/*,.pdf" multiple class="input mt4" @change="(e) => handleOtherFile(si, oi, e)" />
                    <div v-if="ot.files?.length" class="photo-preview">
                      <button type="button" class="btn-ai" :disabled="receipt.loading.value === `${si}-other-${oi}`" @click="analyzeReceipt(si, 'other', oi)">
                        {{ receipt.loading.value === `${si}-other-${oi}` ? $t('report.analyzing') : $t('report.aiAnalyze') }}
                      </button>
                    </div>
                    <input v-if="needsReceiptReason(ot, 'その他')" v-model="ot.noReceiptReason" type="text"
                           class="input mt6" :class="{ 'input-required': !ot.noReceiptReason?.trim() }"
                           :data-testid="`no-receipt-reason-other-${si}-${oi}`"
                           :placeholder="$t('report.noReceiptReasonPlaceholder')" @keydown.enter.prevent />
                  </div>
                  <div class="lineitems-row mt6">
                    <input v-model="ot.label" type="text" class="input" :placeholder="$t('report.contentPlaceholder')" @keydown.enter.prevent />
                    <ExpenseField v-model="ot.yen" v-model:tategae="ot.tategae" with-tategae :label="$t('report.amount')" />
                    <button v-if="site.expenses.others.length > 1" type="button" class="btn-icon-sm" @click="report.removeOther(si, oi)">✕</button>
                  </div>
                  <input v-model="ot.payee" type="text" class="input mt6" placeholder="支払い先（店名/業者）" @keydown.enter.prevent />
                  <input v-model="ot.registrationNumber" type="text" class="input mt6" :placeholder="$t('report.registrationNumberPlaceholder')" @keydown.enter.prevent />
                  <select v-model="ot.account" class="select mt6">
                    <option value="">{{ $t('report.accountAuto', { name: '消耗品費' }) }}</option>
                    <option v-for="a in EXPENSE_ACCOUNT_OPTIONS" :key="a" :value="a">{{ a }}</option>
                  </select>
                  <!-- 接待交際費/会議費は税務上「誰と行ったか」の記録が必須 -->
                  <input v-if="needsCompanions(ot)" v-model="ot.companions" type="text" class="input mt6" :class="{ 'input-required': !ot.companions?.trim() }"
                         :placeholder="$t('report.companionsPlaceholder')" @keydown.enter.prevent />
                </div>
                <button type="button" class="btn-ghost-sm" @click="report.addOther(si)">{{ $t('report.addOther') }}</button>
              </template>
            </Field>

          </div>

          <!-- 現場備考 -->
          <Field :label="$t('report.siteNote')">
            <textarea
              v-model="site.siteNote"
              class="textarea"
              :data-testid="`site-note-${si}`"
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
            data-testid="report-note"
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
                <thead><tr><th>{{ $t('report.workerName') }}</th><th>{{ $t('report.workTime') }}</th><th>{{ $t('report.workHours') }}</th><th>{{ $t('report.previewBreak') }}</th></tr></thead>
                <tbody>
                  <tr v-for="(w, wi) in site.workers" :key="wi"><td>{{ w.name }}</td><td class="preview-time">{{ w.timeRange }}</td><td>{{ w.hours }}</td><td class="preview-break">{{ w.breakMinutes > 0 ? $t('report.previewBreakMin', { min: w.breakMinutes }) : '—' }}</td></tr>
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
            <div v-if="previewData.sites.length" class="preview-total">
              {{ $t('report.previewTotalHours', { hours: previewData.totalHours }) }}
            </div>
          </template>
          <p v-if="previewData.note" class="preview-note preview-note-main">{{ previewData.note }}</p>
        </div>

        <!-- 遅れた理由（期限切れの提出時のみ必須）。編集理由と同じ扱いに揃える -->
        <div v-if="isLateDate" class="edit-reason">
          <label class="edit-reason-label" for="late-reason">{{ $t('report.lateReasonLabel') }}<span class="required">{{ $t('common.required') }}</span></label>
          <textarea id="late-reason" v-model="lateReason" class="edit-reason-input" rows="2"
                    data-testid="late-reason" :placeholder="$t('report.lateReasonPlaceholder')" />
        </div>

        <!-- 編集理由（編集時のみ必須）。1編集=1行で daily_report_edit_logs に残す。
             ★経費申請書(PDF画面)のインライン修正はこの経路を通らないので対象外（回答=B）。 -->
        <div v-if="isEditMode" class="edit-reason">
          <label class="edit-reason-label" for="edit-reason">{{ $t('report.editReasonLabel') }}<span class="required">{{ $t('common.required') }}</span></label>
          <textarea
            id="edit-reason"
            v-model="editReason"
            class="edit-reason-input"
            rows="2"
            data-testid="edit-reason"
            :placeholder="$t('report.editReasonPlaceholder')"
          />
          <p class="edit-reason-hint">{{ $t('report.editReasonHint') }}</p>
        </div>

        <!-- 送信前の記入忘れ確認（新規送信時のみ・習慣化のため必須） -->
        <label v-if="!isEditMode" class="submit-confirm">
          <input type="checkbox" v-model="omissionConfirmed" data-testid="omission-confirm" />
          <span>{{ $t('report.omissionConfirm') }}</span>
        </label>

        <!-- 送信ボタン -->
        <button v-if="isDev && !isEditMode" type="button" class="btn-dev" @click="fillTestData">{{ $t('report.fillTestData') }}</button>
        <button v-if="isDev" type="button" class="btn-dev" :class="{ 'btn-dev--error': forceErrorOnSubmit }" @click="fillErrorTestData">
          {{ forceErrorOnSubmit ? $t('report.cancelErrorTest') : $t('report.fillErrorTestData') }}
        </button>
        <button type="submit" class="btn-submit" data-testid="report-submit" :disabled="(isEditMode ? (editSubmitting || !editReason.trim()) : (report.submitting.value || !omissionConfirmed || (isLateDate && !lateReason.trim())))">
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
import { todayStr } from '~/composables/schedule-core.gen'
import { punchDiffLabel, isPunchDiffBig, isPunchDiffWorthShowing } from '~/composables/attendance-punch.gen'
import { computeWorkerHours, getRateLines, calcBreakMinutes, effectiveBreakMinutes, effectiveBreakWindows, parseMin, TIME_OPTIONS } from '~/utils/workerHours'
import type { RateBreakdown } from '~/utils/workerHours'
import { computeDiff } from '~/utils/diffReport'
import { leaveDaysFor, hourlyLeaveCapError, storedLeaveDays, DEFAULT_LEAVE_DAY_HOURS, type LeaveUnit } from '~/composables/paid-leave.gen'
import { findSimilarSiteNames } from '~/utils/site-similarity.gen'
import { uploadExpenseFiles } from '~/utils/uploadExpenseFiles'
import { createGasolineItem } from '~/composables/useReport'
import { useI18n } from 'vue-i18n'
import type { User, SiteReport } from '~/types'

const { t } = useI18n()

// オンボーディングを手動で再表示するための参照（使い方ガイドボタン）
const onboardingRef = ref<{ open: () => void } | null>(null)

// 新規現場の手入力時、既存に似た現場があれば重複候補を返す（重複登録の気づき）
function siteSimilar(name?: string): string[] {
  return findSimilarSiteNames(name ?? '', master.siteNames.value)
}
// 似た現場候補をクリックしたら、手入力(__other__)をやめて既存の現場をその場で選択する
function pickSimilarSite(si: number, name: string) {
  const s = report.form.value.sites[si]
  if (!s) return
  s.siteName = name
  s.customSiteName = ''
  onSiteChange(si)
}

// 現場プルダウン: 元請けが選択されていれば、その元請けに紐づく現場を優先表示。
//  紐づけ忘れで現場が選べない不便を防ぐため、紐づいていない現場も「その他の現場」として
//  下部に残す（元請け未選択/その他の時は linked=[] で全件が others に入る＝後方互換）。
/**
 * いま選ばれている値がマスタの候補に無いか（＝無効化された現場・元請けを指している）。
 * ★true の時だけ専用の option を出して選択を保持する。出さないと select が空表示になり、
 *  現場は required なのでその日報を保存できなくなる（過去の日報が直せない）。
 * 特殊値（未選択 / 現場未設定 / 新規追加）は対象外。
 */

function isRetiredOption(current: string | undefined, options: string[]): boolean {
  const v = (current ?? '').trim()
  if (!v || v === '__unset__' || v === '__other__') return false
  return !options.includes(v)
}

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

// ────────────────────────────────────────────
//  実打刻の表示（2026-08-10 大塚さん「日報の中に実際打った打刻時間と、
//  管理者が決めた8時半〜18時の両方が出てくればそれでいい」）
//  ★表示専用。ここで読んだ値を form の作業時刻へ書き戻さないこと。
//   書き戻した瞬間に人件費の根拠が「管理者が決めた時間」から実打刻に入れ替わる。
// ────────────────────────────────────────────
const punches = usePunches()
const myWorkerIdForPunch = ref<string | null>(null)

/**
 * その日の打刻（無ければ null＝行を出さない）。
 * ★2026-08-27 出退勤モデル変更で現場ごとの打刻は無くなった。1日の外枠（最早の出勤・
 *  最遅の退勤）を各現場行に同じものとして出す（si は行の識別にのみ残す）。
 */
function punchOf(_si: number): { checkin?: string; checkout?: string } | null {
  return punches.punchFor(myWorkerIdForPunch.value, report.form.value.date)
}

/** 打刻と申告した作業時刻のズレ（15分未満は出さない＝全行に数分のチップが並ぶのを防ぐ） */
function punchGap(si: number): string {
  const p = punchOf(si)
  const w = report.form.value.sites?.[si]?.workers?.[0]
  if (!p || !w) return ''
  const parts: string[] = []
  if (isPunchDiffWorthShowing(p.checkin, w.startTime)) parts.push(`${t('report.punchGapStart')} ${punchDiffLabel(p.checkin, w.startTime)}`)
  if (isPunchDiffWorthShowing(p.checkout, w.endTime)) parts.push(`${t('report.punchGapEnd')} ${punchDiffLabel(p.checkout, w.endTime)}`)
  return parts.join(' / ')
}

function punchGapBig(si: number): boolean {
  const p = punchOf(si)
  const w = report.form.value.sites?.[si]?.workers?.[0]
  if (!p || !w) return false
  return isPunchDiffBig(p.checkin, w.startTime) || isPunchDiffBig(p.checkout, w.endTime)
}

/** 打刻を読み直す。日付が変わったら読み直す（編集で別の日を開いた時など） */
async function reloadPunches() {
  if (!myWorkerIdForPunch.value) {
    const { resolve } = useCurrentUser()
    // 代理入力中は代理先の打刻を見る（その人の日報を書いているため）
    myWorkerIdForPunch.value = proxy.proxyTarget.value?.id ?? (await resolve())?.worker_id ?? null
  }
  await punches.load(myWorkerIdForPunch.value, report.form.value.date)
}
watch(() => report.form.value.date, () => { void reloadPunches() })
// 「過去日の日報です」表示に使う今日（JSTローカル基準。UTC基準だと深夜0-9時JSTに
// 前日となり、当日の日報が過去日扱いで警告表示されてしまう）
const todayJst = computed(() => todayStr())
// 退勤打刻の完了画面から引き継ぐ日付・現場（?date=YYYY-MM-DD&site=<現場名>）。
//  日付の形式が違うものは無視する（不正な値で date を壊さない）。
const prefillDate = computed(() => {
  const d = route.query.date as string | undefined
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''
})
const prefillSite = computed(() => (route.query.site as string | undefined) ?? '')
// ── 簡易入力モード（?mode=simple）──
//  経費項目が細かく分かれていて煩わしい、という要望への対応。URL に ?mode=simple を
//  付けた時だけ、ガソリン代・交通経費・現場経費などの経費入力欄を非表示にし、
//  「現場・稼働・主要項目だけ」の簡易UIにする。通常URLは従来どおり全項目を出す。
//  ★表示の出し分けだけ。入力・保存経路（saveReportById 等）は一切変えない。
const simpleMode = computed(() => route.query.mode === 'simple')
// 退勤打刻から自動遷移してきたか（checkin ページが ?from=checkout を付ける）
const fromCheckout = computed(() => route.query.from === 'checkout')
// 現場の新規作成は権限者(admin/office/site_manager)のみ。職人は既存現場から選ぶ
const { resolveRole: resolveWorkerRole, canCreateSite } = useWorkerPermission()

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

// ── 過去3日の期限判定 ──
//  ★「解錠の許可申請」は廃止済み（2026-08-03）。過去日はそのまま出せて、
//   理由必須＋内容の承認待ちになる。二段承認（解錠の許可→内容の承認）をやめた。
//   それに伴い残っていた申請モーダル・状態・report_edit_grants の購読は
//   テンプレートから一度も参照されない死にコードだったため 2026-08-15 に削除。
//   期限切れかどうかの判定（isPastLockWindow）だけを使う。
const lock = useReportLock()

/**
 * 編集を「承認待ち」として申請する（保留方式）。
 * ★daily_reports はここでは書き換えない。編集後の内容・理由・差分を EF に渡して保留に入れ、
 *   管理者が承認して初めて日報に適用される＝集計・PDF・請求に出る。
 * ★書き込みは EF(report-edit-log・service_role) 経由。テーブルは anon revoke してある。
 *   クライアントから直接書けると account_id や承認状態を自称できてしまう。
 * @returns 申請できたら true。false なら編集は成立していない（呼び出し側でエラーにする）。
 */
/** report-edit-log EF を叩く（身元は EF 側で検証済みのものを使う） */
async function callEditEf(payload: Record<string, unknown>): Promise<any | null> {
  const efUrl = config.public.edgeFunctionUrl
  if (!efUrl) { console.error('[Edit] EF URL 未設定'); return null }
  const anonKey = config.public.supabaseAnonKey as string
  const { data: { session } } = await useSupabase().auth.getSession()
  const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
  // 開発モードは LINE ID token が発行されない。EF 側はローカルSupabase接続時しか受け付けない
  const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
  const res = await fetch(`${efUrl}/report-edit-log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) { console.error('[Edit] EF失敗:', json?.error ?? res.status); return null }
  return json
}

/**
 * 自分が承認待ちにしている日付を取得し、今開いている日付がそれなら次の日へ進める。
 * ★初期化フローの中では呼ばない。以前ここを await で挟んだら画面が「読み込み中…」から
 *   進まなくなった。描画が終わってから後追いで直す（取れなければ何もしないだけ）。
 */
async function skipPendingDatesAfterInit(): Promise<void> {
  try {
    if (isEditMode.value) return
    const j = await callEditEf({ action: 'pending-dates' })
    const dates: string[] = (j?.dates ?? []).map((d: any) => d.date as string)
    if (!dates.length || !dates.includes(report.form.value.date)) return
    // 承認待ちの日は「出し済み」として飛ばす（承認を待たずに次の日を出せるように）
    const uid = liff.profile.value?.userId
    const proxyT = proxy.proxyTarget.value
    let next: string | null = null
    if (proxyT) {
      const { data: pu } = await useSupabase().from('users').select('id').eq('worker_id', proxyT.id).maybeSingle()
      next = await expense.getNextUnsubmittedDateById(
        (pu as any)?.id ?? '00000000-0000-0000-0000-000000000000', dates)
    } else if (selfUser.value?.id) {
      // ★LINEのユーザーIDではなくDBのユーザーIDで引く。
      //  以前は liff.profile の userId が要る形だったため、**メール/パスワードで
      //  ログインしている人（オーナー・事務など）はこの分岐に入らず、承認待ちの
      //  スキップが丸ごと効かなかった**。承認されるまで同じ日が出続ける
      //  （2026-08-18 大塚さん「なんか、15日が一生でてくる」）。
      next = await expense.getNextUnsubmittedDateById(selfUser.value.id, dates)
    } else if (uid) {
      next = await expense.getNextUnsubmittedDate(uid, dates)
    }
    if (next && next !== 'NOT_CONFIGURED') report.form.value.date = next
    else if (next === null) allSubmitted.value = true
  } catch (e) {
    console.error('[Report] 承認待ちの日付スキップに失敗:', e)
  }
}

/** この日報に承認待ちの編集が既にあるか（作業員に「まだ反映されていない」ことを伝える） */
async function refreshPendingState(): Promise<void> {
  hasPendingEdit.value = false
  const rid = originalReport.value?.id
  if (!rid) return
  const j = await callEditEf({ action: 'pending-status', reportId: rid })
  hasPendingEdit.value = !!j?.pending
}

/**
 * 期限切れ（3日より前）の新規提出を「承認待ち」として申請する。
 * ★daily_reports には書かない。承認されて初めて日報・現場別集計・経費PDFに出る。
 * ★理由は「なぜ遅れたか」。編集と同じ欄を使い回さず、提出時に入力させる。
 */
async function submitLateNewForApproval(targetUserId: string): Promise<boolean> {
  try {
    const working = isWorkingStr.value === 'working'
    // 保存経路と同じ正規化を通す（site_id解決・その他/接待交際費の振り分け・ガソリン明細の整形）
    const payload = await expense.buildReportPayload({
      isWorking:      report.form.value.isWorking,
      leaveType:      report.form.value.leaveType ?? null,
      isBusinessTrip: working ? !!report.form.value.isBusinessTrip : false,
      sites:          report.form.value.sites,
      note:           report.form.value.note,
      gasolineItems:  working ? (report.form.value.gasolineItems ?? []) : [],
    })
    if (!editLogToken.value) editLogToken.value = crypto.randomUUID()
    const j = await callEditEf({
      kind: 'late_new',
      targetUserId,
      reportId: null,
      reportDate: report.form.value.date,
      reason: lateReason.value.trim(),
      diffs: [],
      clientToken: editLogToken.value,
      payload,
    })
    return !!j?.pendingId
  } catch (e) {
    console.error('[Report] 期限切れ提出の申請に失敗:', e)
    return false
  }
}

/**
 * 有給残が不足しているのに有給を選んだ新規提出を「承認待ち（二重承認）」として申請する。
 * ★late_new と同じ保留方式: daily_reports には書かず、承認されて初めて日報に反映＝有給が消化される。
 *   未送信スキャンは承認待ちの日付を「出し済み」として飛ばすので、翌日以降の入力に進める。
 */
async function submitPaidLeaveOverForApproval(targetUserId: string): Promise<boolean> {
  try {
    const payload = await expense.buildReportPayload({
      isWorking:      false,
      leaveType:      'paid_leave',
      isBusinessTrip: false,
      sites:          report.form.value.sites,
      note:           report.form.value.note,
      gasolineItems:  [],
    })
    if (!editLogToken.value) editLogToken.value = crypto.randomUUID()
    const j = await callEditEf({
      kind: 'paid_leave_over',
      targetUserId,
      reportId: null,
      reportDate: report.form.value.date,
      reason: t('report.paidLeaveOverReason'),
      diffs: [],
      clientToken: editLogToken.value,
      payload,
    })
    return !!j?.pendingId
  } catch (e) {
    console.error('[Report] 有給残不足の申請に失敗:', e)
    return false
  }
}

async function submitEditForApproval(diffs: string[]): Promise<boolean> {
  try {
    const working = isWorkingStr.value === 'working'
    // ★保存経路と同じ正規化を通す（現場のsite_id解決・その他/接待交際費の振り分け・
    //   ガソリン明細の整形）。素のフォーム値を保留に入れると、承認した瞬間に
    //   集計の列が入れ替わる（実際にE2Eで踏んだ）。
    const payload = await expense.buildReportPayload({
      isWorking:      report.form.value.isWorking,
      leaveType:      isWorkingStr.value === 'paid_leave' ? 'paid_leave' : null,
      leaveDays:      currentLeaveDays(),
      leaveHours:     leaveUnit.value === 'hour' ? (Number(leaveHours.value) || null) : null,
      isBusinessTrip: working ? !!report.form.value.isBusinessTrip : false,
      sites:          report.form.value.sites,
      note:           report.form.value.note,
      gasolineItems:  working ? (report.form.value.gasolineItems ?? []) : [],
    })
    const j = await callEditEf({
      reportId:   originalReport.value?.id ?? null,
      reportDate: report.form.value.date,
      reason:     editReason.value.trim(),
      diffs,
      clientToken: editLogToken.value,   // 再送しても監査ログを二重にしない
      payload,   // 承認されたらそのまま daily_reports に入る中身
    })
    return !!j?.pendingId
  } catch (e) {
    console.error('[Edit] 申請に失敗:', e)
    return false
  }
}

// 管理画面で承認したら日報画面へ自動反映（リロード不要・ブラウザ開きっぱなしでも反映）。
//  ① Realtime: 承認の瞬間に push 受信（即時）。② ポーリング: webview等でwebsocketが切れても確実に追従。
//  ③ タブ復帰: フォーカス時にも再取得。
// 解錠の許可は廃止したので、見るゲートは残業申請の承認だけ
function refreshGates() { refreshOvertime() }
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_requests',  filter: `worker_id=eq.${wid}` }, () => refreshGates())
    .subscribe()
}

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
// ★承認された申請の中身（早朝入り／実際に取った休憩）。2026-08-10 大塚さん
//  「6時からやってますとかあった時は、あらかじめ残業申請の方でやる…早朝出勤というのもいる」
//  「10時休憩せずにぶっ通しでやりました…申請を出せば、じゃあいいよ、って修正させてあげたい」
//  承認されていない限り null＝従来どおり固定開始より前・既定より短い休憩は入れられない。
const approvedAdjust = ref<{ startTime: string | null; endTime: string | null; breakMinutes: number | null } | null>(null)
// ★世代番号で古い応答を捨てる。日付と worker_id の両方を watch していて、
//  初期化中は「worker_id 未解決」→「解決済み」で2回走る。EF経由にして1回が
//  数百ms かかるようになったため、先に投げた（worker_id が無い）方が後から
//  返って承認状態を null で上書きし、承認済みなのに早出が選べない、という
//  取り違えが起きた（2026-08-15・E2Eが1回おきに落ちて発覚）。
//  実機の遅い回線ほど起きやすい。
let overtimeSeq = 0
async function refreshOvertime() {
  const seq = ++overtimeSeq
  const d = report.form.value.date
  const wid = currentUser.value?.worker_id ?? null
  if (!wid || !d) {
    // 未解決の時は「まだ分からない」だけ。既に取れている承認状態を消さない。
    return
  }
  const [approved, adjust] = await Promise.all([
    overtime.isApproved(wid, d),
    overtime.approvedAdjustment(wid, d),
  ])
  if (seq !== overtimeSeq) return   // 追い越された＝この結果はもう古い
  overtimeApprovedForDate.value = approved
  approvedAdjust.value = adjust
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
// 編集理由（必須）。daily_reports は upsert で上書きされるので、理由は 1編集=1行の
// 履歴テーブル daily_report_edit_logs に残す（1列だと2回目の編集で前回の理由が消える）
const editReason      = ref('')
// 1回の更新につき1つ。再送しても監査ログが二重にならないようにする冪等キー
const editLogToken    = ref('')
// この日報に承認待ちの編集があるか（作業員に「まだ反映されていない」ことを伝える）
const hasPendingEdit  = ref(false)
// 期限切れ（3日より前）の新規提出。承認待ちとして申請したら true
const lateSubmitted   = ref(false)
const lateReason      = ref('')
// 送信対象日が提出期限（過去3日）を過ぎているか。過ぎていれば承認制になる
const isLateDate = computed(() => !isEditMode.value && lock.isPastLockWindow(report.form.value.date))

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

// ── 有給の単位（2026-08-30）──
//  ★半日は法令上の定めが無く労使協定が不要なので常に選べる。
//   時間単位は労基法39条4項で労使協定が必須・年5日ぶんが上限なので、
//   設定(hourly_leave_enabled=協定を締結している)がONのアカウントだけ選べる。
const leaveUnit  = ref<LeaveUnit>('day')
const leaveHours = ref<number | null>(null)
const hourlyLeaveEnabled = ref(false)
const leaveDayHours = ref(DEFAULT_LEAVE_DAY_HOURS)
const hourlyUsedDaysThisYear = ref(0)

const leaveUnitError = computed(() => {
  if (isWorkingStr.value !== 'paid_leave' || leaveUnit.value !== 'hour') return ''
  const h = Number(leaveHours.value) || 0
  if (h <= 0) return t('report.leaveHoursRequired')
  if (h > leaveDayHours.value) return t('report.leaveHoursTooLong', { h: leaveDayHours.value })
  const adding = leaveDaysFor('hour', h, leaveDayHours.value)
  return hourlyLeaveCapError(hourlyUsedDaysThisYear.value, adding) ?? ''
})

/** 保存する消化量（日）。集計はこの値を合計する */
function currentLeaveDays(): number | null {
  if (isWorkingStr.value !== 'paid_leave') return null
  return leaveDaysFor(leaveUnit.value, leaveHours.value, leaveDayHours.value)
}

// ── 有給残の判定（有給を選んだ時、残が足りなければ日報を二重承認制にする）──
//  自分の分のみ判定する（代理入力は本人の残が取れないため対象外＝従来どおり保存。将来対応）。
const paidLeaveRemaining = ref<number | null>(null)
async function refreshPaidLeaveRemaining() {
  if (proxy.isProxyMode.value) { paidLeaveRemaining.value = null; return }
  try { paidLeaveRemaining.value = (await usePaidLeave().status()).remaining }
  catch { paidLeaveRemaining.value = null }   // 取れない時は判定に使わない（承認制に倒さない）
}
// 有給を選んでいて、残が0以下（新規・自分・期限内）＝この有給が残不足 → 承認必要
const needsPaidLeaveApproval = computed(() =>
  !isEditMode.value && !isLateDate.value && !proxy.isProxyMode.value
  && isWorkingStr.value === 'paid_leave'
  && paidLeaveRemaining.value !== null && paidLeaveRemaining.value < 1)
// 有給を選んだ瞬間に残を引く（初回だけ・自分の分）
watch(isWorkingStr, (v) => { if (v === 'paid_leave' && paidLeaveRemaining.value === null) void refreshPaidLeaveRemaining() })

// 時間単位年休は労使協定が要る（労基法39条4項）。締結しているアカウントだけ選べるようにする。
// 未設定は「協定なし」＝出さない（fail-closed。勝手に法令違反の選択肢を出さない）。
async function loadHourlyLeaveSetting() {
  try {
    const aid = await useAccount().getAccountId()
    if (!aid) return
    const { data } = await useSupabase().from('settings')
      .select('key, value').eq('account_id', aid)
      .in('key', ['hourly_leave_enabled', 'leave_day_hours'])
    const kv = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]))
    hourlyLeaveEnabled.value = String(kv['hourly_leave_enabled'] ?? '') === 'true'
    const h = Number(kv['leave_day_hours'])
    if (h > 0) leaveDayHours.value = h
  } catch { /* 取れない時は協定なし扱い（安全側・fail-closed） */ }
}

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
  // その他雑経費は「その他」に統合済み（2026-07-31）。旧データ（entertainments / 旧スカラー）が
  // あっても「その他=あり」で復元する＝セクションが消えて編集できなくなるのを防ぐ。
  if ((exp.others ?? []).some((o: any) => o.yen || o.label) ||
      exp.entertainmentYen || (exp.entertainments ?? []).some((e: any) => e.yen || e.label)) usage.other = 'あり'
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
  void refreshPendingState()   // 既に承認待ちなら、今見えているのは編集前の内容だと伝える

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
            workerId:   currentUser.value?.worker_id ?? '',
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
      // 入力は「その他」1本に統合（2026-07-31）。既存の entertainments を others に畳んで
      // 1つのリストとして編集させる。科目は mergeOtherExpenses が明示的に埋めるので、
      // 保存時の振り分けで元の配列に戻る＝現場別集計の列は変わらない。
      e.others = mergeOtherExpenses(e.others, e.entertainments)
      e.entertainments = []
    })
    siteUsage.value = report.form.value.sites.map((site: any) => {
      const usage = reconstructExpenseUsage(site.expenses)
      // 本人の作業員レコードが無ければ「自分の稼働なし」として復元
      usage.selfWorking = (site.workers ?? []).some((w: any) => w.workerName) ? 'あり' : 'なし'
      return usage
    })
    // ★ガソリン欄は経費（交通経費）の中へ移した（2026-08-30・#dae1a9e7）。
    //  給油明細がある日報は最初の現場の経費セクションを開いておく。開かないと
    //  既存の明細が画面から消えて編集できなくなる（「その他」を あり で復元するのと同じ理由）。
    if (gasFueled.value && siteUsage.value[0]) siteUsage.value[0].expense = 'あり'
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
      workerId:   currentUser.value?.worker_id ?? '',
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
      workerId:   currentUser.value!.worker_id ?? '',
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
      workerId:   currentUser.value.worker_id ?? '',
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
  const fStart = siteFixedStart(s?.siteName, si)
  // ★早朝入りが承認されていれば、その時刻まで下限を下げる。
  //  承認が無ければ従来どおり固定開始が下限（勝手に早出をつけられないため）。
  const approvedStart = approvedAdjust.value?.startTime ?? null
  if (fStart) {
    const floor = approvedStart ? Math.min(parseMin(fStart), parseMin(approvedStart)) : parseMin(fStart)
    floorMin = Math.max(floorMin, floor)
  }
  if (floorMin < 0) return TIME_OPTIONS
  // 編集で開いた古い下限割れ値は snap させないため、現在値は必ず含める。
  return TIME_OPTIONS.filter(t => parseMin(t) >= floorMin || t === cur)
}

// 送信バリデート: 同一作業員の複数現場の作業時間帯が重複していないか（重複していたらエラー文言を返す・無ければ null）
// 接待交際費・会議費は税務上「誰と行ったか」の記録が要る（2026-07-27 議事録）。
//  判定は shared/expense-flatten.ts の requiresCompanions が正（admin 側の未記入検出と同じ基準）。
function needsCompanions(item: { account?: string }, category = 'その他'): boolean {
  return requiresCompanions({ category, account: item.account })
}

// 同行者名が未記入の経費明細があればエラーメッセージを返す（送信を弾く＝「書かんと通さない」）
function findMissingCompanions(): string | null {
  for (const site of (report.form.value.sites ?? [])) {
    const exp: any = site?.expenses ?? {}
    for (const [key, cat] of [['others', 'その他'], ['entertainments', 'その他雑経費']] as const) {
      for (const it of (exp[key] ?? [])) {
        if (!it?.yen) continue                                  // 金額未入力の空行は対象外
        if (!needsCompanions(it, cat)) continue
        if (!String(it.companions ?? '').trim()) {
          return t('report.companionsRequired', { account: expenseAccountCategory({ category: cat, account: it.account }) })
        }
      }
    }
  }
  return null
}

// ────────────────────────────────────────────
//  領収書の添付必須（2026-08-14 ユーザー確定）
//  「領収書かレシートは99%もらえるものだから写真添付必須にして、ごく稀に
//   もらえない場合は理由をコメントしてアップさせればいい」。
//  ＝ 添付を必須にするが、理由を書けば通す。黙って0枚で通さないのが目的。
//  それまでは添付のバリデーションが1件も無く、本番で9件・約59,000円が
//  証憑なしで承認待ちになっていた（2026-08-12 発見）。
// ────────────────────────────────────────────
/** 経費配列のキー → 画面の呼び名。エラー文言と入力欄の出し分けに使う */
const RECEIPT_GROUPS = [
  ['parkings',       '駐車代',       'report.parking'],
  ['highways',       '高速代',       'report.highway'],
  ['trains',         '電車代',       'report.train'],
  ['hotels',         '宿泊費',       'report.hotel'],
  ['others',         'その他',       'report.other'],
  // entertainments は入力UIが無い（2026-07-31 に「その他」へ統合し、編集ロード時に
  // others へ畳んでいる）。理由を書く欄が出せない以上、ここで弾くと直せない詰みになる。
] as const

function hasReceipt(item: any): boolean {
  return !!(item?.fileUrls?.length || item?.files?.length)
}

/** その明細に「領収書が無い理由」の記入を求めるか（＝金額があるのに領収書0枚） */
function needsReceiptReason(item: any, category: string): boolean {
  if (!(Number(item?.yen) > 0)) return false          // 金額未入力の空行は対象外
  if (hasReceipt(item)) return false
  return !receiptExempt({ category, etcCard: item?.etcCard })
}

/** 領収書も理由も無い明細があればエラーメッセージを返す（送信を弾く） */
function findMissingReceipts(): string | null {
  const complain = (labelKey: string) => t('report.receiptRequired', { name: t(labelKey) })
  for (const site of (report.form.value.sites ?? [])) {
    const exp: any = site?.expenses ?? {}
    for (const [key, category, labelKey] of RECEIPT_GROUPS) {
      for (const it of (exp[key] ?? [])) {
        if (!needsReceiptReason(it, category)) continue
        if (!String(it.noReceiptReason ?? '').trim()) return complain(labelKey)
      }
    }
  }
  for (const g of (report.form.value.gasolineItems ?? [])) {
    if (!needsReceiptReason(g, 'ガソリン代（本日）')) continue
    if (!String(g.noReceiptReason ?? '').trim()) return complain('report.gasolineSection')
  }
  return null
}

/**
 * 画面に出す現場名。'__unset__'/'__other__' は内部値なので、そのまま見せない。
 * ★admin 側（lib/siteKey.ts の siteStoredName）に同じ変換があるのに LIFF に無く、
 *  確認画面や履歴に「__unset__」が生で出ていた（2026-08-27 に発覚）。
 */
function siteDisplayName(siteName: string | null | undefined, customSiteName?: string | null): string {
  if (siteName === '__unset__') return t('report.siteUnset')
  if (siteName === '__other__') return customSiteName || '新規現場'
  return siteName || ''
}

function findWorkerTimeOverlap(): string | null {
  const segs: { name: string; start: number; end: number }[] = []
  for (const s of (report.form.value.sites ?? [])) {
    const w = s?.workers?.[0]
    if (!w?.startTime || !w?.endTime) continue          // 稼働なし/未入力の現場はスキップ
    let start = parseMin(w.startTime)
    let end   = parseMin(w.endTime)
    if (end <= start) end += 1440                        // 日跨ぎ補正
    const name = siteDisplayName(s.siteName, s.customSiteName) || '現場'
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

/**
 * その台帳（現場）で選べる作業区分。★scope で絞る（慰安旅行を現場の選択肢に出さない）。
 */
const workCategoryOptions = computed(() =>
  master.workCategories.value.filter(c => c.scope === null || c.scope === 'site'))

// ── 音声入力（8/19会議）: 話す→report-voice-parse EFで解釈→確認して反映 ──
const voice = useVoiceInput()
// 機能フラグ（未設定＝OFF）。解決前は OFF のままなので、一瞬だけ出る事故も起きない
onMounted(() => { void loadLiffFeatures(); void loadHourlyLeaveSetting() })
const voiceBusy = ref(false)
const voiceError = ref<string | null>(null)
const voiceConfirm = ref(false)
// ★1日に複数の現場を回る運用があるので配列で持つ（2026-08-30）。
//  1件に畳むと「午前A・午後B」が1現場の 8:00-17:30 になり、
//  作業時間（＝人件費の根拠）が現場を跨いで狂う。
type VoiceSiteDraft = {
  siteName: string
  workCategoryId: string
  startTime: string
  endTime: string
  note: string
}
const voiceDraft = reactive({
  sites: [] as VoiceSiteDraft[],
  note: '' as string,   // 現場に紐づかない全体の備考
  raw: '' as string,
})
// 現場の選択肢（現場名。__unset__ は除く）
const voiceSiteChoices = computed(() => master.siteNames.value.filter((n: string) => n !== '__unset__'))
// EFが返した "HH:MM" を実在する TIME_OPTIONS の一番近い値に寄せる（無ければ空）
function snapTime(t: string | null): string {
  if (!t) return ''
  if (TIME_OPTIONS.includes(t)) return t
  const target = parseMin(t)
  if (target < 0) return ''
  let best = '', diff = Infinity
  for (const o of TIME_OPTIONS) {
    const d = Math.abs(parseMin(o) - target)
    if (d < diff) { diff = d; best = o }
  }
  return best
}
function onVoiceClick() {
  voiceError.value = null
  if (voice.listening.value) { voice.stop(); return }
  voice.start(async (text: string) => {
    voiceBusy.value = true
    try {
      const efUrl = config.public.edgeFunctionUrl
      const anonKey = config.public.supabaseAnonKey as string
      const res = await $fetch<any>(`${efUrl}/report-voice-parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: {
          transcript: text,
          sites: voiceSiteChoices.value,
          workCategories: workCategoryOptions.value.map((c: any) => ({ id: c.id, name: c.name })),
        },
      })
      if (res?.error) throw new Error(res.error)
      const parsed = (res.sites ?? []) as any[]
      voiceDraft.sites = parsed.map((s) => ({
        siteName: voiceSiteChoices.value.includes(s?.siteName) ? s.siteName : '',
        workCategoryId: s?.workCategoryId ?? '',
        startTime: snapTime(s?.startTime),
        endTime: snapTime(s?.endTime),
        note: s?.note ?? '',
      }))
      // 現場が1つも取れなくても確認画面は出す（人がその場で選んで反映できる）
      if (!voiceDraft.sites.length) {
        voiceDraft.sites = [{ siteName: '', workCategoryId: '', startTime: '', endTime: '', note: '' }]
      }
      voiceDraft.note = res.note ?? ''
      voiceDraft.raw = res.raw ?? text
      voiceConfirm.value = true
    } catch (e: any) {
      voiceError.value = t('report.voiceFailed')
      console.error('[voice-parse]', e)
    } finally {
      voiceBusy.value = false
    }
  })
}
// 確認画面で「反映」: 先頭の現場ブロック＋備考へ入れる（空欄の項目は触らない）
function applyVoiceDraft() {
  // ★話した現場の数だけ現場ブロックを用意して、1件ずつ入れる。
  //  足りなければ addSite() で足す（既存の入力は消さない＝上書きは空欄の項目だけ）。
  voiceDraft.sites.forEach((d, i) => {
    while ((report.form.value.sites?.length ?? 0) <= i) addSite()
    const site = report.form.value.sites?.[i]
    if (!site) return
    if (d.siteName) { site.siteName = d.siteName; onSiteChange(i) }
    if (d.workCategoryId) site.workCategoryId = d.workCategoryId
    const w = site.workers?.[0]
    if (w) {
      if (d.startTime) w.startTime = d.startTime
      if (d.endTime) w.endTime = d.endTime
    }
    // その現場での作業内容は現場備考へ（全体の備考と混ぜない）
    if (d.note) {
      const cur = (site as any).siteNote ?? ''
      ;(site as any).siteNote = cur ? `${cur}\n${d.note}` : d.note
    }
  })
  if (voiceDraft.note) {
    const cur = report.form.value.note ?? ''
    report.form.value.note = cur ? `${cur}\n${voiceDraft.note}` : voiceDraft.note
  }
  voiceConfirm.value = false
}

/**
 * 既定の作業区分＝「現場作業」。
 * ★入力項目がいきなり増えるとパニックになる人が出るので最初から選択済みにする（2026-08-16 人）。
 */
function defaultWorkCategoryId(): string | null {
  const all = master.workCategories.value
  return all.find(c => c.name === '現場作業')?.id ?? all[0]?.id ?? null
}

/** 現場が選ばれているか。区分の欄はこれが真になるまで出さない。 */
function isSiteChosen(s: SiteReport): boolean {
  const n = s?.siteName
  if (!n) return false
  if (n === '__other__') return !!s.customSiteName?.trim()
  return true
}

/**
 * 区分が空の現場ブロックに既定を当てる。★現場が選ばれているものだけ。
 * ★マスタは非同期で読むので、createSite の時点では区分が決められない。
 * ★既に入っている値は上書きしない（編集で開いた過去の区分を消さない）。
 */
function fillDefaultWorkCategories() {
  const def = defaultWorkCategoryId()
  if (!def) return
  for (const s of report.form.value.sites) {
    if (!s.workCategoryId && isSiteChosen(s)) s.workCategoryId = def
  }
}

// ★immediate が要る。マスタは localStorage にキャッシュされていて、
//  画面が出来た時点で既に読み込み済みのことがある。その場合 length は変化しないので
//  watch が一度も発火せず、区分が空のままになる（2026-08-17 本番で発生）。
watch(
  () => [master.workCategories.value.length, report.form.value.sites.length] as const,
  () => fillDefaultWorkCategories(),
  { immediate: true },
)

// ── 固定勤務時刻。★区分ごとの定時 → 現場の定時 → 無し の順に引く ──
//  定時は「現場だけ」でも「区分だけ」でも決まらない（事務は拠点で 08:30/08:00 と違う）。
//  現場×区分に設定があればそれを最優先。無ければ従来どおり現場の定時へ落ちる
//  ＝移行が済んでいない現場でも今までどおり動く。
function siteFixedTimes(siteName: string | undefined, si?: number): { start: string | null; end: string | null } | null {
  if (!siteName || siteName === '__other__' || siteName === '__unset__') return null
  if (si !== undefined) {
    const siteId = master.siteIds.value[siteName]
    const catId  = report.form.value.sites[si]?.workCategoryId
    if (siteId && catId) {
      const h = master.categoryHours.value[`${siteId}|${catId}`]
      if (h && (h.start || h.end)) return { start: h.start, end: h.end }
    }
  }
  return master.siteWorkTimes.value[siteName] ?? null
}
function siteFixedEnd(siteName: string | undefined, si?: number): string {
  return siteFixedTimes(siteName, si)?.end || ''
}
function siteFixedStart(siteName: string | undefined, si?: number): string {
  return siteFixedTimes(siteName, si)?.start || ''
}
// 現場の既定休憩[{start,minutes}]。設定ある現場のみ返す。
function siteFixedBreaks(siteName: string | undefined, si?: number): { start: string; minutes: number }[] | null {
  if (!siteName || siteName === '__other__' || siteName === '__unset__') return null
  // ★定時と同じ順序。現場×区分 → 現場 の順に引く
  if (si !== undefined) {
    const siteId = master.siteIds.value[siteName]
    const catId  = report.form.value.sites[si]?.workCategoryId
    if (siteId && catId) {
      const h = master.categoryHours.value[`${siteId}|${catId}`]
      if (h?.breaks?.length) return h.breaks
    }
  }
  const v = master.siteBreaks.value[siteName]
  return (Array.isArray(v) && v.length) ? v : null
}
// 現場を選び直した時、固定時刻/既定休憩があれば作業時刻の既定にする（新規入力のみ。編集中の既存値は触らない）。
function onSiteChange(si: number) {
  if (isEditMode.value) return
  const s = report.form.value.sites[si]
  if (!s) return
  // 現場を選んだ時点で区分の既定（現場作業）を入れる。★区分の欄は現場選択後に現れるので、
  //  ここで入れておかないと「現れた瞬間は空欄」になる
  if (isSiteChosen(s) && !s.workCategoryId) s.workCategoryId = defaultWorkCategoryId()
  // 元請けは現場マスタから逆算して持つ（入力させない）
  if (s.siteName && s.siteName !== '__other__' && s.siteName !== '__unset__') {
    s.contractorName = master.siteContractors.value[s.siteName] ?? ''
  }
  const w = s?.workers?.[0]
  if (!w) return
  const ft = siteFixedTimes(s?.siteName, si)
  if (ft?.start) w.startTime = ft.start
  if (ft?.end) w.endTime = ft.end
  // 現場に既定休憩があれば、その複数時間帯をスナップショット（breakSnapshot=trueで人件費計算が保存値を尊重）。
  //  設定が無ければ従来どおり自動計算のまま（breakSnapshotは付けない＝レガシー挙動）。
  const brks = siteFixedBreaks(s?.siteName, si)
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
  const endCap = siteFixedEnd(s?.siteName, si)
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
  await resolveWorkerRole()   // 現場作成の権限（canCreateSite）を解決

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
  } else if (prefillDate.value) {
    // ★退勤打刻からの遷移: ?date=YYYY-MM-DD&site=<現場名>
    //  打刻した日と現場をそのまま引き継ぐ（また選び直させない）。
    //  ここで未送信日の自動セットをしないのが肝——打刻したのは「今日」なのに、
    //  もっと古い未送信日が残っていると、そちらへ飛ばされて別の日の日報を書かせてしまう。
    report.form.value.date = prefillDate.value
    const name = prefillSite.value
    const s0 = report.form.value.sites[0]
    // 現場名はマスタに在るものだけ入れる。無い名前を入れると select が候補に無くて空表示になり、
    // 「現場が入っているように見えて実は未選択」という一番たちの悪い状態になる。
    // ★在庫判定は siteIds（全現場）で見る。以前は siteWorkTimes を見ていたが、そちらは
    //  固定勤務時刻を設定した現場しか収録しないため、本番の有効な現場128件中122件で
    //  現場が引き継がれず、打刻から飛んでも結局選び直しになっていた（2026-08-14 発見）。
    if (name && s0 && !s0.siteName && master.siteIds.value[name] !== undefined) {
      s0.siteName = name
      onSiteChange(0)   // 固定勤務時刻・既定休憩を、通常の現場選択とまったく同じ経路で適用する
    }
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
  // ★描画を終えてから後追いで承認待ちの日を飛ばす（初期化は待たせない）
  void skipPendingDatesAfterInit()
  // 実打刻も後追いで読む（取れなくても日報の入力は続けられるべきなので待たせない）
  void reloadPunches()
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
type PreviewWorkerRow = { name: string; hours: string; timeRange: string; breakMinutes: number }
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
  totalHours: number
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
    return { dateLabel, senderName, mode: 'paid_leave', note: form.note || '', sites: [], totalHours: 0 }
  }
  if (!isWorking) {
    return { dateLabel, senderName, mode: 'off', note: form.note || '', sites: [], totalHours: 0 }
  }

  const sites: PreviewSite[] = []
  let totalHours = 0
  for (const site of form.sites) {
    if (!site.siteName) continue
    const displayName = siteDisplayName(site.siteName, site.customSiteName)
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
      totalHours += h.hoursNormal + h.hoursSunday + h.hoursOT + h.hoursNight
        + h.hoursOTNight + h.hoursSundayOT + h.hoursSundayNight + h.hoursSundayOTNight
      workers.push({ name: w.workerName, hours: parts.join(' + ') || '—', timeRange, breakMinutes: effectiveBreakMinutes(w) })
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

  return { dateLabel, senderName, mode: 'working', note: form.note || '', sites, totalHours: Math.round(totalHours * 100) / 100 }
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

/**
 * 送信でエラーが出たことを記録する。
 * ★2026-08-30: 以前はLINEグループへ飛ばしていたが、LINE送信は撤去した
 *  （日報のLINE通知は 2026-07-01 以降ゼロで、運用としては既に終わっていた）。
 *  握り潰すと「送れていないのに誰も気づかない」ので、コンソールには必ず残す。
 */
function recordSubmitError(actionName: string, errorMsg: string) {
  console.error(`[Report] ${actionName} に失敗しました:`, errorMsg)
}

/**
 * 保存直前の保険: workers[].workerId が空なら報告者(本人 or 代理先)のIDで補完する。
 * 各所の初期化(setSelfWorking/initWorkers/addSite)では workerId をセットしているが、
 * 復元経路は form/workers を丸ごと持ち上げるため空文字が生き残る:
 *   - 下書き復元 `report.form.value = d.form`（デプロイ前に保存された下書き）
 *   - 編集モード復元 `workers: Array.isArray(site.workers) ? site.workers : [...]`（既存の空IDデータ）
 * workerId が無いと現場別集計(site-reports.vue)が workerName の完全一致フォールバックに
 * 依存し、マスタ名を変更した瞬間に人件費0円化する（#workerId未設定バグの再発経路）。
 * 個々の復元経路ではなく保存直前で一括正規化する。
 * ※ workers[] は UI に addWorker を露出していないため常に「報告者ちょうど1件」。
 */
function fillMissingWorkerIds() {
  const t = proxy.proxyTarget.value
  const selfId = t ? t.id : (currentUser.value?.worker_id ?? '')
  if (!selfId) return
  report.form.value.sites.forEach(site => {
    if (!Array.isArray(site.workers)) return
    site.workers.forEach((w, wi) => {
      if (wi === 0 && !w.workerId) w.workerId = selfId
    })
  })
}

async function handleSubmit() {
  report.form.value.isWorking  = isWorkingStr.value === 'working' || isWorkingStr.value === 'paid_leave'
  report.form.value.leaveType  = isWorkingStr.value === 'paid_leave' ? 'paid_leave' : null
  fillMissingWorkerIds()

  // ── 送信バリデート: 稼働ありで複数現場の作業時間帯が重複していたら弾く（80c2・開始時刻の制限撤廃に伴う安全網）──
  if (report.form.value.isWorking) {
    const overlapMsg = findWorkerTimeOverlap()
    if (overlapMsg) {
      if (isEditMode.value) editError.value = overlapMsg
      alert(overlapMsg)
      return
    }
  }

  // ── 送信バリデート: 接待交際費/会議費の同行者名が未記入なら弾く（税務要件・2026-07-27 議事録）──
  {
    const companionMsg = findMissingCompanions()
    if (companionMsg) {
      if (isEditMode.value) editError.value = companionMsg
      alert(companionMsg)
      return
    }
  }

  // ── 送信バリデート: 領収書も「無い理由」も無い経費は弾く（2026-08-14 ユーザー確定）──
  //  ★新規・編集の両方に効かせたいので、モード分岐より手前に置く。
  {
    const receiptMsg = findMissingReceipts()
    if (receiptMsg) {
      if (isEditMode.value) editError.value = receiptMsg
      alert(receiptMsg)
      return
    }
  }

  // ── 編集モード: Supabase のみ更新（GAS には再送しない）──
  if (isEditMode.value) {
    if (editSubmitting.value) return
    // ★編集理由は必須。ボタンも disabled にしているが、Enter送信等で素通りしうるのでここでも止める
    if (!editReason.value.trim()) {
      editError.value = t('report.editReasonRequired')
      return
    }
    editSubmitting.value = true
    editError.value = null
    // 送信のたびに新しくはせず、この編集操作に1つ割り当てる（再送で二重記録しない）
    if (!editLogToken.value) editLogToken.value = crypto.randomUUID()
    try {
      const uid = liff.profile.value?.userId
      if (!uid) throw new Error(t('report.errorNoLogin'))

      if (forceErrorOnSubmit.value) {
        forceErrorOnSubmit.value = false
        throw new Error('[テスト] Supabase保存エラー: connection timeout')
      }

      // ★承認制（保留方式）: ここでは daily_reports を書き換えない。
      //   編集内容は保留に入れ、管理者が承認して初めて日報・現場別集計に反映される。
      //   これにより「daily_reports に入っている＝承認済み」という不変条件が保てる
      //   （集計・PDF・請求など10以上の消費箇所を一切触らずに済む）。

      // ★保留に入れる前に領収書をアップロードする。
      //  これが無いと、作業員が画像を選んでも fileUrls が空のまま保留に入り、
      //  「添付忘れを直した」という理由の申請に領収書が1枚も付かない。
      //  本番で9件・約59,000円が証憑なしで承認待ちになっていた（2026-08-12 発見）。
      //  画面はプレビューが出て送信も成功するので、作業員も承認者も気づけなかった。
      const uploadErrors = await report.uploadPendingExpenseFiles()
      if (uploadErrors.length) {
        // ★黙って続けない。ここで通すと「添付したのに付いていない」を再生産する。
        editError.value = t('report2.uploadFailed', { errors: uploadErrors.join('\n') })
        editSubmitting.value = false
        return
      }

      // 何を変えたか（保留に添えて管理画面で照合できるようにする）
      const diffs = originalReport.value
        ? computeDiff(originalReport.value, {
            isWorking:  report.form.value.isWorking,
            leaveType:  isWorkingStr.value === 'paid_leave' ? 'paid_leave' : null,
            leaveDays:  currentLeaveDays(),
            leaveHours: leaveUnit.value === 'hour' ? (Number(leaveHours.value) || null) : null,
            sites:      report.form.value.sites,
            note:       report.form.value.note,
            // ★どちらも金額に効く（出張手当 +¥3,000/日・本日のガソリン代）。
            //   渡し漏れると書き換えても編集履歴が空になり、承認の監査が成立しない
            isBusinessTrip: report.form.value.isBusinessTrip,
            gasolineItems:  report.form.value.gasolineItems,
          })
        : []

      // ★申請が通らなければ編集は成立していない。ここは黙って続けず失敗として扱う
      //   （日報も変わらず保留も無い＝何も起きていない状態なので、そう伝えるのが正しい）。
      if (!await submitEditForApproval(diffs)) {
        throw new Error(t('report.editApprovalSubmitFailed'))
      }

      // ★2026-08-30: 編集差分のLINEグループ通知は撤去した。
      //  差分は report-edit-log EF が承認待ち(daily_report_pending_edits.diffs)へ載せ、
      //  管理画面の承認欄で見える＝通知が無くても中身は追える。

      editSubmitted.value = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('report.errorUpdateFailed')
      editError.value = msg
      recordSubmitError('日報編集', msg)
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
    recordSubmitError('日報新規送信（テスト）', 'network request failed')
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

  // ★期限切れ（3日より前）の新規提出は内容の承認制にする。
  //   既存の「過去3日ロック＋許可申請」は"出す許可"の承認で、中身（金額）は見ていない。
  //   遅れて出てくる日報こそ内容を確認したいので、承認されるまで daily_reports に書かない。
  const isLateSubmission = lock.isPastLockWindow(report.form.value.date)
  // 有給残不足で有給を選んだ新規提出も、承認されるまで daily_reports に書かない（二重承認制）。
  const isPaidLeaveOver = needsPaidLeaveApproval.value

  if (targetUserId && !isLateSubmission && !isPaidLeaveOver) {
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
      recordSubmitError('日報新規送信（DB保存）', msg)
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

  // ③-a 期限切れの新規提出: ここで初めて保留に入れる。
  //     ★report.submit() の後に置くのは、その中で領収書がアップロードされて *Urls が
  //       セットされるため。先に保留へ入れると領収書の無い内容が承認対象になる。
  if (isLateSubmission && targetUserId) {
    if (!await submitLateNewForApproval(targetUserId)) {
      editError.value = t('report.editApprovalSubmitFailed')
      return
    }
    lateSubmitted.value = true
    return
  }

  // ③-b 有給残不足の新規提出: 二重承認の保留に入れる（daily_reports にはまだ書かない）。
  if (isPaidLeaveOver && targetUserId) {
    if (!await submitPaidLeaveOverForApproval(targetUserId)) {
      editError.value = t('report.editApprovalSubmitFailed')
      return
    }
    lateSubmitted.value = true   // 「承認待ちで送信済み」の完了画面を出す（未送信トラップに落とさない）
    return
  }

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
      devLineUserId: config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : '',
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
  if (result.liters != null) item.liters = result.liters
  showReceiptToast('success', t('report.analyzeSuccess'))
}

/**
 * 明細ごとに領収書を複数枚つけた時、2枚目以降を「新しい明細」に展開する。
 *
 * ★経緯（2026-08-30・今井さんからの報告）:
 *  「写真を2枚つけることはできるけど、2枚解析しても1枚しか経費計上されない」。
 *  input は multiple なのに解析は files[0] しか見ておらず、2枚目以降は
 *  黙って捨てられていた（添付としては残るので気づきにくい）。
 *  個人経費には既に「1枚=1件の下書き」に展開する仕組みがあるので、考え方を揃える。
 *
 *  1枚目は今までどおりその明細に入れ、2枚目以降は同じ種別の明細を足して入れる。
 */
async function spreadExtraReceipts(
  si: number,
  field: 'other' | 'entertainment' | 'parking' | 'highway' | 'train' | 'hotel',
  index: number,
  files: File[],
): Promise<number> {
  const exp = report.form.value.sites[si].expenses
  const listOf = () => ({
    other: exp.others, entertainment: exp.entertainments, parking: exp.parkings,
    highway: exp.highways, train: exp.trains, hotel: exp.hotels,
  }[field]) as any[] | undefined
  const add = {
    other: () => report.addOther(si), entertainment: () => report.addEntertainment(si),
    parking: () => report.addParking(si), highway: () => report.addHighway(si),
    train: () => report.addTrain(si), hotel: () => report.addHotel(si),
  }[field]

  let done = 0
  for (let n = 1; n < files.length; n++) {
    add()
    await nextTick()
    const list = listOf()
    if (!list?.length) break
    const target = list[list.length - 1]
    target.files = [files[n]]
    const r = await receipt.analyze(files[n], `${si}-${field}-extra-${n}`)
    if (!r) continue
    if (r.yen) target.yen = r.yen
    if (r.label) { target.label = r.label; target.payee = r.label }
    if (r.storeName) target.payee = r.storeName
    target.registrationNumber = r.invoiceNumber || 'なし'
    if (r.account && !target.account) target.account = r.account
    done++
  }
  return done
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
    const all = exp.parkings?.[otherIndex!]?.files ?? []
    const item = exp.parkings?.[otherIndex!]
    if (item) {
      if (result.yen) item.yen = result.yen
      if (result.storeName) item.payee = result.storeName
      item.registrationNumber = inv   // AI解析の登録番号を反映（読めなければ「なし」）
    }
    if (all.length > 1) {
      const n = await spreadExtraReceipts(si, 'parking', otherIndex!, all)
      if (n) showReceiptToast('success', `${n + 1}枚を明細に分けました`)
    }
    return
  }
  if (field === 'highway') {
    const all = exp.highways?.[otherIndex!]?.files ?? []
    const item = exp.highways?.[otherIndex!]
    if (item) {
      if (result.yen) item.yen = result.yen
      if (result.storeName) item.payee = result.storeName
      item.registrationNumber = inv
    }
    if (all.length > 1) {
      const n = await spreadExtraReceipts(si, 'highway', otherIndex!, all)
      if (n) showReceiptToast('success', `${n + 1}枚を明細に分けました`)
    }
    return
  }
  if (field === 'train') {
    const all = exp.trains?.[otherIndex!]?.files ?? []
    const item = exp.trains?.[otherIndex!]
    if (item) {
      if (result.label) item.label = result.label
      if (result.storeName) item.payee = result.storeName
      if (result.yen)   item.yen   = result.yen
      item.registrationNumber = inv
    }
    if (all.length > 1) {
      const n = await spreadExtraReceipts(si, 'train', otherIndex!, all)
      if (n) showReceiptToast('success', `${n + 1}枚を明細に分けました`)
    }
    return
  }
  if (field === 'other') {
    const all = exp.others?.[otherIndex!]?.files ?? []
    const item = exp.others?.[otherIndex!]
    if (item) {
      if (result.label) item.label              = result.label
      if (result.label) item.payee              = result.label
      if (result.yen)   item.yen                = result.yen
      item.registrationNumber = inv
      // 勘定科目はAIの「候補」＝人が未選択のときだけ埋める（選び直した値を上書きしない）
      if (result.account && !item.account) item.account = result.account
    }
    if (all.length > 1) {
      const n = await spreadExtraReceipts(si, 'other', otherIndex!, all)
      if (n) showReceiptToast('success', `${n + 1}枚を明細に分けました`)
    }
    return
  }
  if (field === 'entertainment') {
    const all = exp.entertainments?.[otherIndex!]?.files ?? []
    const item = exp.entertainments?.[otherIndex!]
    if (item) {
      if (result.label) item.label              = result.label
      if (result.label) item.payee              = result.label
      if (result.yen)   item.yen                = result.yen
      item.registrationNumber = inv
      if (result.account && !item.account) item.account = result.account
    }
    if (all.length > 1) {
      const n = await spreadExtraReceipts(si, 'entertainment', otherIndex!, all)
      if (n) showReceiptToast('success', `${n + 1}枚を明細に分けました`)
    }
    return
  }
  if (field === 'hotel') {
    const all = exp.hotels?.[otherIndex!]?.files ?? []
    const item = exp.hotels?.[otherIndex!]
    if (item) {
      if (result.label) item.label              = result.label
      if (result.label) item.payee              = result.label
      if (result.yen)   item.yen                = result.yen
      item.registrationNumber = inv
    }
    if (all.length > 1) {
      const n = await spreadExtraReceipts(si, 'hotel', otherIndex!, all)
      if (n) showReceiptToast('success', `${n + 1}枚を明細に分けました`)
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
    // その他は1セクションに統合済み。科目で仕分ける（接待交際費もここに入れる）。
    site0.expenses.others = [
      { label: '養生テープ', yen: 1500, registrationNumber: 'なし', tategae: true, account: '消耗品費' },
      { label: '懇親会', yen: 10000, registrationNumber: 'T1111222233334', tategae: false, account: '接待交際費', companions: '元請け 山田様' },
    ]

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
  siteN.expenses.others = [
    { label: 'ビニールシート', yen: 800, registrationNumber: 'なし', tategae: false, account: '消耗品費' },
    { label: '昼食代', yen: 5000, registrationNumber: 'なし', tategae: true, account: '会議費' },
  ]
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
.similar-site-pick { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.similar-site-pick:active { opacity: .6; }

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
/* 未入力の必須欄（同行者名）。送信時に弾かれる前に気づけるようにする */
.input-required { border-color: #e57373; background: #fff8f8; }
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
.approved-extra { display: block; margin-top: 2px; font-weight: 700; }
/* 実打刻（表示専用・作業時刻とは別物と分かる見た目にする） */
.punch-row {
  margin-top: 4px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 12px; color: #334155; background: #f8fafc;
  border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 10px; line-height: 1.5;
}
.punch-icon { font-size: 16px; color: #64748b; }
.punch-label { color: #64748b; }
.punch-time { font-weight: 700; font-variant-numeric: tabular-nums; }
.punch-gap { margin-left: auto; color: #92400e; background: #fef3c7; border-radius: 999px; padding: 1px 8px; }
.punch-gap.big { color: #991b1b; background: #fee2e2; font-weight: 700; }
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

/* ── 音声入力 ── */
.voice-row { display: flex; align-items: center; gap: 10px; margin: 4px 0 14px; flex-wrap: wrap; }
.voice-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; color: var(--accent);
  border: 1.5px solid var(--accent); border-radius: 999px;
  padding: 9px 18px; font-size: 14px; font-weight: 700;
  font-family: var(--font); cursor: pointer;
}
.voice-btn:disabled { opacity: .5; cursor: default; }
.voice-btn.listening { background: var(--accent); color: #fff; animation: voice-pulse 1s ease-in-out infinite; }
@keyframes voice-pulse { 0%,100% { opacity: 1; } 50% { opacity: .6; } }
.voice-error { color: #c0392b; font-size: 13px; }
.voice-modal-back {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px;
}
.voice-modal {
  background: #fff; border-radius: 14px; padding: 20px;
  width: 100%; max-width: 420px; max-height: 88vh; overflow-y: auto;
}
.voice-modal h3 { margin: 0 0 12px; font-size: 17px; }
.voice-heard {
  display: flex; align-items: flex-start; gap: 6px;
  background: #f4f6f8; border-radius: 8px; padding: 10px 12px;
  font-size: 13px; color: #444; margin-bottom: 14px;
}
.voice-heard .material-symbols-rounded { font-size: 18px; color: #888; }
.voice-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; font-size: 13px; font-weight: 700; color: #555; }
.voice-field-row { display: flex; gap: 12px; }
/* 現場ごとのブロック（複数現場を一度に話せる） */
.voice-site-block { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
.voice-site-no { font-size: 12px; font-weight: 700; color: #06864a; margin-bottom: 6px; }
.voice-field-row .voice-field { flex: 1; }
.voice-modal-btns { display: flex; gap: 10px; margin-top: 8px; }
.voice-modal-btns button { flex: 1; }
.btn-cancel {
  background: #f0f0f0; color: #555; border: none; border-radius: 8px;
  padding: 12px; font-size: 14px; font-weight: 700; font-family: var(--font); cursor: pointer;
}
.btn-apply {
  background: var(--accent); color: #fff; border: none; border-radius: 8px;
  padding: 12px; font-size: 14px; font-weight: 700; font-family: var(--font); cursor: pointer;
}

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

/* ── 編集理由（編集時のみ・必須） ── */
.edit-reason {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #fff8e1;
  border: 1px solid #f0c030;
  border-radius: 8px;
  padding: 12px 14px;
}
/* 必須表示は全画面で「※付き赤文字」に統一（Field.vue / FormSection.vue と同じ） */
.edit-reason-label .required { color: var(--danger); font-size: 11px; font-weight: 700; margin-left: 6px; }
.edit-reason-label { font-size: 13px; font-weight: 700; color: #7a6000; }
.edit-reason-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 16px;   /* iOS で入力時にズームされないよう16px以上を保つ */
  font-family: inherit;
  resize: vertical;
}
.edit-reason-hint { font-size: 11px; color: #8a7a4a; margin: 0; }
.state-warn { font-size: 13px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 12px; margin: 8px 0 0; }

/* ── 編集モードバナー ── */
.pending-banner {
  background: #eef6ff;
  border: 1px solid #7ea8dd;
  color: #1e4f8a;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
}
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
.preview-table td.preview-break { white-space: nowrap; color: #64748b; font-size: 11px; }
.preview-list { list-style: none; margin: 0 0 6px; padding: 0; font-size: 12px; color: var(--text); }
.preview-list li { padding: 2px 0; }
.preview-note { font-size: 12px; color: #64748b; margin: 0; }
.preview-note-main { padding: 8px 14px 12px; border-top: 1px solid #e2e8f0; }
.preview-total { text-align: right; font-size: 12px; font-weight: 700; color: var(--text); padding: 4px 14px 2px; }

/* ── レスポンシブ ── */
@media (max-width: 380px) {
  .expense-grid { grid-template-columns: 1fr; }
  .worker-hours-row { flex-wrap: wrap; }
}

/* ── AI解析トースト ── */
.receipt-toast {
  position: fixed;
  bottom: calc(80px + var(--app-bottom-nav-h, 54px)); left: 50%; transform: translateX(-50%);
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
