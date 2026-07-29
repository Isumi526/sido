<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">見積もり</h1>
      <RouterLink to="/estimate-list" class="back-link" data-testid="back-to-list">← 見積一覧へ</RouterLink>
    </div>

    <!-- 案件を開いている時のバー（案件名の編集・元請け・別案件の新規作成） -->
    <div v-if="projectId" class="bar">
      <div class="bar-group">
        <label>案件</label>
        <span v-if="!editingName" class="current-project" data-testid="project-select" title="クリックで名称変更" @click="startRename">{{ currentProjectName }} <span class="edit-ic">✎</span></span>
        <input v-else v-model="projectNameEdit" class="input proj-name" data-testid="project-name-input" @keyup.enter="commitRename" @blur="commitRename" />
        <span v-if="projectErr" class="err" data-testid="project-err">{{ projectErr }}</span>
      </div>

      <!-- 案件に元請けを紐付け（見積書PDFの送信先になる。正式受注後に現場へ昇華する前段） -->
      <div class="bar-group">
        <label>元請け</label>
        <select :value="currentContractorId || ''" class="input sel" :disabled="projectSaving" data-testid="project-contractor"
                @change="setProjectContractor(($event.target as HTMLSelectElement).value || null)">
          <option value="">（未設定）</option>
          <option v-for="c in contractors" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <RouterLink to="/contractors" class="muted-link">元請け担当者を管理</RouterLink>
      </div>

      <!-- 受注 → 現場化（受注確定で現場に紐付け。以降の日報/発注/経費を現場単位に） -->
      <div class="bar-group">
        <template v-if="currentProject?.site_id">
          <span class="badge ok-badge">受注済み</span>
          <span class="muted">現場: <RouterLink to="/sites" class="muted-link" data-testid="linked-site">{{ currentSiteName || '(現場)' }}</RouterLink></span>
        </template>
        <button v-else class="btn-add" data-testid="promote-open" @click="openPromote"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">construction</span> 受注して現場化</button>
        <span v-if="promoteMsg" class="ok" data-testid="promote-msg">{{ promoteMsg }}</span>
      </div>
    </div>

    <!-- 受注→現場化ダイアログ -->
    <div v-if="promoteOpen" class="modal-overlay" @click.self="promoteOpen = false">
      <div class="send-modal">
        <h3>受注 → 現場化</h3>
        <p class="muted">この見積を「受注」にして現場に紐付けます。以降の日報・発注・経費を現場単位で集約できます。</p>
        <div class="field">
          <label>方法</label>
          <label class="recipient"><input type="radio" value="new" v-model="promoteMode" />新しい現場を作成</label>
          <label class="recipient" :class="{ off: !sites.length }"><input type="radio" value="existing" v-model="promoteMode" :disabled="!sites.length" />既存の現場に紐付け</label>
        </div>
        <template v-if="promoteMode === 'new'">
          <div class="field"><label>現場名</label><input v-model="promoteName" class="input" data-testid="promote-name" /></div>
          <div class="field"><span class="muted">元請け: {{ currentContractorName || '—' }} ／ 工事場所: {{ doc.construction_location || '—' }}（現場に引き継ぎます）</span></div>
        </template>
        <template v-else>
          <div class="field">
            <label>紐付ける現場</label>
            <select v-model="promoteSiteId" class="input" data-testid="promote-site">
              <option :value="null" disabled>現場を選択…</option>
              <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
        </template>
        <div class="modal-actions">
          <button class="btn-primary" :disabled="promoteBusy || (promoteMode === 'new' ? !promoteName.trim() : !promoteSiteId)" data-testid="promote-confirm" @click="promote">{{ promoteBusy ? '処理中…' : '現場化して受注にする' }}</button>
          <button class="btn-cancel" @click="promoteOpen = false">キャンセル</button>
        </div>
        <span v-if="promoteErr" class="err" data-testid="promote-err">{{ promoteErr }}</span>
      </div>
    </div>

    <!-- E5 マスタ蓄積: 入力済み材料を予測変換候補に（案件選択前から常時ロード） -->
    <datalist id="est-material-codes"><option v-for="c in materialCodeOptions" :key="c" :value="c" /></datalist>
          <datalist id="est-materials">
      <option v-for="m in materials" :key="m.id" :value="m.name" />
    </datalist>

    <template v-if="projectId">
      <div class="builder-tabs">
        <button class="btab" :class="{ active: builderTab === 'intake' }" data-testid="tab-intake" @click="builderTab = 'intake'">案件情報</button>
        <button class="btab" :class="{ active: builderTab === 'quotes' }" data-testid="tab-quotes" @click="builderTab = 'quotes'">相見積</button>
        <button class="btab" :class="{ active: builderTab === 'items' }" data-testid="tab-items" @click="builderTab = 'items'">明細入力</button>
        <button class="btab" :class="{ active: builderTab === 'preview' }" data-testid="tab-preview" @click="builderTab = 'preview'">見積書プレビュー</button>
        <!-- 発注は受注してからしか発生しない。受注前に出ていると紛らわしいので隠す（レビュー2026-07-28） -->
        <button v-if="isOrdered" class="btab" :class="{ active: builderTab === 'po' }" data-testid="tab-po" @click="builderTab = 'po'">商社へ発注</button>
        <button class="btab ghost" data-testid="open-drawer" @click="openDrawer"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">settings</span> マスタ・自社情報</button>
      </div>

      <!-- ── 案件情報（Q5: 元請けからの受領登録・ステータス管理）── -->
      <div v-show="builderTab === 'intake'">
        <section class="panel intake-panel">
          <div class="panel-head"><h2>案件情報</h2><span v-if="intakeSavedMsg" class="ok">{{ intakeSavedMsg }}</span></div>
          <div class="intake-grid">
            <label class="ifield"><span>元請けからの依頼日</span>
              <input v-model="intake.request_date" type="date" class="input" data-testid="intake-request-date" @change="saveIntake" />
            </label>
            <label class="ifield"><span>元請けへの提出期限</span>
              <input v-model="intake.due_date" type="date" class="input" data-testid="intake-due-date" @change="saveIntake" />
              <span v-if="dueBadge" class="due-badge" :class="dueBadge.cls" data-testid="intake-due-badge">{{ dueBadge.text }}</span>
            </label>
            <label class="ifield"><span>状態</span>
              <select v-model="intake.status" class="input" data-testid="intake-status" @change="saveIntake">
                <option v-for="s in PROJECT_STATUSES" :key="s.key" :value="s.key">{{ s.label }}</option>
              </select>
            </label>
            <label v-if="needsReason" class="ifield wide"><span>{{ intake.status === 'declined' ? '辞退' : '失注' }}の理由</span>
              <input v-model="intake.lost_reason" class="input" data-testid="intake-lost-reason"
                     placeholder="例：他社が安かった / 工期が合わなかった" @change="saveIntake" />
            </label>
          </div>
          <p v-if="isArchivedStatus" class="intake-note" data-testid="intake-archive-note">
            この案件は{{ intake.status === 'declined' ? '辞退' : '失注' }}扱いですが、<strong>削除せず残します</strong>。入力済みの単価は次回見積の参考データとして使えます。
          </p>

          <div class="panel-head" style="margin-top:16px"><h3 class="sub-h">図面・資料</h3></div>
          <!-- R9: ドラッグ&ドロップ対応。ファイル添付は指定が無くてもD&Dできるのを既定にする -->
          <div class="att-row att-drop" :class="{ over: attDragOver }" data-testid="intake-dropzone"
               @dragover.prevent="attDragOver = true" @dragleave="attDragOver = false" @drop.prevent="onIntakeDrop">
            <label class="btn-excel att-pick">
              <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">upload_file</span>
              図面を追加
              <input type="file" multiple accept=".pdf,image/*" hidden data-testid="intake-file" @change="onIntakeFiles" />
            </label>
            <span class="hint">ここにドラッグ&ドロップでも追加できます</span>
            <span v-if="attBusy" class="hint">アップロード中…</span>
            <span v-if="attErr" class="err">{{ attErr }}</span>
          </div>
          <ul v-if="attachments.length" class="att-list" data-testid="intake-att-list">
            <li v-for="a in attachments" :key="a.id">
              <button class="att-name" :data-testid="`intake-att-${a.id}`" @click="openAttachment(a)">{{ a.name || a.path }}</button>
              <!-- R8: 図面はページごとに工種が分かれている。該当ページだけ業者へ送る -->
              <button v-if="isPdf(a)" class="btn-edit" :data-testid="`dsend-open-${a.id}`" @click="openDrawingSend(a)">ページを選んで送る</button>
              <button class="btn-del" :data-testid="`intake-att-del-${a.id}`" @click="removeAttachment(a)">×</button>
            </li>
          </ul>
          <p v-else class="hint">まだ図面がありません。元請けから受け取った図面をここに置いておくと、見積作成時に参照できます。</p>
        </section>

        <!-- ── R8: 図面のページを選んで下請へ送る（Dropboxでやっていた作業の置き換え）── -->
        <section v-if="dsend.att" class="panel" data-testid="dsend-panel">
          <div class="panel-head">
            <h2>図面を送る — {{ dsend.att.name || dsend.att.path }}</h2>
            <button class="btn-cancel" data-testid="dsend-close" @click="closeDrawingSend">閉じる</button>
          </div>
          <p class="hint">
            図面は工種ごとにページが分かれています。<strong>送るページだけ</strong>選んでください。
            選んだページだけを抜き出したPDFを作って送ります（元の図面はそのまま残ります）。
          </p>

          <div v-if="dsend.loading" class="hint">図面を読み込み中…</div>
          <template v-else>
            <div class="dsend-tools">
              <label class="dsend-range">ページ指定
                <input v-model="dsend.rangeText" class="input sm" data-testid="dsend-range"
                       placeholder="例: 13-19, 22" @change="applyPageRange" />
              </label>
              <button class="btn-link-sm" data-testid="dsend-all" @click="selectAllPages(true)">全選択</button>
              <button class="btn-link-sm" data-testid="dsend-none" @click="selectAllPages(false)">全解除</button>
              <span class="dsend-count" data-testid="dsend-count">{{ dsend.selected.length }} / {{ dsend.pageCount }} ページ</span>
            </div>
            <div class="dsend-pages">
              <button v-for="p in dsend.pageCount" :key="p" class="pg-chip"
                      :class="{ on: dsend.selected.includes(p), focus: dsend.preview === p }"
                      :data-testid="`dsend-page-${p}`"
                      @click="togglePage(p)" @dblclick="previewPage(p)">
                {{ p }}
              </button>
            </div>
            <p class="hint">クリックで選択／ダブルクリックでそのページを下に表示（中身を確かめてから選べます）。</p>
            <div v-if="dsend.previewUrl" class="dsend-preview">
              <div class="dsp-head">P.{{ dsend.preview }} のプレビュー</div>
              <iframe :src="dsend.previewUrl" class="dsp-frame" title="図面プレビュー"></iframe>
            </div>

            <div class="panel-head" style="margin-top:14px"><h3 class="sub-h">送り先</h3></div>
            <div class="ifields">
              <label class="ifield"><span>業者</span>
                <select v-model="dsend.subId" class="input" data-testid="dsend-sub" @change="dsend.contactIds = []">
                  <option value="">—</option>
                  <option v-for="sc in subcontractorOptions" :key="sc.id" :value="sc.id">{{ sc.name }}</option>
                </select>
              </label>
              <label class="ifield wide"><span>担当者（複数選択可）</span>
                <span class="dsend-contacts">
                  <label v-for="c in contactsOfSub(dsend.subId)" :key="c.id" class="cc-check">
                    <input type="checkbox" :value="c.id" v-model="dsend.contactIds" :data-testid="`dsend-contact-${c.id}`" />
                    {{ c.name }}<small v-if="!c.email">（メール未登録）</small>
                  </label>
                  <span v-if="dsend.subId && !contactsOfSub(dsend.subId).length" class="err" data-testid="dsend-no-contact">
                    この業者に担当者が登録されていません
                  </span>
                </span>
              </label>
              <label class="ifield wide"><span>件名</span>
                <input v-model="dsend.subject" class="input" data-testid="dsend-subject" :placeholder="defaultDsendSubject" />
              </label>
              <label class="ifield wide"><span>本文（空なら既定の文面）</span>
                <textarea v-model="dsend.body" class="input" rows="4" data-testid="dsend-body"></textarea>
              </label>
            </div>
            <div class="actions-row">
              <button class="btn-primary" :disabled="!canSendDrawing || dsend.sending" data-testid="dsend-send" @click="sendDrawing">
                {{ dsend.sending ? '送信中…' : `選んだ ${dsend.selected.length} ページを送る` }}
              </button>
              <span v-if="dsend.msg" class="ok" data-testid="dsend-msg">{{ dsend.msg }}</span>
              <span v-if="dsend.err" class="err" data-testid="dsend-err">{{ dsend.err }}</span>
            </div>
          </template>
        </section>

        <!-- 送信履歴: 「誰にどのページを渡したか」は後で必ず問題になるので必ず見えるようにする -->
        <section v-if="drawingSends.length" class="panel" data-testid="dsend-history">
          <div class="panel-head"><h3 class="sub-h">図面の送信履歴</h3></div>
          <table class="table">
            <thead><tr><th>送信日時</th><th>業者</th><th>ページ</th><th>元ファイル</th><th>宛先</th></tr></thead>
            <tbody>
              <tr v-for="h in drawingSends" :key="h.id">
                <td>{{ h.sent_at ? new Date(h.sent_at).toLocaleString('ja-JP') : '未送信' }}</td>
                <td>{{ subName(h.subcontractor_id) }}</td>
                <td>P.{{ pageRangeLabel(h.pages ?? []) }}</td>
                <td>{{ h.source_name || '—' }}</td>
                <td class="dsend-to">{{ h.email_to }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- ── 相見積（Q3: 依頼→受領→比較・選定 / 受領登録の副作用で単価履歴が貯まる）── -->
      <div v-show="builderTab === 'quotes'">
        <section class="panel">
          <div class="panel-head">
            <h2>依頼した業者と回収状況</h2>
            <button class="btn-add" data-testid="qr-add" @click="addQuoteRequest">＋ 業者を手で追加</button>
          </div>
          <!-- ★R7: 依頼は「案件情報タブで図面のページを送る」と自動で立つ。
               ここで工種・依頼日・回収期限を1件ずつ手入力させるのは実業務に対して過剰だった。
               手追加は「システムを通さずメールで見積が来た業者」を登録するための逃げ道として残す。 -->
          <p class="hint">
            <strong>案件情報タブで図面のページを送ると、その業者の依頼がここに自動で並びます。</strong>
            受領した単価はそのまま単価履歴になります（別途の入力は不要）。
          </p>
          <table class="table">
            <thead><tr><th>業者</th><th>送った図面</th><th>依頼日</th><th>回収期限</th><th>受領日</th><th>状況</th><th class="num">明細</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(q, qi) in quoteRequests" :key="q.id" :data-testid="`qr-row-${qi}`">
                <td>
                  <select v-model="q.subcontractor_id" class="input sm" :data-testid="`qr-sub-${qi}`" @change="saveQuoteRequest(q)">
                    <option :value="null">—</option>
                    <option v-for="sc in subcontractorOptions" :key="sc.id" :value="sc.id">{{ sc.name }}</option>
                  </select>
                </td>
                <!-- どのページを渡して見積を待っているかが1行で分かる状態にする -->
                <td class="qr-pages" :data-testid="`qr-pages-${qi}`">{{ sentPagesLabel(q) }}</td>
                <td :data-testid="`qr-req-${qi}`">{{ q.requested_at || '—' }}</td>
                <td><input v-model="q.due_date" type="date" class="input sm" :data-testid="`qr-due-${qi}`" @change="saveQuoteRequest(q)" /></td>
                <td><input v-model="q.received_at" type="date" class="input sm" :data-testid="`qr-recv-${qi}`" @change="saveQuoteRequest(q)" /></td>
                <td><span class="qr-badge" :class="qrState(q).cls" :data-testid="`qr-state-${qi}`">{{ qrState(q).text }}</span></td>
                <td class="num" :data-testid="`qr-count-${qi}`">{{ linesOf(q.id).length }}</td>
                <td>
                  <button class="btn-edit" :data-testid="`qr-open-${qi}`" @click="openQuoteLines(q)">明細</button>
                  <button class="btn-del" :data-testid="`qr-del-${qi}`" @click="removeQuoteRequest(q)">×</button>
                </td>
              </tr>
              <tr v-if="!quoteRequests.length"><td colspan="8" class="empty">案件情報タブで図面のページを業者へ送ると、ここに依頼が並びます</td></tr>
            </tbody>
          </table>
        </section>

        <!-- 受領明細の入力（この登録が単価履歴になる） -->
        <section v-if="openedRequest" class="panel" data-testid="ql-panel">
          <div class="panel-head">
            <h2>{{ subName(openedRequest.subcontractor_id) }} からの見積</h2>
            <div class="row-tools">
              <button class="btn-add" data-testid="ql-add" @click="addQuoteLine">＋ 行追加</button>
              <button class="btn-cancel" data-testid="ql-close" @click="openedRequest = null">閉じる</button>
            </div>
          </div>
          <div class="items-scroll">
            <table class="table est-items">
              <thead><tr><th>項目</th><th>形状・詳細</th><th>単位</th><th>単価の区分</th><th class="num">数量</th><th class="num">単価</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(l, li) in openedLines" :key="l._k">
                  <td><input v-model="l.item_name" class="input" :data-testid="`ql-name-${li}`" list="est-materials" /></td>
                  <td><input v-model="l.spec" class="input sm" :data-testid="`ql-spec-${li}`" /></td>
                  <td><input v-model="l.unit" class="input sm" :data-testid="`ql-unit-${li}`" placeholder="㎡/m/式" /></td>
                  <td>
                    <!-- 単価の意味が業者ごとに違う（確認6）。揃えずに横並びすると誤選定するので必ず持つ -->
                    <select v-model="l.price_kind" class="input sm" :data-testid="`ql-kind-${li}`">
                      <option v-for="k in PRICE_KINDS" :key="k.key" :value="k.key">{{ k.label }}</option>
                    </select>
                  </td>
                  <td class="num"><input v-model.number="l.quantity" type="number" step="0.01" class="input sm num" :data-testid="`ql-qty-${li}`" /></td>
                  <td class="num"><input v-model.number="l.unit_price" type="number" class="input sm num" :data-testid="`ql-price-${li}`" /></td>
                  <td><button class="btn-del" :data-testid="`ql-del-${li}`" @click="removeQuoteLine(li)">×</button></td>
                </tr>
                <tr v-if="!openedLines.length"><td colspan="7" class="empty">「＋ 行追加」で受領した見積の項目・単価を入れます</td></tr>
              </tbody>
            </table>
          </div>
          <!-- ★R5: 受領した見積書そのもの（PDF等）を残す。
               単価だけ持っていても、後から金額の妥当性を確認できない。 -->
          <div class="panel-head" style="margin-top:14px"><h3 class="sub-h">受け取った見積書</h3></div>
          <div class="att-row att-drop" :class="{ over: qfDragOver }" data-testid="qf-dropzone"
               @dragover.prevent="qfDragOver = true" @dragleave="qfDragOver = false" @drop.prevent="onQuoteFileDrop">
            <label class="btn-excel att-pick">
              <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">upload_file</span>
              見積書を添付
              <input type="file" multiple accept=".pdf,image/*" hidden data-testid="qf-file" @change="onQuoteFiles" />
            </label>
            <span class="hint">ここにドラッグ&ドロップでも追加できます</span>
            <span v-if="qfBusy" class="hint">アップロード中…</span>
            <span v-if="qfErr" class="err" data-testid="qf-err">{{ qfErr }}</span>
          </div>
          <ul v-if="openedFiles.length" class="att-list" data-testid="qf-list">
            <li v-for="f in openedFiles" :key="f.id">
              <button class="att-name" :data-testid="`qf-open-${f.id}`" @click="openQuoteFile(f)">{{ f.name || f.path }}</button>
              <button class="btn-del" :data-testid="`qf-del-${f.id}`" @click="removeQuoteFile(f)">×</button>
            </li>
          </ul>
          <p v-else class="hint">業者から届いた見積書（PDF・写真）を置いておくと、あとで単価の根拠を確認できます。</p>

          <div class="actions-row">
            <button class="btn-primary" :disabled="qlSaving" data-testid="ql-save" @click="saveQuoteLines">{{ qlSaving ? '保存中…' : '保存（単価履歴に記録）' }}</button>
            <span v-if="qlMsg" class="ok">{{ qlMsg }}</span>
            <span v-if="qlErr" class="err">{{ qlErr }}</span>
          </div>
        </section>

        <!-- 比較・選定 -->
        <section class="panel" data-testid="compare-panel">
          <div class="panel-head"><h2>比較・選定</h2></div>
          <p v-if="!comparison.length" class="hint">見積を受領すると、同じ項目を業者ごとに横並びで比較できます。</p>
          <div v-for="c in comparison" :key="c.itemName" class="cmp-block" :data-testid="`cmp-${c.itemName}`">
            <div class="cmp-head">
              <span class="cmp-title">{{ c.itemName }}</span>
              <span v-if="c.mixedKind" class="cmp-warn" :data-testid="`cmp-warn-kind-${c.itemName}`">
                <span class="material-symbols-rounded banner-icon">warning</span>単価の区分が業者間で異なります（材工共 / 労務のみ）。そのまま比べないでください
              </span>
              <span v-if="c.mixedQty" class="cmp-warn" :data-testid="`cmp-warn-qty-${c.itemName}`">
                <span class="material-symbols-rounded banner-icon">warning</span>数量の認識が業者間で違います（{{ c.qtyList }}）
              </span>
            </div>
            <div class="cmp-cards">
              <button v-for="o in c.offers" :key="o.id" class="cmp-card"
                      :class="{ selected: o.is_selected, cheapest: o.unit_price === c.min }"
                      :data-testid="`cmp-pick-${c.itemName}-${o.subName}`"
                      @click="selectOffer(c, o)">
                <span class="cc-sub">{{ o.subName }}</span>
                <span class="cc-price">{{ yen(o.unit_price) }}<small v-if="o.unit">/{{ o.unit }}</small></span>
                <span class="cc-meta">{{ kindLabel(o.price_kind) }}<template v-if="o.quantity"> ・数量{{ o.quantity }}</template></span>
                <span v-if="o.unit_price === c.min" class="cc-tag">最安</span>
                <span v-if="o.is_selected" class="cc-tag sel">採用</span>
              </button>
            </div>
          </div>
          <div v-if="comparison.length" class="actions-row">
            <button class="btn-primary" data-testid="cmp-apply" @click="applySelectionToItems">選定した単価を明細へ反映</button>
            <span v-if="applyMsg" class="ok">{{ applyMsg }}</span>
          </div>
        </section>
      </div>

      <div v-show="builderTab === 'items'">
      <div class="grid">
        <!-- 明細入力 -->
        <section class="panel">
          <div class="panel-head">
            <h2>明細入力</h2>
            <div class="row-tools">
              <!-- 粗利率はこの見積ぜんぶに1つだけ。行ごとの設定はしない（レビュー2026-07-28）。
                   アカウント既定 ＋ この見積だけ上書き、で足りる。 -->
              <label class="margin-field">粗利
                <input v-model.number="marginPct" type="number" min="0" max="99" step="1"
                       class="input xs num" data-testid="margin-rate" @change="onMarginChange" />%
                <span v-if="doc.margin_rate === null" class="margin-hint">（既定）</span>
                <button v-else class="btn-link-sm" data-testid="margin-reset" @click="resetMargin">既定に戻す</button>
              </label>
            </div>
          </div>
          <!-- 列が増えたため、パネル内で横スクロールさせる（ページ全体を横に伸ばさない） -->
          <div class="items-scroll">
          <table class="table est-items">
            <thead>
              <tr>
                <!-- 列順は顧客のExcelに合わせる（突き合わせできるようにするため・レビュー2026-07-29）:
                     名称 → 品番 → 形状詳細 → W → D → H → 数量 → 単位 → 単価 → 金額
                     原価・商社は客先に出さない社内用なので、金額の後ろにまとめる。 -->
                <th class="drag-col"></th><th>名称</th><th>品番</th><th>形状・詳細</th>
                <th class="num dim-col">W</th><th class="num dim-col">D</th><th class="num dim-col">H</th>
                <th class="num">数量</th><th>単位</th>
                <th class="num">単価</th><th class="num">金額</th>
                <th class="cost-col">商社</th><th class="num cost-col">単価原価</th><th class="num cost-col">金額原価</th><th></th>
              </tr>
            </thead>
            <tbody>
              <!-- ★場所（大項目）> 工種（中項目）> 明細行 の2階層。
                   Excelは「壁面工事」の下に「軽鉄工事」「塗装工事」…と複数の工種がぶら下がる。
                   1場所1工種にすると、同じ場所を工種の数だけ書くことになる（レビュー2026-07-29）。 -->
              <template v-for="(a, ai) in areas" :key="ai">
                <tr class="area-row" :data-testid="`area-row-${ai}`">
                  <td class="drag-col"></td>
                  <td colspan="14">
                    <span class="blk-fields">
                      <span class="area-label">場所</span>
                      <input :value="a.location" class="input sm area-input" :data-testid="`area-loc-${ai}`"
                             list="est-locations" autocomplete="off" placeholder="例：壁面工事"
                             @input="onAreaLocation(a, ($event.target as HTMLInputElement).value)" />
                      <span class="blk-count">{{ a.blocks.length }}工種 / {{ a.filled }}件</span>
                      <button class="btn-add area-add" :data-testid="`area-add-trade-${ai}`" @click="addTradeToArea(a)">＋ 工種を追加</button>
                      <button class="btn-del blk-del" :data-testid="`area-del-${ai}`" title="この場所ごと削除" @click="removeArea(a)">×</button>
                    </span>
                  </td>
                </tr>
              <template v-for="b in a.blocks" :key="blocks.indexOf(b)">
                <tr class="blk-row" :data-testid="`blk-row-${blocks.indexOf(b)}`">
                  <td class="drag-col"></td>
                  <td colspan="14">
                    <span class="blk-fields blk-indent">
                      <span class="blk-sep">└</span>
                      <!-- 工種は自由記述＋予測変換（固定マスタからの選択を強制しない） -->
                      <input :value="b.trade_name" class="input sm blk-input" :data-testid="`blk-trade-${blocks.indexOf(b)}`"
                             list="est-trades" autocomplete="off" placeholder="工種（例：軽鉄工事）"
                             @input="onBlockField(b, 'trade_name', ($event.target as HTMLInputElement).value)" />
                      <span class="blk-count">{{ b.filled }}件</span>
                      <button class="btn-del blk-del" :data-testid="`blk-del-${blocks.indexOf(b)}`" title="この工種を削除" @click="removeBlock(b)">×</button>
                    </span>
                  </td>
                </tr>
                <template v-for="i in b.idxs" :key="rows[i]._k">
                <tr :class="{ 'drag-over': dragOverIndex === i && dragIndex !== null && dragIndex !== i }"
                    @dragover.prevent="dragOverIndex = i" @drop="onDrop(i)" @dragleave="dragOverIndex = null">
                  <td class="drag-handle" draggable="true" title="ドラッグで並び替え" :data-testid="`item-drag-${i}`" @dragstart="onDragStart(i)" @dragend="onDragEnd">⠿</td>
                  <td>
                    <input v-model="rows[i].item_name" class="input" :data-testid="`item-name-${i}`" list="est-materials"
                           autocomplete="off" @input="computeDidYouMean(rows[i])"
                           @change="onItemNameChange(rows[i])" @blur="onItemNameChange(rows[i])" />
                    <!-- ★R6: 表記ゆれ・打ち間違い用の「もしかして」。予測変換(datalist)は
                         前方一致しか効かないので、似ている既存名を別に出す。 -->
                    <button v-if="needsLookup(rows[i])" class="pinfo-ask" :data-testid="`item-pinfo-ask-${i}`"
                            title="この品名の商品情報（サイズ・仕様・画像）をネット検索で調べる"
                            @click="lookupProductInfo(rows[i], true)">
                      <span class="material-symbols-rounded" style="font-size:13px;vertical-align:middle">search</span> 商品情報を調べる
                    </button>
                    <span v-if="didYouMean(rows[i]).length" class="dym" :data-testid="`item-dym-${i}`">
                      もしかして:
                      <button v-for="(c, ci) in didYouMean(rows[i])" :key="c" class="dym-pick"
                              :data-testid="`item-dym-${i}-${ci}`" @click="applyDidYouMean(rows[i], c)">{{ c }}</button>
                    </span>
                  </td>
                  <!-- ★R3: 品番は形状・詳細と別列。品番はメーカー特定・商品情報取得のキーになる -->
                  <td><input v-model="rows[i].product_code" class="input sm" :data-testid="`item-code-${i}`"
                             list="est-material-codes" autocomplete="off" placeholder="SLP314 等"
                             @change="onCodeChange(rows[i])" @blur="onCodeChange(rows[i])" /></td>
                  <td><input v-model="rows[i].spec" class="input sm" :data-testid="`item-spec-${i}`" placeholder="R下地 / 2重貼 等" /></td>
                  <!-- ★W/D/H は記録のみ。数量は自動計算しない（工種で数え方が違い、自動で決めると必ず外れる） -->
                  <td class="num"><input v-model.number="rows[i].dim_w" type="number" step="any" class="input xs num" :data-testid="`item-w-${i}`" /></td>
                  <td class="num"><input v-model.number="rows[i].dim_d" type="number" step="any" class="input xs num" :data-testid="`item-d-${i}`" /></td>
                  <td class="num"><input v-model.number="rows[i].dim_h" type="number" step="any" class="input xs num" :data-testid="`item-h-${i}`" /></td>
                  <td class="num"><input v-model.number="rows[i].quantity" type="number" step="any" class="input sm num" :data-testid="`item-qty-${i}`" /></td>
                  <td><input v-model="rows[i].unit" class="input sm" :data-testid="`item-unit-${i}`" placeholder="m²/個 等" /></td>
                  <!-- 客先単価: 既定は原価÷(1−粗利率)。手打ちで上書きでき、上書き中は色で分かる -->
                  <td class="num">
                    <input v-model.number="rows[i].unit_price" type="number" step="any" class="input sm num"
                           :class="{ 'overridden': isPriceOverridden(rows[i]) }"
                           :title="isPriceOverridden(rows[i]) ? `自動値 ${yen(autoPrice(rows[i]))} を手動で上書き中` : '原価と粗利率から自動計算'"
                           :data-testid="`item-price-${i}`" @input="rows[i]._priceTouched = true" />
                    <button v-if="isPriceOverridden(rows[i])" class="btn-revert" :data-testid="`item-price-revert-${i}`"
                            title="自動値に戻す" @click="revertPrice(rows[i])">↺</button>
                  </td>
                  <td class="num amount" :data-testid="`item-amount-${i}`">{{ yen(lineAmount(rows[i])) }}</td>
                  <!-- ここから社内用（見積書には出さない）。商社は R16 でモーダル化予定 -->
                  <!-- ★R14: 商社は材料（品番あり）だけ。作業内容の行に商社の概念は無い -->
                  <td class="cost-col">
                    <span v-if="!hasSupplierChoice(rows[i])" class="na-cell" :data-testid="`item-supplier-na-${i}`">—</span>
                    <select v-else v-model="rows[i].supplier_id" class="input sm" :data-testid="`item-supplier-${i}`" @change="onSupplierPick(rows[i])">
                      <option :value="null">—</option>
                      <option v-for="p in pricesForMaterial(rows[i].material_id)" :key="p.supplier_id" :value="p.supplier_id">{{ p.supplierName }} ¥{{ p.unit_price.toLocaleString('ja-JP') }}</option>
                    </select>
                  </td>
                  <td class="num cost-col"><input v-model.number="rows[i].cost_unit_price" type="number" step="any" class="input sm num" :data-testid="`item-cost-${i}`" @input="onCostInput(rows[i])" /></td>
                  <td class="num cost-col amount" :data-testid="`item-cost-amount-${i}`">{{ yen(lineCostAmount(rows[i])) }}</td>
                  <td><button class="btn-del" :data-testid="`item-del-${i}`" @click="removeRow(i)">×</button></td>
                </tr>
                <!-- ★R6: 商品情報（サイズ展開・仕様・画像・出典）。
                     今は毎回この品名でGoogle/ChatGPTを叩いているので、その手間を画面に持ってくる。 -->
                <tr v-if="isMaterialRow(rows[i]) && productInfoOf(rows[i])" class="pinfo-row" :data-testid="`item-pinfo-${i}`">
                  <td></td>
                  <td colspan="14">
                    <div class="pinfo">
                      <img v-if="productInfoOf(rows[i])!.image_url" :src="productInfoOf(rows[i])!.image_url!"
                           class="pinfo-img" :data-testid="`item-pinfo-img-${i}`" alt="" @error="onPinfoImgError(rows[i])" />
                      <div class="pinfo-body">
                        <template v-if="productInfoOf(rows[i])!.not_found">
                          <!-- 黙って空欄にしない。「調べたが見つからなかった」と分かるようにする -->
                          <span class="pinfo-none" :data-testid="`item-pinfo-none-${i}`">商品情報は見つかりませんでした</span>
                        </template>
                        <template v-else>
                          <span v-if="productInfoOf(rows[i])!.maker" class="pinfo-maker">{{ productInfoOf(rows[i])!.maker }}</span>
                          <span v-if="productInfoOf(rows[i])!.sizes" class="pinfo-line" :data-testid="`item-pinfo-sizes-${i}`">サイズ: {{ productInfoOf(rows[i])!.sizes }}</span>
                          <span v-if="productInfoOf(rows[i])!.spec" class="pinfo-line">仕様: {{ productInfoOf(rows[i])!.spec }}</span>
                          <span class="pinfo-links">
                            <a v-for="(u, ui) in (productInfoOf(rows[i])!.source_urls ?? []).slice(0, 3)" :key="ui"
                               :href="u" target="_blank" rel="noopener" class="pinfo-link" :data-testid="`item-pinfo-src-${i}-${ui}`">出典{{ ui + 1 }}</a>
                          </span>
                        </template>
                        <span class="pinfo-note">AIがWeb検索した内容です。発注前に必ず現物・カタログで確認してください。</span>
                      </div>
                      <button class="btn-link-sm" :data-testid="`item-pinfo-refresh-${i}`" @click="lookupProductInfo(rows[i], true)">調べ直す</button>
                    </div>
                  </td>
                </tr>
                <tr v-else-if="pinfoBusyKey === productKeyOf(rows[i]) && productKeyOf(rows[i])" class="pinfo-row">
                  <td></td><td colspan="14"><span class="hint" :data-testid="`item-pinfo-busy-${i}`">商品情報を調べています…</span></td>
                </tr>
                <!-- Q4: この項目の過去の業者別単価（受領登録で貯まったもの）。クリックで原価に採用 -->
                <tr v-if="historyFor(rows[i].item_name).length" class="hist-row">
                  <td></td>
                  <td colspan="14">
                    <div class="hist-cells">
                      <span class="hist-label">{{ isMaterialRow(rows[i]) ? '過去の単価' : '過去の下請実績' }}</span>
                      <span v-for="(h, hi) in historyFor(rows[i].item_name).slice(0, 4)" :key="hi" class="hist-wrap">
                      <button class="hist-cell"
                              :data-testid="`item-hist-${i}-${hi}`"
                              :title="`${h.subcontractor_name}／${kindLabel(h.price_kind)}${h.project_name ? '／' + h.project_name : ''}`"
                              @click="applyHistoryPrice(rows[i], h)">
                        <span class="hc-top">{{ h.subcontractor_name }} {{ yen(h.unit_price) }}</span>
                        <span class="hc-sub">{{ kindLabel(h.price_kind) }}<template v-if="h.quoted_on"> ・{{ h.quoted_on }}</template><template v-if="h.project_name"> ・{{ h.project_name }}</template></span>
                        <!-- 表記ゆれで拾った候補は、何にマッチしたのかを見せる（違うものを掴まないように） -->
                        <span v-if="historyAltName(rows[i], h)" class="hc-alt" :data-testid="`item-hist-alt-${i}-${hi}`">≈ {{ historyAltName(rows[i], h) }}</span>
                      </button>
                      <!-- R5: その単価の根拠になった見積書を開く（単価だけでは妥当性を確認できない） -->
                      <button v-if="hasQuoteFile(h.request_id)" class="hist-src" :data-testid="`item-hist-src-${i}-${hi}`"
                              title="この単価の元になった見積書を開く" @click="openHistoryFile(h.request_id)">
                        <span class="material-symbols-rounded" style="font-size:14px;vertical-align:middle">description</span>
                      </button>
                      </span>
                    </div>
                  </td>
                </tr>
                </template>
              </template>
              </template>
              <tr class="blk-add-row">
                <td colspan="15"><button class="btn-add" data-testid="area-add" @click="addArea()">＋ 場所を追加</button></td>
              </tr>
            </tbody>
          </table>
          </div>
          <datalist id="est-trades"><option v-for="t in tradeNameOptions" :key="t" :value="t" /></datalist>
          <datalist id="est-locations"><option v-for="l in locationOptions" :key="l" :value="l" /></datalist>
          <!-- 原価サマリ（社内用。Excelの「項目」シート下部の 請負/原価/差引/利率 と同じ）
               ★帳票(PDF)には出さない。原価は元請けに見せる情報ではない -->
          <div class="cost-summary" data-testid="cost-summary">
            <span class="cs-item"><span class="cs-l">請負金額</span><span class="cs-v" data-testid="cs-revenue">{{ yen(subtotal) }}</span></span>
            <span class="cs-item"><span class="cs-l">原価</span><span class="cs-v" data-testid="cs-cost">{{ yen(costTotal) }}</span></span>
            <span class="cs-item"><span class="cs-l">差引金額</span><span class="cs-v" data-testid="cs-profit">{{ yen(profitTotal) }}</span></span>
            <span class="cs-item"><span class="cs-l">利率</span><span class="cs-v" data-testid="cs-rate">{{ profitRatePct }}%</span></span>
            <span class="cs-note">※社内用。見積書には出ません</span>
          </div>
          <div class="actions-row">
            <button class="btn-primary" :disabled="saving" data-testid="save-items" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
            <span v-if="saveError" class="err">{{ saveError }}</span>
            <span v-if="savedMsg" class="ok">{{ savedMsg }}</span>
          </div>
        </section>

        <!-- 工種別 自動集計（転記操作なし） -->
        <section class="panel">
          <div class="panel-head"><h2>工種別 内訳（自動）</h2></div>
          <table class="table">
            <thead><tr><th>工種</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="g in byTrade" :key="g.tradeId ?? 'none'">
                <td :data-testid="`trade-name-${g.key}`">{{ g.tradeName }}</td>
                <td class="num" :data-testid="`trade-total-${g.key}`">{{ yen(g.total) }}</td>
              </tr>
              <tr v-if="byTrade.length === 0"><td colspan="2" class="empty">明細なし</td></tr>
            </tbody>
            <tfoot>
              <tr class="grand"><td>合計</td><td class="num" data-testid="grand-total">{{ yen(grandTotal) }}</td></tr>
            </tfoot>
          </table>
        </section>
      </div>

      </div><!-- /tab 明細入力 -->

      <div v-show="builderTab === 'preview'">
      <p v-if="!rows.length" class="hint">明細を入力すると見積書プレビューが表示されます。</p>
      <!-- E2 帳票PDF: 見積書（表紙＋内訳書）。サンプル様式に準拠 -->
      <section class="panel pdf-panel" v-if="rows.length">
        <div class="panel-head">
          <h2>見積書PDF</h2>
          <div class="head-actions">
            <button class="btn-ghost" data-testid="open-send" @click="openSendDialog"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">mail</span> メール送信</button>
            <button class="btn-primary" :disabled="pdfBusy" data-testid="export-pdf" @click="exportPdf">{{ pdfBusy ? '生成中…' : 'PDF出力' }}</button>
          </div>
        </div>
        <p v-if="!company.company_name" class="muted">自社情報が未登録です。<RouterLink to="/company-profile">自社情報</RouterLink>で会社名・住所・印影等を登録すると見積書に反映されます。</p>
        <!-- 見積書に出す案件情報（入力を離れた時点で自動保存） -->
        <div class="doc-form">
          <div class="doc-field"><label>工事場所</label><input v-model="doc.construction_location" class="input" data-testid="doc-location" @change="saveDoc" /></div>
          <div class="doc-field"><label>予定工期</label><input v-model="doc.period_text" class="input" placeholder="例: 着工〜2026/3" @change="saveDoc" /></div>
          <div class="doc-field"><label>見積有効期限</label><input v-model="doc.valid_until" class="input" :placeholder="company.estimate_valid_until || '次回変更まで、もしくは3ヶ月'" @change="saveDoc" /></div>
          <div class="doc-field"><label>端数調整（±円）</label><input v-model.number="doc.adjustment" type="number" class="input num" data-testid="doc-adjustment" @change="saveDoc" /></div>
          <div class="doc-field wide"><label>MEMO</label><input v-model="doc.memo" class="input" @change="saveDoc" /></div>
          <span v-if="docSavedMsg" class="ok doc-saved">{{ docSavedMsg }}</span>
        </div>

        <!-- ページ送り（プレビュー直上・中央で分かりやすく） -->
        <div class="pager-row" data-testid="pdf-pager">
          <button class="pg-btn" :disabled="currentPage === 0" data-testid="pdf-prev" @click="prevPage">‹ 前へ</button>
          <span class="pg-ind" data-testid="pdf-page-ind">{{ currentPage + 1 }} / {{ totalPages }} ページ</span>
          <button class="pg-btn" :disabled="currentPage >= totalPages - 1" data-testid="pdf-next" @click="nextPage">次へ ›</button>
        </div>
        <div class="pdf-preview est-doc" ref="previewEl" data-testid="pdf-preview">
          <!-- ── 表紙（1ページ目: 全体の内容） ── -->
          <div class="est-cover" data-pdf-page v-show="exporting || currentPage === 0">
          <h1 class="est-title">御　見　積　書</h1>
          <div class="est-date">{{ todayWareki }}</div>
          <div class="est-client">{{ currentClient }}　様</div>
          <div class="est-head">
            <div class="est-amounts">
              <div class="welfare">法定福利費　{{ yen(welfare) }}</div>
              <div class="band"><span class="lbl">見積金額：</span><span class="big" data-testid="pdf-grandtotal">{{ yen(totalExclTax) }}</span><span class="rgt">消費税別</span></div>
              <div class="band sub"><span class="lbl">{{ yen(tax) }} <small>消費税{{ taxRate }}%</small></span><span class="big sm">{{ yen(totalInclTax) }}</span><span class="rgt">税込金額</span></div>
            </div>
            <div class="est-issuer">
              <div class="cname">{{ company.company_name || '（自社情報未登録）' }}</div>
              <div v-if="company.company_rep">{{ company.company_rep }}</div>
              <div v-if="company.company_address">住所： {{ company.company_address }}</div>
              <div v-if="company.company_tel">ＴＥＬ： {{ company.company_tel }}</div>
              <div v-if="company.company_fax">ＦＡＸ： {{ company.company_fax }}</div>
            </div>
            <table class="est-seal">
              <tr><th>会社</th><th>責任者</th><th>担当</th></tr>
              <tr><td><img v-if="sealUrl" :src="sealUrl" alt="印" /></td><td></td><td></td></tr>
            </table>
          </div>
          <div class="est-applied">上記の通り御見積申し上げます</div>
          <div class="est-cols">
            <div class="est-l">
              <div class="kv"><span>工事件名</span><b>{{ currentProjectName }}</b></div>
              <div class="kv"><span>工事場所</span><b>{{ doc.construction_location }}</b></div>
              <div class="kv"><span>予定工期</span><b>{{ doc.period_text }}</b></div>
              <div class="kv"><span>見積有効期限</span><b>{{ docValidUntil }}</b></div>
              <div class="sepn"><b>◆別途工事◆</b><br>{{ company.estimate_separate_note || '※見積書に記載なき工事は別途' }}</div>
            </div>
            <div class="est-r">
              <div class="rh">MEMO</div><div class="rb">{{ doc.memo }}</div>
              <div class="rh">◆支払条件◆</div><div class="rb pre">{{ company.estimate_payment_terms }}</div>
            </div>
          </div>
          </div><!-- /est-cover -->
          <!-- ── 内訳書（2ページ目〜: 工種ごとの集計・行単位で改ページ） ── -->
          <div v-for="(pg, pi) in breakdownPages" :key="'bd' + pi" class="est-bd" data-pdf-page v-show="exporting || currentPage === 1 + pi">
            <div class="bd-head"><span>内訳書<span v-if="breakdownPages.length > 1">（{{ pi + 1 }}/{{ breakdownPages.length }}）</span></span><span class="bd-date">{{ todayWareki }}</span></div>
            <table class="bd-table">
              <thead><tr><th>名　称</th><th>形状・寸法</th><th class="num">数量</th><th>単位</th><th class="num">単価</th><th class="num">金　額</th></tr></thead>
              <tbody>
                <tr v-for="g in pg" :key="g.key"><td>{{ g.tradeName }}</td><td></td><td></td><td></td><td></td><td class="num">{{ yen(g.total) }}</td></tr>
              </tbody>
              <tfoot v-if="pi === breakdownPages.length - 1">
                <tr><td colspan="5" class="r">小計</td><td class="num">{{ yen(subtotal) }}</td></tr>
                <tr><td>法定福利費</td><td>請負金額 × {{ welfareA }}％ × {{ welfareB }}％</td><td colspan="3"></td><td class="num">{{ yen(welfare) }}</td></tr>
                <tr v-if="adjustment"><td>端数調整</td><td colspan="4"></td><td class="num" :class="{ neg: adjustment < 0 }">{{ yen(adjustment) }}</td></tr>
                <tr class="bd-grand"><td colspan="5" class="r">合計</td><td class="num">{{ yen(totalExclTax) }}</td></tr>
              </tfoot>
            </table>
          </div>
          <!-- ── 工種別 明細（3ページ目以降: 各工種ごと・行単位で改ページ） ── -->
          <div v-for="(pg, pi) in detailPages" :key="'d' + pi" class="est-detail" data-pdf-page v-show="exporting || currentPage === detailBase + pi">
            <div class="dh">{{ pg.tradeName }}<span v-if="pg.parts > 1">（{{ pg.part }}/{{ pg.parts }}）</span>　<span class="dsub">小計 {{ yen(pg.total) }}</span></div>
            <table class="bd-table">
              <thead><tr><th>場所</th><th>明細</th><th class="num">数量</th><th>単位</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in pg.items" :key="idx">
                  <td>{{ it.location }}</td><td>{{ it.item_name }}</td><td class="num">{{ it.quantity }}</td><td>{{ it.unit }}</td>
                  <td class="num">{{ yen(it.unit_price) }}</td><td class="num">{{ yen(lineAmount(it)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ③ 見積書PDFを元請けの担当者宛にメール送信＋履歴 -->
        <div class="send-block">
          <span v-if="sendMsg" class="ok" data-testid="send-msg">{{ sendMsg }}</span>
          <span v-if="sendErr && !sendDialogOpen" class="err" data-testid="send-err">{{ sendErr }}</span>
          <div v-if="sends.length" class="send-history">
            <div class="sub-h">送信履歴</div>
            <table class="table">
              <thead><tr><th>日時</th><th>宛先</th><th>件名</th></tr></thead>
              <tbody>
                <tr v-for="s in sends" :key="s.id" :data-testid="`send-row-${s.id}`">
                  <td>{{ s.sent_at ? new Date(s.sent_at).toLocaleString('ja-JP') : `（記録のみ ${new Date(s.created_at).toLocaleString('ja-JP')}）` }}</td>
                  <td>{{ s.email_to || '—' }}</td>
                  <td>{{ s.subject || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- メール送信ダイアログ（件名・本文・複数宛先） -->
        <div v-if="sendDialogOpen" class="modal-overlay" @click.self="sendDialogOpen = false">
          <div class="send-modal">
            <h3>見積書をメール送信</h3>
            <p v-if="!currentContractorId" class="err">案件に元請けが未設定です。先に「元請け」を選んでください。</p>
            <template v-else>
              <div class="field">
                <label>宛先（{{ currentContractorName }} の担当者・複数選択可）</label>
                <p v-if="!sendContacts.length" class="muted">担当者が未登録です（<RouterLink to="/contractors">元請け業者マスタ</RouterLink>で登録）。</p>
                <label v-for="c in sendContacts" :key="c.id" class="recipient" :class="{ off: !c.email }">
                  <input type="checkbox" :value="c.id" v-model="sendContactIds" :disabled="!c.email" :data-testid="`send-to-${c.id}`" />
                  {{ c.name || '(担当者)' }} <span class="muted">{{ c.email || '（メール未登録）' }}</span>
                </label>
              </div>
              <div class="field"><label>件名</label><input v-model="sendSubject" class="input" data-testid="send-subject" /></div>
              <div class="field"><label>本文</label><textarea v-model="sendBody" class="input" rows="6" data-testid="send-body"></textarea></div>
            </template>
            <div class="modal-actions">
              <button class="btn-primary" :disabled="!canSend || sending" data-testid="send-estimate" @click="sendPdf">{{ sending ? '送信中…' : '送信する' }}</button>
              <button class="btn-cancel" @click="sendDialogOpen = false">キャンセル</button>
            </div>
            <span v-if="sendErr" class="err">{{ sendErr }}</span>
          </div>
        </div>
      </section>

      </div><!-- /tab 見積書プレビュー -->

      <div v-show="builderTab === 'po' && isOrdered">
      <p v-if="!bySupplier.length" class="hint">明細に「商社」を設定すると、商社ごとに発注書を作成・送信できます。</p>
      <!-- F2 商社へ発注（見積明細を商社ごとに分割→各商社の担当者へ発注書を送信） -->
      <section class="panel po-split" v-if="bySupplier.length">
        <div class="panel-head"><h2>商社へ発注（商社ごとに分割）</h2></div>
        <p class="muted">明細を商社ごとにまとめ、各商社の担当者へ発注書（PDF）をメール送信します。<span v-if="rowsWithoutSupplier">（商社未設定の明細 {{ rowsWithoutSupplier }} 件は対象外）</span></p>
        <p v-if="poMsg" class="ok" data-testid="po-msg">{{ poMsg }}</p>
        <p v-if="poErr" class="err" data-testid="po-err">{{ poErr }}</p>
        <div class="po-cards">
          <div v-for="g in bySupplier" :key="g.supplierId" class="po-card" :data-testid="`po-card-${g.supplierId}`">
            <div class="po-card-head">
              <span class="po-sup">{{ g.supplierName }}</span>
              <span class="po-tot">{{ g.items.length }}明細 ／ {{ yen(g.total) }}</span>
            </div>
            <select class="input sm" :value="poContactId(g.supplierId) || ''" :data-testid="`po-contact-${g.supplierId}`"
                    @change="poContactSel[g.supplierId] = ($event.target as HTMLSelectElement).value || null">
              <option value="">担当者を選択…</option>
              <option v-for="c in contactsFor(g.supplierId)" :key="c.id" :value="c.id">{{ c.name || '(担当者)' }}{{ c.email ? `（${c.email}）` : '（メール未登録）' }}</option>
            </select>
            <div class="po-status" v-if="poFor(g.supplierId)">
              <span v-if="poFor(g.supplierId)?.email_sent_at" class="badge-ok" :data-testid="`po-sent-${g.supplierId}`">送信済み {{ poFor(g.supplierId)?.order_number }}・{{ fmtDateTime(poFor(g.supplierId)?.email_sent_at) }}</span>
              <span v-else class="muted">発行済み {{ poFor(g.supplierId)?.order_number }}（未送信）</span>
              <a v-if="poFor(g.supplierId)?.pdf_path" href="#" @click.prevent="openDoc(poFor(g.supplierId)!.pdf_path, poFor(g.supplierId)!.pdf_bucket)" class="pdf-link" :data-testid="`po-pdf-${g.supplierId}`"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">description</span> PDFを表示/DL</a>
            </div>
            <div class="po-card-foot">
              <span v-if="!contactsFor(g.supplierId).length" class="muted">担当者未登録（<RouterLink to="/subcontractors">協力業者マスタ</RouterLink>）</span>
              <button class="btn-primary sm" :disabled="!canSendPO(g) || poBusy === g.supplierId" :data-testid="`po-send-${g.supplierId}`" @click="sendPO(g)">
                {{ poBusy === g.supplierId ? '送信中…' : (poFor(g.supplierId)?.email_sent_at ? '再送' : '発注書を送信') }}
              </button>
            </div>
          </div>
        </div>
        <!-- 発注書PDF生成用（商社1社分・オフスクリーン） -->
        <div v-if="poTarget" ref="poPreviewEl" class="po-print">
          <h1 class="pdf-title">発 注 書</h1>
          <div class="pdf-meta">
            <div class="pdf-client">{{ poTarget.supplierName }} 御中</div>
            <div v-if="poTarget.contactName">ご担当：{{ poTarget.contactName }} 様</div>
            <div>案件：{{ currentProjectName }}</div>
            <div>発行日：{{ today }}</div>
          </div>
          <div class="pdf-total">御発注金額　{{ yen(poTarget.total) }}（税抜）</div>
          <table class="pdf-table">
            <thead><tr><th>品名</th><th class="num">数量</th><th>単位</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="(it, idx) in poTarget.items" :key="idx">
                <td>{{ it.item_name }}</td><td class="num">{{ it.quantity }}</td><td>{{ it.unit }}</td>
                <td class="num">{{ yen(it.unit_price) }}</td><td class="num">{{ yen(lineAmount(it)) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="pdf-grand">合計　{{ yen(poTarget.total) }}（税抜）</div>
        </div>
      </section>
      </div><!-- /tab 商社へ発注 -->

      <!-- #4 マスタ・自社情報を編集する右ドロワー（閉じると明細の選択肢・見積書に即反映） -->
      <div v-if="drawerOpen" class="drawer-overlay" @click.self="closeDrawer">
        <div class="drawer">
          <div class="drawer-head">
            <div class="drawer-subtabs">
              <button class="dtab" :class="{ active: drawerTab === 'masters' }" data-testid="drawer-masters" @click="drawerTab = 'masters'">マスタ・単価表</button>
              <button class="dtab" :class="{ active: drawerTab === 'company' }" data-testid="drawer-company" @click="drawerTab = 'company'">自社情報</button>
            </div>
            <button class="drawer-close" data-testid="drawer-close" @click="closeDrawer">閉じる ✕</button>
          </div>
          <div class="drawer-body">
            <EstimateMasters v-if="drawerTab === 'masters'" embedded />
            <CompanyProfile v-else embedded />
          </div>
        </div>
      </div>
    </template>
    <!-- 新規作成（一覧の＋新規見積、または案件未選択で開いた時） -->
    <div v-else class="new-estimate">
      <h2>新規見積を作成</h2>
      <p class="muted">案件名を入力して作成、または<RouterLink to="/estimate-list">見積一覧</RouterLink>から選んでください。</p>
      <div class="new-row">
        <input v-model="newProjectName" class="input" placeholder="案件名（例: 〇〇ビル改修）" data-testid="new-project-name" @keyup.enter="addProject" />
        <button class="btn-primary" :disabled="!newProjectName.trim()" data-testid="add-project" @click="addProject">作成</button>
      </div>
      <span v-if="projectErr" class="err" data-testid="project-err">{{ projectErr }}</span>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { openDoc } from '../lib/docUrl'
import EstimateMasters from './estimate-masters.vue'
import CompanyProfile from './company-profile.vue'

const BUCKET = 'expense-receipts'        // 印影など既存公開物の表示用（後方互換）
const PDF_BUCKET = 'admin-docs'          // 新規の見積/発注PDFは非公開バケット（署名URL配信）
const IS_DEV = import.meta.env.DEV
const route  = useRoute()   // 一覧から ?project=<id> で開いた案件を初期選択する
// #6 ビルダーのタブ（明細入力／見積書プレビュー／商社へ発注）
const builderTab = ref<'intake' | 'quotes' | 'items' | 'preview' | 'po'>('items')

// ── Q3: 相見積（依頼→受領→比較・選定）────────────────────────
// ★設計の肝: 単価履歴を「別途入力する台帳」にしない。受領登録の副作用で貯める。
//   顧客Excelの相見積シートが120項目中1項目しか埋まらなかった原因が
//   「明細入力とは別に台帳へ手入力する設計」だったため（確認15の回答）。
const PRICE_KINDS = [
  { key: 'material_labor', label: '材工共' },
  { key: 'labor',          label: '労務のみ' },
  { key: 'material',       label: '材料のみ' },
] as const
const kindLabel = (k: string) => PRICE_KINDS.find(x => x.key === k)?.label ?? k

type QuoteRequest = {
  id: string; subcontractor_id: string | null; trade_name: string
  requested_at: string; due_date: string; received_at: string
  drawing_send_id: string | null   // R7: どの図面送信から生まれた依頼か
}
type QuoteLine = {
  id: string | null; _k: number; request_id: string; item_name: string; spec: string
  unit: string; price_kind: string; quantity: number | null; unit_price: number; is_selected: boolean
}
const quoteRequests = ref<QuoteRequest[]>([])
const quoteLines    = ref<QuoteLine[]>([])
const openedRequest = ref<QuoteRequest | null>(null)
const openedLines   = ref<QuoteLine[]>([])
const removedLineIds = ref<string[]>([])
const qlSaving = ref(false); const qlMsg = ref(''); const qlErr = ref('')
const applyMsg = ref('')
let qlKey = 0

// 下請業者（商社は発注側なので除く）
const subcontractorOptions = ref<{ id: string; name: string }[]>([])
const subName = (id: string | null) => subcontractorOptions.value.find(s => s.id === id)?.name ?? '(業者未選択)'
const linesOf = (requestId: string) => quoteLines.value.filter(l => l.request_id === requestId)

/** 依頼の状況（未回収/期限超過/受領済み） */
function qrState(q: QuoteRequest): { text: string; cls: string } {
  if (q.received_at) return { text: '受領済み', cls: 'ok' }
  if (q.due_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const due = new Date(`${q.due_date}T00:00:00`)
    const days = Math.round((due.getTime() - today.getTime()) / 86400000)
    if (days < 0)  return { text: `未回収（${-days}日超過）`, cls: 'over' }
    if (days <= 2) return { text: `未回収（あと${days}日）`, cls: 'soon' }
  }
  return { text: '未回収', cls: 'wait' }
}

async function loadQuotes() {
  if (!projectId.value) { quoteRequests.value = []; quoteLines.value = []; return }
  const { data: qr } = await supabase.from('estimate_quote_requests')
    .select('id, subcontractor_id, trade_name, requested_at, due_date, received_at, drawing_send_id')
    .eq('project_id', projectId.value).order('created_at')
  quoteRequests.value = (qr ?? []).map((r: any) => ({
    id: r.id, subcontractor_id: r.subcontractor_id, trade_name: r.trade_name ?? '',
    requested_at: r.requested_at ?? '', due_date: r.due_date ?? '', received_at: r.received_at ?? '',
    drawing_send_id: r.drawing_send_id ?? null,
  }))
  const ids = quoteRequests.value.map(r => r.id)
  if (!ids.length) { quoteLines.value = []; return }
  const { data: ql } = await supabase.from('estimate_quote_lines')
    .select('id, request_id, item_name, spec, unit, price_kind, quantity, unit_price, is_selected')
    .in('request_id', ids).order('created_at')
  quoteLines.value = (ql ?? []).map((l: any) => ({
    id: l.id, _k: ++qlKey, request_id: l.request_id, item_name: l.item_name, spec: l.spec ?? '',
    unit: l.unit ?? '', price_kind: l.price_kind ?? 'material_labor',
    quantity: l.quantity == null ? null : Number(l.quantity),
    unit_price: Number(l.unit_price) || 0, is_selected: !!l.is_selected,
  }))
  await loadQuoteFiles()
}
// ════════════════════════════════════════════════════════════
//  R5: 受領した見積書ファイル（PDF等）を残す
//  単価だけ持っていても「なぜこの金額か」を後から確認できない。
//  受領登録に添付を足し、単価履歴の候補からその根拠を開けるようにする。
// ════════════════════════════════════════════════════════════
type QuoteFile = { id: string; request_id: string; path: string; name: string | null }
const quoteFiles = ref<QuoteFile[]>([])
const qfDragOver = ref(false)
const qfBusy = ref(false)
const qfErr  = ref('')
const openedFiles = computed(() =>
  quoteFiles.value.filter(f => f.request_id === openedRequest.value?.id))
// ★単価履歴は案件を跨いで貯まるので、根拠ファイルの判定も案件を跨いで持つ必要がある。
//   現在の案件のぶんだけ見ていると、別案件で貯めた単価に根拠アイコンが出ない（E2Eで検出）。
const historyFiles = ref<QuoteFile[]>([])
/** その単価の根拠ファイルがあるか（無いならアイコンを出さない＝あると誤解させない） */
const hasQuoteFile = (requestId: string | null | undefined) =>
  !!requestId && (quoteFiles.value.some(f => f.request_id === requestId)
               || historyFiles.value.some(f => f.request_id === requestId))

async function loadQuoteFiles() {
  const ids = quoteRequests.value.map(q => q.id)
  if (!ids.length) { quoteFiles.value = []; return }
  const { data } = await supabase.from('estimate_quote_files')
    .select('id, request_id, path, name').in('request_id', ids).order('created_at')
  quoteFiles.value = (data ?? []) as QuoteFile[]
}
function onQuoteFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  return uploadQuoteFiles(files)
}
function onQuoteFileDrop(e: DragEvent) {
  qfDragOver.value = false
  return uploadQuoteFiles(Array.from(e.dataTransfer?.files ?? []))
}
async function uploadQuoteFiles(files: File[]) {
  const req = openedRequest.value
  if (!files.length || !req) return
  qfBusy.value = true; qfErr.value = ''
  try {
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\-]/g, '_')
      // 図面と同じバケットを使う（account_id 先頭のパス規約＝storageポリシーがそのまま効く）
      const path = `${accountId}/quotes/${req.id}/${Date.now()}_${safe}`
      const { error: upErr } = await supabase.storage.from(DRAWING_BUCKET).upload(path, f)
      if (upErr) throw upErr
      const { error: insErr } = await supabase.from('estimate_quote_files')
        .insert({ account_id: accountId, request_id: req.id, path, name: f.name })
      if (insErr) throw insErr
    }
    await loadQuoteFiles()
  } catch (err: any) {
    qfErr.value = err?.message ?? 'アップロードに失敗しました'
  } finally { qfBusy.value = false }
}
async function openQuoteFile(f: QuoteFile) {
  const { data } = await supabase.storage.from(DRAWING_BUCKET).createSignedUrl(f.path, 60 * 10)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}
async function removeQuoteFile(f: QuoteFile) {
  if (!confirm(`「${f.name || f.path}」を削除しますか？`)) return
  await supabase.storage.from(DRAWING_BUCKET).remove([f.path]).catch(() => {})
  await supabase.from('estimate_quote_files').delete().eq('id', f.id)
  await loadQuoteFiles()
}
/** 明細の「過去の単価」から、その単価の根拠になった見積書を開く */
async function openHistoryFile(requestId: string | null | undefined) {
  const f = quoteFiles.value.find(x => x.request_id === requestId)
       ?? historyFiles.value.find(x => x.request_id === requestId)
  if (f) await openQuoteFile(f)
}

/** R7: その依頼に対して実際に渡した図面ページ（例: 「E2E図面.pdf P.13-19」） */
function sentPagesLabel(q: QuoteRequest): string {
  const h = drawingSends.value.find(d => d.id === q.drawing_send_id)
  if (!h) return '—'
  const range = pageRangeLabel(h.pages ?? [])
  return `${h.source_name ? h.source_name + ' ' : ''}P.${range}`
}

async function loadSubcontractorOptions() {
  const { data } = await supabase.from('subcontractors')
    .select('id, name').eq('account_id', accountId).eq('category', '業者')
    .eq('is_deleted', false).order('name')
  subcontractorOptions.value = (data ?? []) as any
}

/** ローカル日付のYYYY-MM-DD（toISOString はUTCになって日付がズレる） */
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** 手追加（システムを通さずメールで見積が来た業者を登録するための逃げ道） */
async function addQuoteRequest() {
  if (!projectId.value) return
  const { data } = await supabase.from('estimate_quote_requests')
    .insert({ account_id: accountId, project_id: projectId.value, requested_at: todayIso() }).select('id').single()
  if (data?.id) await loadQuotes()
}
async function saveQuoteRequest(q: QuoteRequest) {
  await supabase.from('estimate_quote_requests').update({
    subcontractor_id: q.subcontractor_id, trade_name: q.trade_name || null,
    requested_at: q.requested_at || null, due_date: q.due_date || null, received_at: q.received_at || null,
    updated_at: new Date().toISOString(),
  }).eq('id', q.id)
}
async function removeQuoteRequest(q: QuoteRequest) {
  if (!confirm(`${subName(q.subcontractor_id)} への依頼を削除しますか？（受領した単価も消えます）`)) return
  await supabase.from('estimate_quote_requests').delete().eq('id', q.id)
  if (openedRequest.value?.id === q.id) openedRequest.value = null
  await loadQuotes()
}

function openQuoteLines(q: QuoteRequest) {
  openedRequest.value = q
  removedLineIds.value = []
  openedLines.value = linesOf(q.id).map(l => ({ ...l }))
  if (!openedLines.value.length) addQuoteLine()
}
function addQuoteLine() {
  if (!openedRequest.value) return
  openedLines.value.push({ id: null, _k: ++qlKey, request_id: openedRequest.value.id,
    item_name: '', spec: '', unit: '', price_kind: 'material_labor', quantity: null, unit_price: 0, is_selected: false })
}
function removeQuoteLine(i: number) {
  const l = openedLines.value[i]
  if (l.id) removedLineIds.value.push(l.id)
  openedLines.value.splice(i, 1)
}
async function saveQuoteLines() {
  if (!openedRequest.value) return
  qlSaving.value = true; qlErr.value = ''; qlMsg.value = ''
  try {
    for (const id of removedLineIds.value) await supabase.from('estimate_quote_lines').delete().eq('id', id)
    removedLineIds.value = []
    for (const l of openedLines.value) {
      if (!l.item_name.trim()) continue
      const payload = {
        account_id: accountId, request_id: l.request_id, item_name: l.item_name.trim(),
        spec: l.spec || null, unit: l.unit || null, price_kind: l.price_kind,
        quantity: l.quantity ?? null, unit_price: Number(l.unit_price) || 0, is_selected: l.is_selected,
      }
      if (l.id) await supabase.from('estimate_quote_lines').update(payload).eq('id', l.id)
      else {
        const { data } = await supabase.from('estimate_quote_lines').insert(payload).select('id').single()
        if (data?.id) l.id = data.id
      }
    }
    // 受領日が未入力なら、明細を入れた時点で受領済みとみなす（入力の手間を減らす）
    if (!openedRequest.value.received_at && openedLines.value.some(l => l.item_name.trim())) {
      openedRequest.value.received_at = todayIso()
      await saveQuoteRequest(openedRequest.value)
    }
    await loadQuotes()
    qlMsg.value = '保存しました（単価履歴に記録）'
    setTimeout(() => (qlMsg.value = ''), 2500)
  } catch (e: any) {
    qlErr.value = e?.message ?? '保存に失敗しました'
  } finally { qlSaving.value = false }
}

/** 同じ項目名で業者を横並びにした比較データ */
const comparison = computed(() => {
  const m = new Map<string, { itemName: string; offers: any[]; min: number; mixedKind: boolean; mixedQty: boolean; qtyList: string }>()
  for (const l of quoteLines.value) {
    if (!l.item_name) continue
    const req = quoteRequests.value.find(r => r.id === l.request_id)
    const cur = m.get(l.item_name) ?? { itemName: l.item_name, offers: [] as any[], min: Infinity, mixedKind: false, mixedQty: false, qtyList: '' }
    cur.offers.push({ ...l, subName: subName(req?.subcontractor_id ?? null) })
    m.set(l.item_name, cur)
  }
  for (const c of m.values()) {
    c.min = Math.min(...c.offers.map(o => o.unit_price || Infinity))
    // ★単価の区分が混ざっていたら警告（材工共 vs 労務のみ を並べて比べると誤選定する）
    c.mixedKind = new Set(c.offers.map(o => o.price_kind)).size > 1
    // ★数量の認識が業者間で違う場合も警告（確認3=C: 自社でも拾い下請の数量とも突き合わせる）
    const qs = [...new Set(c.offers.map(o => o.quantity).filter(q => q != null))]
    c.mixedQty = qs.length > 1
    c.qtyList = qs.join(' / ')
    c.offers.sort((a, b) => a.unit_price - b.unit_price)
  }
  return [...m.values()].sort((a, b) => a.itemName.localeCompare(b.itemName, 'ja'))
})

/** 業者を採用（同じ項目の他業者の採用は外す） */
async function selectOffer(c: any, o: any) {
  for (const other of c.offers) {
    const want = other.id === o.id
    if (other.is_selected === want) continue
    other.is_selected = want
    const line = quoteLines.value.find(l => l.id === other.id)
    if (line) line.is_selected = want
    if (other.id) await supabase.from('estimate_quote_lines').update({ is_selected: want }).eq('id', other.id)
  }
}

/** 選定した単価を見積明細の「原価」に反映する（比較 → 見積 の橋渡し） */
async function applySelectionToItems() {
  let applied = 0
  for (const c of comparison.value) {
    const sel = c.offers.find((o: any) => o.is_selected)
    if (!sel) continue
    let row = rows.value.find(r => isItemRow(r) && r.item_name === c.itemName)
    if (!row) {
      // 末尾に常時5行の空きがあるので、まずそこを埋める。
      // 後ろに足すと空行の下にポツンと現れて見つけにくい。
      row = rows.value.find(r => isItemRow(r) && isBlankRow(r))
      if (!row) { row = blankRow(); rows.value.push(row) }
      row.item_name = c.itemName
      row.spec = sel.spec ?? ''
      row.unit = sel.unit ?? ''
      row.quantity = Number(sel.quantity) || 0
    }
    row.cost_unit_price = Number(sel.unit_price) || 0
    if (!row.unit) row.unit = sel.unit ?? ''
    if (!row._priceTouched) row.unit_price = autoPrice(row)   // 客先単価は粗利率から生やす
    applied++
  }
  applyMsg.value = applied ? `${applied}件を明細に反映しました（保存を押すと確定）` : '採用された見積がありません'
  setTimeout(() => (applyMsg.value = ''), 4000)
  if (applied) builderTab.value = 'items'
}

// ── Q5: 元請けからの案件受領登録・ステータス管理 ──────────────
const DRAWING_BUCKET = 'estimate-drawings'
// 業務フローに沿った状態。確認16で合意（対応中/受注/失注/辞退）＋既存値との互換を保つ。
//  draft   … 受領して見積作成中（既存の初期値）
//  issued  … 元請けへ提出済み（見積書PDF発行時に自動でセットされる既存挙動）
//  active  … 受注（現場化で自動セットされる既存挙動）
//  lost    … 失注 / declined … 辞退（どちらも削除せず残す＝確認9）
const PROJECT_STATUSES = [
  { key: 'draft',    label: '対応中' },
  { key: 'issued',   label: '提出済み' },
  { key: 'active',   label: '受注' },
  { key: 'lost',     label: '失注' },
  { key: 'declined', label: '辞退' },
] as const
type Attachment = { id: string; path: string; name: string | null; kind: string | null }
const intake = ref<{ request_date: string; due_date: string; status: string; lost_reason: string }>(
  { request_date: '', due_date: '', status: 'draft', lost_reason: '' })
const intakeSavedMsg = ref('')
// 受注済みか。発注タブの表示条件（受注前の発注はありえない）
const isOrdered = computed(() => intake.value.status === 'active')
const attachments = ref<Attachment[]>([])
const attBusy = ref(false)
const attErr  = ref('')

const needsReason      = computed(() => intake.value.status === 'lost' || intake.value.status === 'declined')
const isArchivedStatus = computed(() => needsReason.value)
/** 提出期限までの残り日数バッジ（受注/失注/辞退の後は出さない） */
const dueBadge = computed(() => {
  const d = intake.value.due_date
  if (!d) return null
  if (['active', 'lost', 'declined'].includes(intake.value.status)) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(`${d}T00:00:00`)
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (days < 0)  return { text: `期限を${-days}日超過`, cls: 'over' }
  if (days === 0) return { text: '本日締切', cls: 'over' }
  if (days <= 3) return { text: `あと${days}日`, cls: 'soon' }
  return { text: `あと${days}日`, cls: 'ok' }
})

async function saveIntake() {
  if (!projectId.value) return
  await supabase.from('estimate_projects').update({
    request_date: intake.value.request_date || null,
    due_date:     intake.value.due_date || null,
    status:       intake.value.status || 'draft',
    // 失注/辞退でなくなったら理由は消す（状態と矛盾したデータを残さない）
    lost_reason:  needsReason.value ? (intake.value.lost_reason || null) : null,
  }).eq('id', projectId.value)
  const p = projects.value.find(x => x.id === projectId.value)
  if (p) p.status = intake.value.status
  intakeSavedMsg.value = '保存しました'
  setTimeout(() => (intakeSavedMsg.value = ''), 2000)
}

async function loadAttachments() {
  if (!projectId.value) { attachments.value = []; return }
  const { data } = await supabase.from('estimate_project_attachments')
    .select('id, path, name, kind').eq('project_id', projectId.value).order('created_at')
  attachments.value = (data ?? []) as Attachment[]
}
const attDragOver = ref(false)
function onIntakeFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  return uploadAttachments(files)
}
/** R9: ドラッグ&ドロップ。ファイル添付は指定が無くてもD&Dできるのを既定にする */
function onIntakeDrop(e: DragEvent) {
  attDragOver.value = false
  return uploadAttachments(Array.from(e.dataTransfer?.files ?? []))
}
async function uploadAttachments(files: File[]) {
  if (!files.length || !projectId.value) return
  attBusy.value = true; attErr.value = ''
  try {
    for (const f of files) {
      const safe = f.name.replace(/[^\w.\-]/g, '_')
      const path = `${accountId}/${projectId.value}/${Date.now()}_${safe}`
      const { error: upErr } = await supabase.storage.from(DRAWING_BUCKET).upload(path, f)
      if (upErr) throw upErr
      const { error: insErr } = await supabase.from('estimate_project_attachments')
        .insert({ account_id: accountId, project_id: projectId.value, path, name: f.name, kind: 'drawing' })
      if (insErr) throw insErr
    }
    await loadAttachments()
  await loadQuotes()
  } catch (err: any) {
    attErr.value = err?.message ?? 'アップロードに失敗しました'
  } finally { attBusy.value = false }
}
async function openAttachment(a: Attachment) {
  // 非公開バケットなので署名URLで開く
  const { data } = await supabase.storage.from(DRAWING_BUCKET).createSignedUrl(a.path, 60 * 10)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}
async function removeAttachment(a: Attachment) {
  if (!confirm(`「${a.name || a.path}」を削除しますか？`)) return
  await supabase.storage.from(DRAWING_BUCKET).remove([a.path]).catch(() => {})
  await supabase.from('estimate_project_attachments').delete().eq('id', a.id)
  await loadAttachments()
}
// ════════════════════════════════════════════════════════════
//  R8: 図面のページを選んで下請へ送る（Dropboxでやっていた作業の置き換え）
//
//  業務フロー（2026-07-28 レビュー）:
//   元請けから来た図面をDropboxに保存 → 図面は工種ごとにページが分かれている
//   → 塗装業者に投げるならそのページだけチェック → 共有 → メール
//  ★「誰にどのページを渡したか」は後で必ず問題になる（見積が食い違った時に
//    「その図面は渡していない」が起きる）ので、履歴に pages を必ず残す。
//
//  ページ抽出はブラウザ側(pdf-lib)で行い、抽出済みPDFをアップロードしてから
//  EFに送信させる。EF側でPDFを弄らないのは pdf-lib を Deno に持ち込まないため。
// ════════════════════════════════════════════════════════════
type DrawingSend = {
  id: string; subcontractor_id: string | null; pages: number[] | null
  source_name: string | null; email_to: string | null; sent_at: string | null
}
const drawingSends = ref<DrawingSend[]>([])
const dsend = ref<{
  att: Attachment | null; loading: boolean; sending: boolean
  bytes: Uint8Array | null; pageCount: number; selected: number[]
  rangeText: string; preview: number | null; previewUrl: string
  subId: string; contactIds: string[]; subject: string; body: string
  msg: string; err: string
}>({
  att: null, loading: false, sending: false, bytes: null, pageCount: 0, selected: [],
  rangeText: '', preview: null, previewUrl: '', subId: '', contactIds: '' as any,
  subject: '', body: '', msg: '', err: '',
})
dsend.value.contactIds = []

const isPdf = (a: Attachment) => /\.pdf$/i.test(a.name ?? '') || /\.pdf$/i.test(a.path ?? '')
const contactsOfSub = (subId: string) =>
  subContacts.value.filter(c => c.subcontractor_id === subId && c.email)
const canSendDrawing = computed(() =>
  !!dsend.value.selected.length && !!dsend.value.contactIds.length)

/** 1,2,3,5,6 → "1-3, 5-6"（人が読む用。件名・履歴に出す） */
function pageRangeLabel(pages: number[]): string {
  const a = [...new Set(pages)].filter(n => Number.isFinite(n) && n > 0).sort((x, y) => x - y)
  if (!a.length) return ''
  const out: string[] = []
  let start = a[0], prev = a[0]
  for (let i = 1; i <= a.length; i++) {
    const n = a[i]
    if (n === prev + 1) { prev = n; continue }
    out.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = n; prev = n
  }
  return out.join(', ')
}
const defaultDsendSubject = computed(() =>
  `【図面送付】${currentProjectName.value}（P.${pageRangeLabel(dsend.value.selected)}）`)

async function openDrawingSend(a: Attachment) {
  const d = dsend.value
  d.att = a; d.loading = true; d.err = ''; d.msg = ''
  d.selected = []; d.rangeText = ''; d.preview = null; d.previewUrl = ''
  d.contactIds = []; d.subject = ''; d.body = ''
  try {
    const { data, error } = await supabase.storage.from(DRAWING_BUCKET).download(a.path)
    if (error || !data) throw error ?? new Error('図面を取得できませんでした')
    d.bytes = new Uint8Array(await data.arrayBuffer())
    const { PDFDocument } = await import('pdf-lib')
    d.pageCount = (await PDFDocument.load(d.bytes)).getPageCount()
  } catch (e: any) {
    d.err = e?.message ?? '図面を読み込めませんでした'
    d.pageCount = 0
  } finally { d.loading = false }
}
function closeDrawingSend() {
  if (dsend.value.previewUrl) URL.revokeObjectURL(dsend.value.previewUrl)
  dsend.value.att = null; dsend.value.bytes = null; dsend.value.previewUrl = ''
}
function togglePage(p: number) {
  const sel = dsend.value.selected
  const i = sel.indexOf(p)
  if (i >= 0) sel.splice(i, 1); else sel.push(p)
  dsend.value.rangeText = pageRangeLabel(sel)
}
function selectAllPages(on: boolean) {
  dsend.value.selected = on ? Array.from({ length: dsend.value.pageCount }, (_, i) => i + 1) : []
  dsend.value.rangeText = pageRangeLabel(dsend.value.selected)
}
/** 「13-19, 22」のような指定でまとめて選ぶ。工種ごとに連番で分かれているので範囲指定が実務的 */
function applyPageRange() {
  const out = new Set<number>()
  for (const part of dsend.value.rangeText.split(/[,、\s]+/)) {
    const m = /^(\d+)\s*[-〜~]\s*(\d+)$/.exec(part.trim())
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y)
      for (let n = a; n <= b; n++) if (n >= 1 && n <= dsend.value.pageCount) out.add(n)
    } else if (/^\d+$/.test(part.trim())) {
      const n = Number(part.trim())
      if (n >= 1 && n <= dsend.value.pageCount) out.add(n)
    }
  }
  dsend.value.selected = [...out].sort((a, b) => a - b)
}
/** そのページだけのPDFを作ってプレビュー（中身を確かめてから選べるように） */
async function previewPage(p: number) {
  const d = dsend.value
  if (!d.bytes) return
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(d.bytes)
  const doc = await PDFDocument.create()
  const [pg] = await doc.copyPages(src, [p - 1])
  doc.addPage(pg)
  const blob = new Blob([await doc.save()], { type: 'application/pdf' })
  if (d.previewUrl) URL.revokeObjectURL(d.previewUrl)
  d.previewUrl = URL.createObjectURL(blob)
  d.preview = p
}

async function sendDrawing() {
  const d = dsend.value
  if (!canSendDrawing.value || !d.bytes || !projectId.value) return
  d.sending = true; d.err = ''; d.msg = ''
  try {
    // 選んだページだけを抜き出したPDFを作る（元の図面はそのまま残す）
    const { PDFDocument } = await import('pdf-lib')
    const src = await PDFDocument.load(d.bytes)
    const doc = await PDFDocument.create()
    const pages = [...d.selected].sort((a, b) => a - b)
    const copied = await doc.copyPages(src, pages.map(p => p - 1))
    for (const pg of copied) doc.addPage(pg)
    const out = await doc.save()

    const path = `${accountId}/${projectId.value}/sent/${Date.now()}_P${pageRangeLabel(pages).replace(/[,\s]+/g, '_')}.pdf`
    const { error: upErr } = await supabase.storage.from(DRAWING_BUCKET)
      .upload(path, new Blob([out], { type: 'application/pdf' }))
    if (upErr) throw upErr

    const { data: sess } = await supabase.auth.getSession()
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-drawing-pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess?.session?.access_token ?? ''}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        project_id: projectId.value,
        attachment_id: d.att?.id ?? null,
        subcontractor_id: d.subId || null,
        subcontractor_contact_ids: d.contactIds,
        pages,
        pdf_path: path,
        source_name: d.att?.name ?? null,
        subject: d.subject || null,
        body: d.body || null,
        project_name: currentProjectName.value,
      }),
    })
    const json = await resp.json()
    if (!resp.ok || json?.error) throw new Error(json?.error || `送信エラー(${resp.status})`)
    d.msg = json?.skipped === 'no_api_key'
      ? `${pages.length}ページを記録しました（メール未設定のため実送信はスキップ）`
      : `${pages.length}ページを送信しました`
    await loadDrawingSends()
    // ★R7: 図面を送った＝その業者に見積を依頼した、ということ。
    //   依頼行を人に手で作らせない（実業務の依頼は「図面を投げるだけ」）。
    if (d.subId) await ensureQuoteRequestFromSend(d.subId)
  } catch (e: any) {
    d.err = e?.message ?? '送信に失敗しました'
  } finally { d.sending = false }
}

/**
 * R7: 図面送信から見積依頼を立てる。
 * 同じ業者へ何度も図面を送ることがある（追加図面・差し替え）ので、
 * まだ受領していない依頼が既にあればそれを最新の送信に更新し、行を増やさない。
 */
async function ensureQuoteRequestFromSend(subId: string) {
  const latest = drawingSends.value.find(d => d.subcontractor_id === subId)
  if (!latest || !projectId.value) return
  const today = todayIso()
  const open = quoteRequests.value.find(q => q.subcontractor_id === subId && !q.received_at)
  if (open) {
    await supabase.from('estimate_quote_requests')
      .update({ drawing_send_id: latest.id, requested_at: open.requested_at || today })
      .eq('id', open.id)
  } else {
    await supabase.from('estimate_quote_requests').insert({
      account_id: accountId, project_id: projectId.value,
      subcontractor_id: subId, requested_at: today, drawing_send_id: latest.id,
    })
  }
  await loadQuotes()
}

async function loadDrawingSends() {
  if (!projectId.value) { drawingSends.value = []; return }
  const { data } = await supabase.from('estimate_drawing_sends')
    .select('id, subcontractor_id, pages, source_name, email_to, sent_at')
    .eq('project_id', projectId.value).order('created_at', { ascending: false })
  drawingSends.value = (data ?? []) as DrawingSend[]
}

// #4 マスタ・自社情報の右ドロワー（閉じると明細の選択肢・見積書計算に即反映）
const drawerOpen = ref(false)
const drawerTab  = ref<'masters' | 'company'>('masters')
function openDrawer() { drawerOpen.value = true }
async function closeDrawer() {
  drawerOpen.value = false
  await Promise.all([loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadContractors(), loadCompany()])
}

type Project  = { id: string; name: string; client_name: string | null; contractor_id: string | null; status: string; site_id: string | null }
type Site     = { id: string; name: string }
type Contractor = { id: string; name: string }
type Trade    = { id: string; name: string }
type Material = { id: string; name: string; unit: string | null; code: string | null; spec?: string | null }
type Supplier = { id: string; name: string }
type MatPrice = { id: string; material_id: string; supplier_id: string; unit_price: number; effective_date: string | null }
type Contact  = { id: string; contractor_id: string; name: string | null; email: string | null }
type EstimateSend = { id: string; email_to: string | null; subject: string | null; sent_at: string | null; created_at: string }
type Row = {
  id: string | null
  _k: number           // 並び替え用の安定キー（新規行はidが無いため）
  location: string
  trade_id: string | null
  material_id: string | null
  supplier_id: string | null
  item_name: string
  spec: string              // 形状・詳細（Excel C列）
  product_code: string      // 品番（R3: 形状・詳細とは別枠。メーカー特定・商品情報取得のキー）
  trade_name: string        // 工種の自由記述（固定マスタ trade_id とは別に持つ）
  row_type: 'item' | 'header'   // header = 分類見出し行（金額集計から除外）
  unit: string
  quantity: number
  cost_unit_price: number   // 単価原価（Excel P列・入力の主動線）
  unit_price: number        // 客先単価（Excel I列・既定は原価÷(1−粗利率)）
  _priceTouched?: boolean   // 客先単価を人が手打ちしたか（自動再計算を抑止）
  _newBlock?: boolean       // ここから新しい工種ブロック（未入力でも前と混ざらないため）
  _newArea?: boolean        // ここから新しい場所（同上）
  dim_w: number | null      // W/D/H は記録のみ。数量は自動計算しない（レビュー2026-07-29）
  dim_d: number | null
  dim_h: number | null
  _dym?: string[]           // 「もしかして」候補（入力時に1度だけ計算する。描画中に計算しない）
}

const projects       = ref<Project[]>([])
// 現場昇華（受注確定→現場を作成/紐付け）
const sites          = ref<Site[]>([])
const promoteOpen    = ref(false)
const promoteMode    = ref<'new' | 'existing'>('new')
const promoteName    = ref('')
const promoteSiteId  = ref<string | null>(null)
const promoteBusy    = ref(false)
const promoteErr     = ref('')
const promoteMsg     = ref('')
const trades         = ref<Trade[]>([])
const materials      = ref<Material[]>([])
const suppliers      = ref<Supplier[]>([])
const matPrices      = ref<MatPrice[]>([])
const projectId      = ref<string | null>(null)
const rows           = ref<Row[]>([])
const removedIds     = ref<string[]>([])
const newProjectName = ref('')
const addingProject  = ref(false)
const projectErr     = ref('')
const saving         = ref(false)
const saveError      = ref('')
const savedMsg       = ref('')
let accountId = ''
// ③ 見積書PDFのメール送信（元請けの担当者宛）＋送信履歴
const contractors       = ref<Contractor[]>([])
const contractorContacts = ref<Contact[]>([])
const sends             = ref<EstimateSend[]>([])
const sendContactIds    = ref<string[]>([])   // 送信先（元請け担当者・複数）
const sendSubject       = ref('')
const sendBody          = ref('')
const sendDialogOpen    = ref(false)
const sending           = ref(false)
const sendMsg           = ref('')
const sendErr           = ref('')
const docSavedMsg       = ref('')              // 見積書項目の自動保存表示
const projectSaving     = ref(false)   // 案件の元請け紐付け保存中
// F2 商社への発注（見積明細を商社ごとに分割して発注書を作成→各商社の担当者へ送信）
type SubContact = { id: string; subcontractor_id: string; name: string | null; email: string | null }
const subContacts   = ref<SubContact[]>([])
const projectPOs    = ref<any[]>([])                       // この案件の purchase_orders（estimate_project_id 一致）
const poContactSel  = ref<Record<string, string | null>>({}) // 商社ごとの送信先担当者の上書き選択
const poBusy        = ref<string | null>(null)             // 送信中の商社id
const poMsg         = ref('')
const poErr         = ref('')
const poPreviewEl   = ref<HTMLElement | null>(null)
const poTarget      = ref<null | { supplierName: string; contactName: string; items: Row[]; total: number }>(null)
// ④ 見積書フォーマット: 自社情報(settings) と 案件側の見積書項目
const COMPANY_KEYS = ['company_name', 'company_rep', 'company_address', 'company_tel', 'company_fax', 'company_seal_path', 'welfare_rate_a', 'welfare_rate_b', 'tax_rate', 'estimate_valid_until', 'estimate_payment_terms', 'estimate_separate_note']
const company = ref<Record<string, string>>({})
const doc     = ref<{ construction_location: string; period_text: string; valid_until: string; memo: string; adjustment: number; margin_rate: number | null }>(
  { construction_location: '', period_text: '', valid_until: '', memo: '', adjustment: 0, margin_rate: null })

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')
// 見出し行(row_type='header')は金額を持たない＝集計から除外する
const isItemRow  = (r: Row) => r.row_type !== 'header'
const lineAmount = (r: Row) => (isItemRow(r) ? (Number(r.quantity) || 0) * (Number(r.unit_price) || 0) : 0)
const lineCostAmount = (r: Row) => (isItemRow(r) ? (Number(r.quantity) || 0) * (Number(r.cost_unit_price) || 0) : 0)

// ── 粗利率（Q2）──────────────────────────────────────────────
// 顧客Excelの計算式そのまま: 見積単価 = 原価 ÷ (1 − 粗利率)
//  例) 原価2,700 ÷ 0.80 = 3,375（粗利20%）。※「原価 × (1+率)」ではない
// Excelは率を数式にハードコード(=X3/0.8)しており変更できなかった。ここをDBで持つ。
const accountMarginRate = ref(0.20)   // accounts.default_margin_rate
/** この見積に適用中の粗利率（案件上書きが無ければアカウント既定） */
const marginRate = computed(() => doc.value.margin_rate ?? accountMarginRate.value)
const marginPct  = ref(20)
function onMarginChange() {
  const p = Math.min(99, Math.max(0, Number(marginPct.value) || 0))
  marginPct.value = p
  doc.value.margin_rate = p / 100
  saveDoc()
}
function resetMargin() {
  doc.value.margin_rate = null
  marginPct.value = Math.round(accountMarginRate.value * 100)
  saveDoc()
}
/** 原価と粗利率から出る「自動の客先単価」 */
function priceAtMargin(r: Row, rate: number): number {
  const cost = Number(r.cost_unit_price) || 0
  if (!cost || rate >= 1) return 0
  return Math.round(cost / (1 - rate))
}
const autoPrice = (r: Row) => priceAtMargin(r, marginRate.value)
/** 自動値と違う＝人が手で上書きしている（Excelでも切りの良い数字に手打ちしていた） */
function isPriceOverridden(r: Row): boolean {
  if (!isItemRow(r) || !(Number(r.cost_unit_price) || 0)) return false
  return (Number(r.unit_price) || 0) !== autoPrice(r)
}
/** 原価を打つと客先単価が生える。ただし手で上書き済みの行は尊重して触らない */
function onCostInput(r: Row) {
  if (!r._priceTouched) r.unit_price = autoPrice(r)
}
function revertPrice(r: Row) { r.unit_price = autoPrice(r); r._priceTouched = false }
/** 粗利パターンのセルをクリック＝その率の単価を採用（見比べて選ぶExcelの操作） */

// ── 入力候補（自由記述＋学習）────────────────────────────────
// 固定マスタからの選択を強制せず、入力されたものを候補として出す（回答17）
const tradeNameOptions = computed(() => {
  const s = new Set<string>()
  for (const t of trades.value) if (t.name) s.add(t.name)
  for (const r of rows.value) if (r.trade_name) s.add(r.trade_name)
  return [...s].sort((a, b) => a.localeCompare(b, 'ja'))
})
const locationOptions = computed(() => {
  const s = new Set<string>()
  for (const r of rows.value) if (r.location) s.add(r.location)
  return [...s].sort((a, b) => a.localeCompare(b, 'ja'))
})

// 工種別の自動集計（明細を入れるだけで集計＝手コピペ撲滅）
// 工種のグルーピングキー/表示名。
//  自由記述(trade_name)を優先し、無ければ従来の固定マスタ(trade_id)を使う。
//  ＝マスタ選択を強制せずに、打った工種名でそのまま自動集計される（回答17・手コピペ撲滅）。
//  同じ工種名は表記が同一なら1つにまとまる（表記ゆれの名寄せは別チケット）。
function tradeKeyOf(r: Row): string {
  const nm = (r.trade_name ?? '').trim()
  if (nm) return `n:${nm}`
  return r.trade_id ? `t:${r.trade_id}` : 'none'
}
function tradeLabelOf(r: Row): string {
  const nm = (r.trade_name ?? '').trim()
  if (nm) return nm
  if (r.trade_id) return trades.value.find(t => t.id === r.trade_id)?.name ?? '(不明)'
  return '(工種未設定)'
}
const byTrade = computed(() => {
  const m = new Map<string, { tradeId: string | null; tradeName: string; total: number; key: string }>()
  for (const r of rows.value) {
    if (!isItemRow(r)) continue          // 見出し行は集計対象外
    const key = tradeKeyOf(r)
    const cur = m.get(key) ?? { tradeId: r.trade_id ?? null, tradeName: tradeLabelOf(r), total: 0, key }
    cur.total += lineAmount(r)
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ja'))
})
const grandTotal = computed(() => rows.value.reduce((s, r) => s + lineAmount(r), 0))
// 原価サマリ（社内用）。Excelの「項目」シート下部と同じ:
//   請負金額 / 原価 / 差引金額 = 請負 − 原価 / 利率 = 差引 ÷ 請負
const costTotal   = computed(() => rows.value.reduce((s, r) => s + lineCostAmount(r), 0))
const profitTotal = computed(() => grandTotal.value - costTotal.value)
const profitRatePct = computed(() =>
  grandTotal.value > 0 ? Math.round(profitTotal.value / grandTotal.value * 1000) / 10 : 0)

// E2 帳票PDF: 工種別に明細をまとめた印刷プレビュー用データ
const groupedDetailed = computed(() => {
  const m = new Map<string, { key: string; tradeName: string; total: number; items: Row[] }>()
  for (const r of rows.value) {
    if (!isItemRow(r)) continue          // 見出し行はPDF明細に出さない
    const key = tradeKeyOf(r)
    const cur = m.get(key) ?? { key, tradeName: tradeLabelOf(r), total: 0, items: [] as Row[] }
    cur.items.push(r); cur.total += lineAmount(r); m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ja'))
})
const previewEl = ref<HTMLElement | null>(null)
const pdfBusy = ref(false)
const today = new Date().toISOString().slice(0, 10)
// 見積書: 和暦の発行日（例: 令和8年6月15日）。サンプル様式に合わせる。
const todayWareki = computed(() => { const d = new Date(); return `令和${d.getFullYear() - 2018}年${d.getMonth() + 1}月${d.getDate()}日` })
// 自社情報・金額計算（小計→法定福利費→端数調整→合計税抜→消費税→税込）
const sealUrl  = computed(() => company.value.company_seal_path ? supabase.storage.from(BUCKET).getPublicUrl(company.value.company_seal_path).data.publicUrl : '')
const welfareA = computed(() => Number(company.value.welfare_rate_a) || 23)
const welfareB = computed(() => Number(company.value.welfare_rate_b) || 15)
const taxRate  = computed(() => Number(company.value.tax_rate) || 10)
const subtotal     = computed(() => grandTotal.value)                                          // 小計＝明細合計
const welfare      = computed(() => Math.round(subtotal.value * welfareA.value / 100 * welfareB.value / 100)) // 法定福利費
const adjustment   = computed(() => Number(doc.value.adjustment) || 0)                          // 端数調整(±)
const totalExclTax = computed(() => subtotal.value + welfare.value + adjustment.value)          // 合計(税抜)
const tax          = computed(() => Math.round(totalExclTax.value * taxRate.value / 100))       // 消費税
const totalInclTax = computed(() => totalExclTax.value + tax.value)                             // 税込
const docValidUntil = computed(() => doc.value.valid_until || company.value.estimate_valid_until || '')
// ページネーション: 行が途中で切れないよう行単位でページ分割（ヘッダーは各ページで繰り返す）
const BD_ROWS_PER_PAGE = 18      // 内訳書（工種別集計）の1ページ行数
const DETAIL_ROWS_PER_PAGE = 16  // 工種明細の1ページ行数
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out.length ? out : [[]]
}
// 内訳書ページ（工種集計を分割・合計欄は最終ページのみ）
const breakdownPages = computed(() => chunk(groupedDetailed.value, BD_ROWS_PER_PAGE))
// 工種明細ページ（各工種ごとに改ページ＋明細が多ければ続きページ）
const detailPages = computed(() => {
  const pages: { key: string; tradeName: string; total: number; items: Row[]; part: number; parts: number }[] = []
  for (const g of groupedDetailed.value) {
    const cs = chunk(g.items, DETAIL_ROWS_PER_PAGE)
    cs.forEach((items, i) => pages.push({ key: g.key, tradeName: g.tradeName, total: g.total, items, part: i + 1, parts: cs.length }))
  }
  return pages
})
// プレビューのページャ: 窓は1ページ分だけ表示し ‹ › で切替（PDF出力は全ページ）。
// ページ並び順: 0=表紙 / 1〜=内訳書 / その後=工種明細。
const currentPage  = ref(0)
const exporting    = ref(false)   // PDF生成中だけ全ページをDOM表示（html2canvas用）
const detailBase   = computed(() => 1 + breakdownPages.value.length)
const totalPages   = computed(() => 1 + breakdownPages.value.length + detailPages.value.length)
function prevPage() { if (currentPage.value > 0) currentPage.value-- }
function nextPage() { if (currentPage.value < totalPages.value - 1) currentPage.value++ }
// 明細が減ってページ数が縮んだら範囲内に丸める
watch(totalPages, (n) => { if (currentPage.value > n - 1) currentPage.value = Math.max(0, n - 1) })
const currentProjectName = computed(() => projects.value.find(p => p.id === projectId.value)?.name ?? '')
// #1 案件名のインライン編集（クリックで編集→Enter/blurで保存）
const editingName = ref(false)
const projectNameEdit = ref('')
function startRename() { projectNameEdit.value = currentProjectName.value; editingName.value = true }
async function commitRename() {
  if (!editingName.value) return
  editingName.value = false
  const name = projectNameEdit.value.trim()
  const p = projects.value.find(x => x.id === projectId.value)
  if (!p || !name || name === p.name) return
  if (projects.value.some(x => x.id !== p.id && x.name.trim().toLowerCase() === name.toLowerCase())) { projectErr.value = `案件「${name}」は既にあります`; return }
  projectErr.value = ''
  const { error } = await supabase.from('estimate_projects').update({ name }).eq('id', p.id)
  if (error) { projectErr.value = error.message; return }
  p.name = name
}
// #5 明細のドラッグ並び替え（ハンドルで掴んで移動。順序は保存時 sort_order に反映）
let rowKey = 0   // 明細行の安定キー採番（並び替え用）
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
function onDragStart(i: number) { dragIndex.value = i }
function onDragEnd() { dragIndex.value = null; dragOverIndex.value = null }
function onDrop(i: number) {
  const from = dragIndex.value
  dragOverIndex.value = null
  if (from === null || from === i) { dragIndex.value = null; return }
  const arr = rows.value
  const moved = arr[from]
  const target = arr[i]
  // ★ブロック開始の印は行と一緒に動かさない。動かすとブロックが分裂して
  //   間に空行が挟まり、並び替えたはずの行が離れた位置へ飛ぶ。
  if (moved._newBlock && arr[from + 1]) arr[from + 1]._newBlock = true
  moved._newBlock = false
  // 別ブロックへ落としたら、その行は落とし先の場所・工種を引き継ぐ（見た目どおりの挙動）
  if (target) { moved.location = target.location; moved.trade_name = target.trade_name }
  arr.splice(from, 1)
  arr.splice(i, 0, moved)
  dragIndex.value = null
}
const currentProject   = computed(() => projects.value.find(p => p.id === projectId.value) ?? null)
const currentContractorId = computed(() => currentProject.value?.contractor_id ?? null)
const currentContractorName = computed(() => contractors.value.find(c => c.id === currentContractorId.value)?.name ?? '')
// PDFの宛名（御中）は元請けを優先、無ければ従来の client_name
const currentClient = computed(() => currentContractorName.value || (currentProject.value?.client_name ?? ''))
// 現場昇華: 紐付く現場名／受注確定で現場を作成 or 既存現場に紐付け＋ステータスを active(受注) に
const currentSiteName = computed(() => sites.value.find(s => s.id === currentProject.value?.site_id)?.name ?? '')
function openPromote() {
  promoteErr.value = ''; promoteMsg.value = ''
  promoteMode.value = 'new'
  promoteName.value = currentProjectName.value
  promoteSiteId.value = null
  promoteOpen.value = true
}
async function promote() {
  if (!projectId.value) return
  promoteBusy.value = true; promoteErr.value = ''
  try {
    let siteId = promoteSiteId.value
    if (promoteMode.value === 'new') {
      const name = promoteName.value.trim()
      if (!name) { promoteErr.value = '現場名を入力してください'; return }
      const { data, error } = await supabase.from('sites').insert({
        account_id: accountId, name, contractor_id: currentContractorId.value || null, location: doc.value.construction_location || null,
      }).select('id, name').single()
      if (error) { promoteErr.value = /duplicate|unique/i.test(error.message) ? `現場「${name}」は既にあります（「既存の現場に紐付け」を選んでください）` : error.message; return }
      siteId = (data as any).id
      sites.value.push(data as Site)
    }
    if (!siteId) { promoteErr.value = '現場を選択してください'; return }
    const { error: upErr } = await supabase.from('estimate_projects').update({ site_id: siteId, status: 'active' }).eq('id', projectId.value)
    if (upErr) throw upErr
    const p = projects.value.find(x => x.id === projectId.value)
    if (p) { p.site_id = siteId; p.status = 'active' }
    promoteOpen.value = false
    promoteMsg.value = `受注として現場「${currentSiteName.value}」に紐付けました`
    setTimeout(() => (promoteMsg.value = ''), 3500)
  } catch (e: any) { promoteErr.value = e?.message ?? '現場化に失敗しました' }
  finally { promoteBusy.value = false }
}

// ③ 送信先＝案件に紐づく元請けの担当者。元請けの担当者だけに絞り、メール未登録は送信不可。
const sendContacts = computed(() => contractorContacts.value.filter(c => c.contractor_id === currentContractorId.value))
const selectedEmails = computed(() => sendContacts.value.filter(c => sendContactIds.value.includes(c.id) && c.email).map(c => c.email as string))
const canSend      = computed(() => rows.value.length > 0 && !!currentContractorId.value && selectedEmails.value.length > 0)
// #1/#2/#5 メール送信ダイアログを開く（宛先＝メール有り担当者を既定で全選択・件名/本文に既定値）
function openSendDialog() {
  sendErr.value = ''; sendMsg.value = ''
  sendContactIds.value = sendContacts.value.filter(c => c.email).map(c => c.id)
  sendSubject.value = `【御見積書】${currentProjectName.value}`
  sendBody.value = `いつもお世話になっております。\n下記のとおり御見積書をお送りいたします。ご査収のほどよろしくお願いいたします。\n\n案件：${currentProjectName.value}\n御見積金額：${yen(totalExclTax.value)}（税抜）\n\n添付の見積書PDFをご確認ください。`
  sendDialogOpen.value = true
}
// #6 見積書の案件側項目（工事場所/工期/有効期限/MEMO/端数調整）を入力離脱時に自動保存
async function saveDoc() {
  if (!projectId.value) return
  await supabase.from('estimate_projects').update({
    construction_location: doc.value.construction_location || null, period_text: doc.value.period_text || null,
    valid_until: doc.value.valid_until || null, memo: doc.value.memo || null, adjustment: Number(doc.value.adjustment) || 0,
    margin_rate: doc.value.margin_rate,   // 粗利率の案件上書き（null = アカウント既定を使う）
  }).eq('id', projectId.value)
  docSavedMsg.value = '保存しました'
  setTimeout(() => (docSavedMsg.value = ''), 2000)
}
// 案件に元請けを紐付け（estimate_projects.contractor_id を保存）
async function setProjectContractor(contractorId: string | null) {
  if (!projectId.value) return
  projectSaving.value = true
  try {
    await supabase.from('estimate_projects').update({ contractor_id: contractorId }).eq('id', projectId.value)
    const p = projects.value.find(x => x.id === projectId.value)
    if (p) p.contractor_id = contractorId
    sendContactIds.value = []   // 元請けが変わったら宛先選択をリセット
  } finally { projectSaving.value = false }
}

// F2 明細を商社(supplier_id)ごとにまとめる（商社ごとに1発注書）
const bySupplier = computed(() => {
  const m = new Map<string, { supplierId: string; supplierName: string; items: Row[]; total: number }>()
  for (const r of rows.value) {
    if (!r.supplier_id) continue
    const name = suppliers.value.find(s => s.id === r.supplier_id)?.name ?? '(商社)'
    const cur = m.get(r.supplier_id) ?? { supplierId: r.supplier_id, supplierName: name, items: [] as Row[], total: 0 }
    cur.items.push(r); cur.total += lineAmount(r); m.set(r.supplier_id, cur)
  }
  return [...m.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'ja'))
})
const rowsWithoutSupplier = computed(() => rows.value.filter(r => !r.supplier_id).length)
function poFor(supplierId: string) { return projectPOs.value.find(p => p.subcontractor_id === supplierId) }
function contactsFor(supplierId: string) { return subContacts.value.filter(c => c.subcontractor_id === supplierId) }
// 送信先担当者: 上書き選択 → 既存発注の担当者 → 先頭、の順
function poContactId(supplierId: string): string | null {
  if (supplierId in poContactSel.value) return poContactSel.value[supplierId]
  return poFor(supplierId)?.subcontractor_contact_id ?? contactsFor(supplierId)[0]?.id ?? null
}
function poEmail(supplierId: string) { return contactsFor(supplierId).find(c => c.id === poContactId(supplierId))?.email || '' }
function canSendPO(g: { supplierId: string; items: Row[] }) { return g.items.length > 0 && !!poContactId(g.supplierId) && !!poEmail(g.supplierId) }
// 送信日時表示（発注書PDFの表示は openDoc(path, pdf_bucket) で署名URL対応）
function fmtDateTime(iso: string | null) { if (!iso) return ''; try { return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// E2 PDF出力（表紙＋工種別内訳＋合計・A4複数ページ対応）
// 見積書PDFを生成: A4横向き・ページブロック単位（[data-pdf-page]）で改ページ。
//  1ページ目=表紙(全体)／2ページ目=内訳書(工種別集計)／3ページ目以降=工種ごとの明細。
//  サンプルPDFと同じ構成。ブロックが1ページに収まらなければそのブロック内で複数ページに分割。
async function buildEstimatePdf(): Promise<import('jspdf').jsPDF> {
  exporting.value = true      // 全ページをDOM表示してから取り込む（ページャで隠れている分も）
  await nextTick()
  try {
    return await renderEstimatePdf()
  } finally {
    exporting.value = false
  }
}
async function renderEstimatePdf(): Promise<import('jspdf').jsPDF> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = 297, pageH = 210
  const blocks = Array.from(previewEl.value!.querySelectorAll<HTMLElement>('[data-pdf-page]'))
  for (let b = 0; b < blocks.length; b++) {
    const canvas = await html2canvas(blocks[b], { scale: 2, backgroundColor: '#ffffff' })
    const png = canvas.toDataURL('image/png')
    const imgW = pageW
    const imgH = (canvas.height / canvas.width) * imgW
    let heightLeft = imgH, position = 0
    if (b > 0) pdf.addPage()
    pdf.addImage(png, 'PNG', 0, position, imgW, imgH)
    heightLeft -= pageH
    while (heightLeft > 0) { position = heightLeft - imgH; pdf.addPage(); pdf.addImage(png, 'PNG', 0, position, imgW, imgH); heightLeft -= pageH }
  }
  // ページ番号（全ページ右下に "現在 / 総数"。数字のみ＝既定フォントで可）
  const total = pdf.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i)
    pdf.setFontSize(9)
    pdf.setTextColor(120)
    pdf.text(`${i} / ${total}`, pageW - 8, pageH - 5, { align: 'right' })
  }
  return pdf
}
// ファイル名に使えない文字を除去（/ \ : * ? " < > | と全角コロン等）
function safeFileName(s: string) { return (s || '').replace(/[\\/:*?"<>|｜：＊？]/g, '_').trim() }
function ymd() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` }
// 見積書PDFのファイル名: 見積書_<案件名>_<YYYYMMDD>.pdf
const estimateFileName = () => `見積書_${safeFileName(currentProjectName.value) || '無題'}_${ymd()}.pdf`
async function exportPdf() {
  if (!previewEl.value) return
  pdfBusy.value = true
  try {
    const pdf = await buildEstimatePdf()
    pdf.save(estimateFileName())
  } finally {
    pdfBusy.value = false
  }
}
// ③ 見積書PDFを生成→Storageへ保存→商社の担当者宛にメール送信（履歴は EF が estimate_sends に記録）
async function sendPdf() {
  if (!canSend.value || !previewEl.value || !projectId.value) return
  sending.value = true; sendErr.value = ''; sendMsg.value = ''
  try {
    // PDF生成（A4横向き・ページブロック単位＝exportPdf と同方式）
    const pdf = await buildEstimatePdf()
    // Storageへ保存（EFが添付用にダウンロードする・履歴に紐付く）
    // admin-docs のRLSは path 先頭=account_id を要求するため account_id を先頭に置く。
    const path = `${accountId}/estimates/${projectId.value}-${Date.now()}.pdf`
    const { error: upErr } = await supabase.storage.from(PDF_BUCKET).upload(path, pdf.output('blob'), { upsert: true, contentType: 'application/pdf' })
    if (upErr) throw upErr
    // 送信EF（devはテスト入口＝実メールは送らず履歴のみ記録）。EFが呼び出し元JWTで越境を拒否。
    const fnName = IS_DEV ? 'test-send-estimate' : 'send-estimate'
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({
        project_id: projectId.value, contractor_id: currentContractorId.value, contractor_contact_ids: sendContactIds.value,
        subject: sendSubject.value, body: sendBody.value,
        pdf_path: path, pdf_bucket: PDF_BUCKET, total_amount: Math.round(grandTotal.value), project_name: currentProjectName.value,
      }),
    })
    const r = await res.json().catch(() => ({}))
    if (!res.ok || r?.error) throw new Error(r?.error ?? `送信失敗(${res.status})`)
    const to = Array.isArray(r.sent_to) ? r.sent_to.join('、') : (r.sent_to ?? '')
    sendMsg.value = r.test ? `送信履歴を記録しました（dev: 実メール送信なし）／宛先 ${to}` : `${to} へ送信しました`
    sendDialogOpen.value = false
    await loadSends()
  } catch (e: any) {
    sendErr.value = e?.message ?? '送信に失敗しました'
  } finally {
    sending.value = false
  }
}

// F2 発注書番号採番（PO-<年>-<4桁・account×年ごと連番。purchase-orders ページと同方式）
async function nextOrderNumber(): Promise<string> {
  const year = new Date().getFullYear(); const prefix = `PO-${year}-`
  const { data } = await supabase.from('purchase_orders').select('order_number')
    .eq('account_id', accountId).like('order_number', `${prefix}%`).order('order_number', { ascending: false }).limit(1)
  const last = data?.[0]?.order_number as string | undefined
  const seq = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0
  return `${prefix}${String(seq + 1).padStart(4, '0')}`
}
// F2 商社1社分の発注書PDFを生成→Storage保存→purchase_orders 作成/更新→send-purchase-order EF で送信
async function sendPO(g: { supplierId: string; supplierName: string; items: Row[]; total: number }) {
  const contactId = poContactId(g.supplierId)
  if (!contactId || !poEmail(g.supplierId)) { poErr.value = `${g.supplierName}: 担当者のメールが未登録です`; return }
  const resend = poFor(g.supplierId)?.email_sent_at ? '再送' : '送信'
  if (!window.confirm(`${g.supplierName}（${poEmail(g.supplierId)}）へ発注書PDFをメール${resend}します。よろしいですか？`)) return
  poBusy.value = g.supplierId; poErr.value = ''; poMsg.value = ''
  try {
    const contactName = contactsFor(g.supplierId).find(c => c.id === contactId)?.name ?? ''
    // 発注書プレビュー（商社1社分）を描画してからPDF化
    poTarget.value = { supplierName: g.supplierName, contactName, items: g.items.slice(), total: g.total }
    await nextTick()
    const canvas = await html2canvas(poPreviewEl.value!, { scale: 2, backgroundColor: '#ffffff' })
    const png = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = 210, pageH = 297, imgW = pageW
    const imgH = (canvas.height / canvas.width) * imgW
    let heightLeft = imgH, position = 0
    pdf.addImage(png, 'PNG', 0, position, imgW, imgH); heightLeft -= pageH
    while (heightLeft > 0) { position = heightLeft - imgH; pdf.addPage(); pdf.addImage(png, 'PNG', 0, position, imgW, imgH); heightLeft -= pageH }
    const blob = pdf.output('blob')
    // 同案件×商社の発注が既にあれば更新（再送＝重複発行しない）、無ければ採番して作成
    const existing = poFor(g.supplierId)
    let orderId = existing?.id as string | undefined
    const orderNumber = existing?.order_number ?? await nextOrderNumber()
    const payload: any = {
      account_id: accountId, estimate_project_id: projectId.value, subcontractor_id: g.supplierId,
      subcontractor_contact_id: contactId, order_number: orderNumber, order_date: today,
      total_amount: Math.round(g.total), site_name: currentProjectName.value,
      vendor_name: g.supplierName, vendor_contact_name: contactName,
      status: 'issued', issued_at: new Date().toISOString(),
    }
    if (orderId) await supabase.from('purchase_orders').update(payload).eq('id', orderId)
    else { const { data, error } = await supabase.from('purchase_orders').insert(payload).select('id').single(); if (error) throw error; orderId = (data as any)?.id }
    if (!orderId) throw new Error('発注書の作成に失敗しました')
    const path = `${accountId}/purchase-orders/${orderId}.pdf`
    const { error: upErr } = await supabase.storage.from(PDF_BUCKET).upload(path, blob, { upsert: true, contentType: 'application/pdf' })
    if (upErr) throw upErr
    await supabase.from('purchase_orders').update({ pdf_path: path, pdf_bucket: PDF_BUCKET }).eq('id', orderId)
    // 送信（発注書の承諾依頼。既存 send-purchase-order EF を再利用。devはtest入口で実送信なし）
    const fn = IS_DEV ? 'test-send-purchase-order' : 'send-purchase-order'
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ order_id: orderId }),
    })
    const r = await res.json().catch(() => ({}))
    if (!res.ok || r?.error) throw new Error(r?.error ?? `送信失敗(${res.status})`)
    poMsg.value = r.test ? `${g.supplierName}: 発注書 ${orderNumber} を作成（dev: 実メール送信なし）` : `${g.supplierName}: ${r.sent_to ?? ''} へ送信しました`
    await loadProjectPOs()
  } catch (e: any) {
    poErr.value = e?.message ?? '発注に失敗しました'
  } finally {
    poBusy.value = null; poTarget.value = null
  }
}

async function loadProjects() {
  const { data } = await supabase.from('estimate_projects')
    .select('id, name, client_name, contractor_id, status, site_id').eq('account_id', accountId).order('created_at', { ascending: false })
  projects.value = (data ?? []) as Project[]
}
async function loadTrades() {
  const { data } = await supabase.from('estimate_trades')
    .select('id, name').eq('account_id', accountId).order('sort_order').order('name')
  trades.value = (data ?? []) as Trade[]
}
async function loadMaterials() {
  const { data } = await supabase.from('estimate_materials')
    .select('id, name, unit, code, spec').eq('account_id', accountId).order('name')
  materials.value = (data ?? []) as Material[]
}
// 商社＝下請け業者マスタ(区分=商社)。新設せず既存 subcontractors を流用（subcontractors はRLS無効のため account_id で絞る）
async function loadSuppliers() {
  const { data } = await supabase.from('subcontractors')
    .select('id, name').eq('account_id', accountId).eq('category', '商社').order('name')
  suppliers.value = (data ?? []) as Supplier[]
}
async function loadMaterialPrices() {
  const { data } = await supabase.from('estimate_material_prices')
    .select('id, material_id, supplier_id, unit_price, effective_date').eq('account_id', accountId).eq('is_current', true)
  matPrices.value = (data ?? []) as MatPrice[]
}
// ③ 元請けと担当者（見積書の送信先候補）。元請けマスタ(contractors)＋ contractor_contacts。
async function loadContractors() {
  const [{ data: cs }, { data: ccs }] = await Promise.all([
    supabase.from('contractors').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
    supabase.from('contractor_contacts').select('id, contractor_id, name, email').eq('account_id', accountId).eq('is_deleted', false).order('sort_order'),
  ])
  contractors.value = (cs ?? []) as Contractor[]
  contractorContacts.value = (ccs ?? []) as Contact[]
}
// 現場一覧（受注時の紐付け先・現場名表示用）
async function loadSites() {
  const { data } = await supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  sites.value = (data ?? []) as Site[]
}
// ④ 自社情報（settings）を読む
// ── Q4: 過去の業者別単価（受領登録の副作用で貯まったもの）を候補として引く ──
type PriceHist = { item_name: string; unit_price: number; unit: string | null; price_kind: string
                   subcontractor_name: string; quoted_on: string | null; project_name: string | null
                   request_id: string | null }   // R5: この単価の根拠になった受領見積
const priceHistory = ref<PriceHist[]>([])
async function loadPriceHistory() {
  const { data } = await supabase.from('estimate_price_history')
    .select('item_name, unit_price, unit, price_kind, subcontractor_name, quoted_on, project_name, request_id')
    .eq('account_id', accountId).order('quoted_on', { ascending: false }).limit(500)
  priceHistory.value = (data ?? []) as PriceHist[]
  // 履歴に出てくる受領見積の根拠ファイルをまとめて引く（案件横断）
  const ids = [...new Set(priceHistory.value.map(h => h.request_id).filter(Boolean))] as string[]
  if (!ids.length) { historyFiles.value = []; return }
  const { data: files } = await supabase.from('estimate_quote_files')
    .select('id, request_id, path, name').in('request_id', ids)
  historyFiles.value = (files ?? []) as QuoteFile[]
}
/** その項目名の過去単価（安い順）。Excelの相見積シートと同じ 業者/単価/提示日/現場名 を返す */
/**
 * ★R15: 過去実績を「表記ゆれ込み」で拾う。
 *  完全一致だけだと「壁面LGS間仕切」と「壁面 外周LGS間仕切り」が別物になり、
 *  せっかく貯めた単価が出てこない。空白・記号・送り仮名の違いを吸収して比べる。
 *  生成AIは使わない（2026-07-29 ユーザー回答）。打鍵のたびに走らせたいので、
 *  無料・即時・件数無制限である手元の類似判定を採る。
 */
/**
 * ★数字は同一性の核なので、違えば別物として扱う。
 *  「PB t12.5」と「PB t9.5」、「LGS W65」と「W50」、「L2000」と「L2400」は
 *  文字としては1〜2字違いだが、材料としては完全に別物。
 *  文字数比だけで判定すると別物を掴んで単価を間違える。
 */
const digitsOf = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).join(',')

function historyFor(itemName: string): PriceHist[] {
  const raw = (itemName ?? '').trim()
  if (!raw) return []
  const nm = normalizeName(raw)
  if (!nm) return []
  const nmDigits = digitsOf(nm)
  const limit = Math.max(1, Math.floor(nm.length * 0.3))
  const hit = priceHistory.value.filter(h => {
    const cand = normalizeName(h.item_name)
    if (!cand) return false
    if (cand === nm) return true
    if (digitsOf(cand) !== nmDigits) return false             // 数字が違う＝別物
    if (cand.includes(nm) || nm.includes(cand)) return true   // 「壁面LGS」⊂「壁面 外周LGS間仕切り」
    if (Math.abs(cand.length - nm.length) > limit) return false   // 長さが離れすぎ（重い計算を避ける）
    return editDistance(nm, cand) <= limit
  })
  return hit.sort((a, b) => a.unit_price - b.unit_price)
}
/** 候補の項目名が打った名前と違う時だけ、何にマッチしたのかを見せる（誤採用を防ぐ） */
function historyAltName(r: Row, h: PriceHist): string {
  return normalizeName(h.item_name) === normalizeName(r.item_name) ? '' : h.item_name
}
/** 候補をクリックしたら原価に採用（客先単価は粗利率から生やす） */
function applyHistoryPrice(r: Row, h: PriceHist) {
  r.cost_unit_price = h.unit_price
  if (!r.unit && h.unit) r.unit = h.unit
  if (!r._priceTouched) r.unit_price = autoPrice(r)
}

async function loadCompany() {
  const { data } = await supabase.from('settings').select('key, value').eq('account_id', accountId).in('key', COMPANY_KEYS)
  company.value = Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
  // アカウント既定の粗利率（案件で上書きが無ければこれを使う）
  const { data: acc } = await supabase.from('accounts').select('default_margin_rate').eq('id', accountId).maybeSingle()
  if (acc?.default_margin_rate != null) accountMarginRate.value = Number(acc.default_margin_rate)
  syncMarginPct()
  await loadSubcontractorOptions()
  await loadPriceHistory()
}
/** 表示用の % を「案件上書き → アカウント既定」の順で合わせる */
function syncMarginPct() {
  marginPct.value = Math.round((doc.value.margin_rate ?? accountMarginRate.value) * 100)
}
// F2 商社（下請け業者）の担当者＝発注書の送信先候補
async function loadSubContacts() {
  const { data } = await supabase.from('subcontractor_contacts')
    .select('id, subcontractor_id, name, email').eq('account_id', accountId).eq('is_deleted', false).order('sort_order')
  subContacts.value = (data ?? []) as SubContact[]
}
// F2 この案件で既に発行済みの発注書（商社ごと・送信状態の表示と再送に使う）
async function loadProjectPOs() {
  projectPOs.value = []
  poContactSel.value = {}
  if (!projectId.value) return
  const { data } = await supabase.from('purchase_orders')
    .select('id, subcontractor_id, subcontractor_contact_id, order_number, total_amount, email_sent_at, pdf_path, pdf_bucket, status')
    .eq('estimate_project_id', projectId.value).eq('is_deleted', false)
  projectPOs.value = (data ?? []) as any[]
}
// ③ この案件の送信履歴
async function loadSends() {
  sends.value = []
  if (!projectId.value) return
  const { data } = await supabase.from('estimate_sends')
    .select('id, email_to, subject, sent_at, created_at').eq('project_id', projectId.value).order('created_at', { ascending: false })
  sends.value = (data ?? []) as EstimateSend[]
}
// E7 商社別単価: 行の材料に対する商社別単価リスト（単価差の表示元）
function pricesForMaterial(materialId: string | null) {
  if (!materialId) return [] as Array<{ supplier_id: string; supplierName: string; unit_price: number }>
  return matPrices.value
    .filter(p => p.material_id === materialId)
    .map(p => ({ supplier_id: p.supplier_id, supplierName: suppliers.value.find(s => s.id === p.supplier_id)?.name ?? '(商社)', unit_price: Number(p.unit_price) }))
    .sort((a, b) => a.unit_price - b.unit_price)
}
// 商社を選ぶと、その商社×材料の単価を明細単価に反映（金額は生成列/computedで追従）
function onSupplierPick(r: Row) {
  if (!r.material_id || !r.supplier_id) return
  const p = matPrices.value.find(x => x.material_id === r.material_id && x.supplier_id === r.supplier_id)
  if (p) r.unit_price = Number(p.unit_price)
}
// E6 品番予測変換: 明細名が既存材料に一致したら material_id を紐付け、単位を補完
// ════════════════════════════════════════════════════════════
//  R6: 品名の「もしかして」＋商品情報（サイズ展開・仕様・画像）の自動表示
//
//  ユーザー原文（2026-07-28 通しレビュー・音声）:
//   「品名を選択したときに、商品の詳細画像とか、どんなサイズがあるかとかを
//     ネット検索・AIで調べてぱっとUI上で表示したい。現状の業務フローだと、
//     毎回その品名で Google 検索なり ChatGPT なりで調べて『あー、こんなんね』って認識してる」
//  ＝人が毎回やっている検索を画面に持ってくるのが目的。
// ════════════════════════════════════════════════════════════
type ProductInfo = {
  lookup_key: string; maker: string | null; sizes: string | null; spec: string | null
  image_url: string | null; source_urls: string[]; not_found: boolean
}
const productInfos = ref<Record<string, ProductInfo>>({})
const pinfoBusyKey = ref('')

/** 検索キー: 品番があれば品番、無ければ品名。大小・全角空白を吸収する */
function productKeyOf(r: Row): string {
  const code = (r.product_code ?? '').trim()
  const name = (r.item_name ?? '').trim()
  const base = code || name
  return base ? base.toLowerCase().replace(/[\s\u3000]+/g, ' ') : ''
}
const productInfoOf = (r: Row): ProductInfo | null => productInfos.value[productKeyOf(r)] ?? null

/** 画像URLが死んでいた（403/404・ホットリンク禁止）ら、画像だけ落として情報は残す */
function onPinfoImgError(r: Row) {
  const info = productInfoOf(r)
  if (info) info.image_url = null
}

// ── 「もしかして」（表記ゆれ・打ち間違い）──
//  datalist の予測変換は前方一致しか効かない。「天井 下地組」と「天井下地組」のような
//  ゆれは前方一致では拾えないので、正規化した編集距離で似ている既存名を出す。
const normalizeName = (s: string) =>
  (s ?? '').trim().toLowerCase().replace(/[\s\u3000・\-ー_]/g, '')
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m || !n) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}
/**
 * 「もしかして」候補を計算する。
 * ★描画のたびに全行×全マスタで編集距離を回すと、マスタが育つほどUIが固まる
 *   （E2Eで保存ボタンが反応しなくなる形で実際に踏んだ）。
 *   入力が変わった時に1度だけ計算して行に持たせ、描画では読むだけにする。
 */
function computeDidYouMean(r: Row): void {
  const raw = (r.item_name ?? '').trim()
  if (raw.length < 2) { r._dym = []; return }
  const nm = normalizeName(raw)
  // 完全一致するマスタがあるなら、それが正解なので候補は出さない
  if (materials.value.some(m => normalizeName(m.name) === nm)) { r._dym = []; return }
  const limit = Math.max(1, Math.floor(nm.length * 0.3))
  const out: { name: string; d: number }[] = []
  for (const m of materials.value) {
    const cand = normalizeName(m.name)
    if (!cand || cand === nm) continue
    if (digitsOf(cand) !== digitsOf(nm)) continue   // 数字が違えば別物（t12.5 と t9.5 等）
    // 長さが離れすぎているものは編集距離を計算するまでもない（重い処理を避ける足切り）
    if (Math.abs(cand.length - nm.length) > limit) continue
    const d = editDistance(nm, cand)
    if (d <= Math.max(1, Math.floor(Math.max(nm.length, cand.length) * 0.3))) out.push({ name: m.name, d })
    if (out.length >= 20) break
  }
  r._dym = out.sort((a, b) => a.d - b.d).slice(0, 3).map(x => x.name)
}
const didYouMean = (r: Row): string[] => r._dym ?? []

function applyDidYouMean(r: Row, name: string) {
  r.item_name = name          // クリックで上書きする（要望どおり）
  r._dym = []
  resolveMaterial(r)
  void loadCachedProductInfo(r)
}

function onItemNameChange(r: Row) {
  computeDidYouMean(r)
  resolveMaterial(r)
  void loadCachedProductInfo(r)   // ★AIは自動で叩かない（下の理由）
}

/** キャッシュ（estimate_product_info）にあれば表示する。DB読みだけなので即時・無料。 */
async function loadCachedProductInfo(r: Row) {
  const key = productKeyOf(r)
  if (!key || productInfos.value[key]) return
  const { data: cached } = await supabase.from('estimate_product_info')
    .select('lookup_key, maker, sizes, spec, image_url, source_urls, not_found')
    .eq('account_id', accountId).eq('lookup_key', key).maybeSingle()
  if (!cached) return
  productInfos.value = { ...productInfos.value, [key]: {
    lookup_key: key, maker: cached.maker, sizes: cached.sizes, spec: cached.spec,
    image_url: cached.image_url, source_urls: (cached.source_urls ?? []) as string[],
    not_found: !!cached.not_found,
  } }
}
/** まだ調べていない品名か（＝「調べる」ボタンを出すべきか） */
/**
 * ★R14: 明細には性質の違う2種類がある。判別は「品番の有無」で行う。
 *  (a) 作業内容（品番なし）… 例「壁面外周LGS間仕切り」。下請業者への発注作業。
 *      商品としては存在しないのでネット検索しても見つからない。商社の概念も無い。
 *      → 過去の下請業者実績（業者/日付/価格）を頼りにする。
 *  (b) 材料（品番あり）… 例「ガラススリット受金物 GS-201」。商品情報が引けて、
 *      商社ごとの単価がある。
 *  種別を人に選ばせないのは、品番を打つかどうかで自明に決まるため。
 */
const isMaterialRow = (r: Row) => !!(r.product_code ?? '').trim()
/**
 * 商社を出してよい行か。
 * 品番が無くても、マスタで商社別単価が登録されている材料（品名で選んだケース）は
 * 材料として扱う。品番の有無だけで切ると、その動線で商社が選べなくなる。
 */
const hasSupplierChoice = (r: Row) => isMaterialRow(r) || pricesForMaterial(r.material_id).length > 0

function needsLookup(r: Row): boolean {
  if (!isMaterialRow(r)) return false   // 作業内容は調べても見つからないので出さない
  const key = productKeyOf(r)
  return !!key && !productInfos.value[key] && pinfoBusyKey.value !== key
}

/**
 * 商品情報をネット検索で調べる。
 * ★人が押した時だけ叩く。品名を打つたびに自動で叩くと
 *   ①生成AIの課金が入力のたびに発生し ②検索に十数秒かかる間ブラウザの接続を占有して
 *   保存など他の操作が待たされる（E2Eで保存が終わらなくなる形で実際に踏んだ）。
 *   ユーザーの要望も「品名を選択したときに表示したい」であって、
 *   打鍵のたびに調べてほしいという話ではない。
 * 同時に走らせないのも同じ理由（連打しても1件ずつ）。
 */
async function lookupProductInfo(r: Row, force = false) {
  const key = productKeyOf(r)
  if (!key) return
  if (!force && productInfos.value[key]) return
  if (pinfoBusyKey.value) return          // 1件ずつ
  pinfoBusyKey.value = key
  try {
    const { data: sess } = await supabase.auth.getSession()
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/product-info-lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess?.session?.access_token ?? ''}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ name: r.item_name, product_code: r.product_code, maker: null }),
    })
    const jsonRes = await resp.json().catch(() => null)
    const info = jsonRes?.info
    if (!resp.ok || !info) return
    const rec: ProductInfo = {
      lookup_key: key, maker: info.maker ?? null, sizes: info.sizes ?? null, spec: info.spec ?? null,
      image_url: info.image_url ?? null, source_urls: info.source_urls ?? [], not_found: !!info.not_found,
    }
    productInfos.value = { ...productInfos.value, [key]: rec }
    // ★見つからなかったことも保存する。しないと同じ品名で毎回AIを叩き直す。
    await supabase.from('estimate_product_info').upsert({
      account_id: accountId, lookup_key: key,
      name: r.item_name || null, product_code: r.product_code || null,
      maker: rec.maker, sizes: rec.sizes, spec: rec.spec, image_url: rec.image_url,
      source_urls: rec.source_urls, not_found: rec.not_found, fetched_at: new Date().toISOString(),
    }, { onConflict: 'account_id,lookup_key' })
  } catch { /* 調べられなくても入力は止めない */ } finally {
    if (pinfoBusyKey.value === key) pinfoBusyKey.value = ''
  }
}

// R3: 品番の予測変換候補（マスタに貯まった code）
const materialCodeOptions = computed(() =>
  [...new Set(materials.value.map(m => (m.code ?? '').trim()).filter(Boolean))].sort())

/** 品番を打ったら品名・単位を引く（品番はメーカー特定のキーなので、こちらからも入れられる） */
function resolveByCode(r: Row) {
  const code = (r.product_code || '').trim().toLowerCase()
  if (!code) return
  const m = materials.value.find(x => (x.code ?? '').trim().toLowerCase() === code)
  if (!m) return
  r.material_id = m.id
  if (!r.item_name.trim()) r.item_name = m.name
  if (!r.unit && m.unit) r.unit = m.unit
  if (!r.spec.trim() && m.spec) r.spec = m.spec
}

function onCodeChange(r: Row) {
  resolveByCode(r)
  void loadCachedProductInfo(r)
}
/**
 * 品名から品番を自動入力した直後、その品番欄にフォーカスがあるなら中身を選択状態にする。
 * ★これが無いと文字が連結する: 名前欄からTabで品番欄へ移った瞬間にblurで自動入力が走り、
 *   人がそのまま打つとカーソル位置に追記されて「GS-201GS-201」になる（E2Eで検出）。
 *   自動入力を選択状態にしておけば、次の入力で置き換わる（一般的なオートフィルの挙動）。
 */
function selectCodeFieldIfFocused(r: Row) {
  nextTick(() => {
    const el = document.activeElement as HTMLInputElement | null
    const id = el?.getAttribute?.('data-testid') ?? ''
    if (!id.startsWith('item-code-')) return
    if (rows.value[Number(id.slice('item-code-'.length))] !== r) return
    el?.select?.()
  })
}
function resolveMaterial(r: Row) {
  const nm = (r.item_name || '').trim().toLowerCase()
  if (!nm) { r.material_id = null; return }
  const m = materials.value.find(x => x.name.trim().toLowerCase() === nm)
  if (m) {
    r.material_id = m.id
    if (!r.unit && m.unit) r.unit = m.unit
    // 逆方向: 品名→品番も埋める。ただし**その品番欄を人が今まさに打っている時は触らない**。
    // 名前欄のblur（＝次の欄へ移った瞬間）に発火するので、移った先が品番欄だと
    // 自動入力と人の入力が衝突して文字が連結する（GS-201GS-201）。人の入力を優先する。
    if (!r.product_code.trim() && m.code) { r.product_code = m.code; selectCodeFieldIfFocused(r) }
  } else {
    r.material_id = null
  }
  // 材料に単価の無い商社選択はクリア
  if (r.supplier_id && !matPrices.value.some(p => p.material_id === r.material_id && p.supplier_id === r.supplier_id)) {
    r.supplier_id = null
  }
}
async function loadItems() {
  loadingItems = true
  try { await doLoadItems() } finally { loadingItems = false }
  ensureSpareRows()   // 読み込みが終わってから空行を出す（Excel感覚で即打てる）
}
async function doLoadItems() {
  rows.value = []
  removedIds.value = []
  doc.value = { construction_location: '', period_text: '', valid_until: '', memo: '', adjustment: 0 }
  lastLoadedProjectId = projectId.value
  // ★表示状態のリセットは await より前に。後ろでやると、読み込み中に人が押したタブが
  //   読み込み完了時に弾き返される（案件作成直後にタブが勝手に戻る操作性バグ）。
  builderTab.value = 'items'
  currentPage.value = 0   // 案件を開いたら先頭ページへ
  editingName.value = false
  if (!projectId.value) { markSaved(); return }
  const [{ data }, { data: pj }] = await Promise.all([
    supabase.from('estimate_items')
      .select('id, category_id, trade_id, trade_name, material_id, supplier_id, item_name, spec, product_code, dim_w, dim_d, dim_h, row_type, unit, quantity, cost_unit_price, unit_price, note')
      .eq('project_id', projectId.value).order('sort_order'),
    supabase.from('estimate_projects')
      .select('construction_location, period_text, valid_until, memo, adjustment, margin_rate, request_date, due_date, status, lost_reason').eq('id', projectId.value).single(),
  ])
  rows.value = (data ?? []).map((d: any) => ({
    id: d.id, _k: ++rowKey, location: d.note ?? '', trade_id: d.trade_id, trade_name: d.trade_name ?? '',
    spec: d.spec ?? '', row_type: (d.row_type === 'header' ? 'header' : 'item'),
    cost_unit_price: Number(d.cost_unit_price) || 0, _priceTouched: true,  // 既存値は人が決めた値として尊重
    material_id: d.material_id ?? null,
    supplier_id: d.supplier_id ?? null, item_name: d.item_name, unit: d.unit ?? '',
    quantity: Number(d.quantity) || 0, unit_price: Number(d.unit_price) || 0,
  }))
  doc.value = {
    construction_location: pj?.construction_location ?? '', period_text: pj?.period_text ?? '',
    margin_rate: pj?.margin_rate == null ? null : Number(pj.margin_rate),
    valid_until: pj?.valid_until ?? '', memo: pj?.memo ?? '', adjustment: Number(pj?.adjustment) || 0,
  }
  syncMarginPct()   // 案件の上書き率を表示に反映
  // Q5: 受領情報（依頼日/提出期限/状態/失注理由）
  intake.value = {
    request_date: pj?.request_date ?? '',
    due_date:     pj?.due_date ?? '',
    status:       pj?.status ?? 'draft',
    lost_reason:  pj?.lost_reason ?? '',
  }
  await loadAttachments()
  markSaved()
  sendContactIds.value = []
  await Promise.all([loadSends(), loadProjectPOs(), loadDrawingSends()])
}

async function addProject() {
  const name = newProjectName.value.trim()
  if (!name) return
  projectErr.value = ''
  // 同名の案件は作らせない（大小文字無視）
  if (projects.value.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) {
    projectErr.value = `案件「${name}」は既にあります`
    return
  }
  newProjectName.value = ''   // 同期クリア（連続入力のレース回避）
  const { data, error } = await supabase.from('estimate_projects')
    .insert({ account_id: accountId, name }).select('id, name, client_name').single()
  if (error) { projectErr.value = /duplicate|unique/i.test(error.message) ? `案件「${name}」は既にあります` : error.message; newProjectName.value = name; return }
  await loadProjects()
  projectId.value = (data as Project).id
  addingProject.value = false
  await loadItems()
}

function blankRow(rowType: 'item' | 'header' = 'item'): Row {
  return { id: null, _k: ++rowKey, location: '', trade_id: null, trade_name: '', material_id: null,
           supplier_id: null, item_name: '', spec: '', product_code: '', row_type: rowType, unit: '', quantity: 0,
           dim_w: null, dim_d: null, dim_h: null,
           cost_unit_price: 0, unit_price: 0, _priceTouched: false }
}
function removeRow(i: number) {
  const r = rows.value[i]
  if (r.id) removedIds.value.push(r.id)
  rows.value.splice(i, 1)
}

// ════════════════════════════════════════════════════════════
//  明細の「ブロック」（場所＝大項目 × 工種＝中項目）
//
//  顧客のExcelは (壁面工事) → ■軽鉄工事 → 壁面外周LGS間仕切り / 壁面PB板 / 壁面下地補強
//  という入れ子で、同じ場所・工種が何行も続く。行ごとに場所と工種を選ばせると
//  同じ値を延々入れ直すことになるので、**ブロック単位で1回だけ**選ばせる。
//  DBは従来どおり行ごとに location / trade_name を持つ（集計・帳票の互換を壊さない）。
//  ブロック＝「連続する同じ (場所, 工種) の行のまとまり」として画面側で導出する。
// ════════════════════════════════════════════════════════════
// ★2階層: 場所（大項目）> 工種（中項目）> 明細行
//  Excelは「壁面工事」の下に「軽鉄工事」「塗装工事」…と複数の工種がぶら下がる入れ子。
//  1場所1工種にすると、同じ場所を工種の数だけ書くことになる（レビュー2026-07-29）。
type Block = { _bk: string; location: string; trade_name: string; idxs: number[]; filled: number }
type Area  = { _ak: string; location: string; blocks: Block[]; filled: number }
const SPARE_ROWS = 5   // 各ブロックの末尾に常に確保しておく空行数（Excel感覚で打てるように）

/** 中身が空＝まだ何も打たれていない行。場所/工種はブロックから継承するので判定に含めない */
function isBlankRow(r: Row): boolean {
  return !(r.item_name || '').trim() && !(r.spec || '').trim() && !(r.product_code || '').trim() && !(r.unit || '').trim()
    && !(Number(r.quantity) || 0) && !(Number(r.cost_unit_price) || 0) && !(Number(r.unit_price) || 0)
    && r.dim_w == null && r.dim_d == null && r.dim_h == null   // 寸法だけ入れた行を空扱いで消さない
    && !r.material_id && !r.supplier_id
}
const blockKeyOf = (r: Row) => `${r.location ?? ''} ${r.trade_name ?? ''}`

const blocks = computed<Block[]>(() => {
  const out: Block[] = []
  rows.value.forEach((r, i) => {
    const key = blockKeyOf(r)
    const last = out[out.length - 1]
    // 場所/工種が未入力のブロックを2つ作ると key が同じで混ざってしまうため、
    // 「＋ブロックを追加」で作った先頭行には印を付けて明示的に切る。
    if (last && last._bk === key && !r._newBlock) last.idxs.push(i)
    else out.push({ _bk: key, location: r.location ?? '', trade_name: r.trade_name ?? '', idxs: [i], filled: 0 })
  })
  for (const b of out) b.filled = b.idxs.filter(i => !isBlankRow(rows.value[i])).length
  return out
})

/** 場所（大項目）でブロックをまとめる。連続する同じ location が1つの場所になる */
const areas = computed<Area[]>(() => {
  const out: Area[] = []
  for (const b of blocks.value) {
    const first = rows.value[b.idxs[0]]
    const last = out[out.length - 1]
    // 場所が未入力のエリアを2つ作ると混ざるので、「＋場所を追加」で作った先頭行に印を付ける
    if (last && last.location === b.location && !first?._newArea) last.blocks.push(b)
    else out.push({ _ak: `${out.length}:${b.location}`, location: b.location, blocks: [b], filled: 0 })
  }
  for (const a of out) a.filled = a.blocks.reduce((s, b) => s + b.filled, 0)
  return out
})

/** ブロック（工種）の値を変えたら、その中の全行に反映する */
function onBlockField(b: Block, field: 'location' | 'trade_name', value: string) {
  for (const i of b.idxs) rows.value[i][field] = value
}
/** 場所を変えたら、その場所配下の**全工種の全行**に反映する（一対多の実体） */
function onAreaLocation(a: Area, value: string) {
  for (const b of a.blocks) for (const i of b.idxs) rows.value[i].location = value
}

function newBlockRows(location: string, trade: string, markArea = false): Row[] {
  const out: Row[] = []
  for (let n = 0; n < SPARE_ROWS; n++) {
    const r = blankRow()
    r.location = location; r.trade_name = trade
    if (n === 0) { r._newBlock = true; if (markArea) r._newArea = true }
    out.push(r)
  }
  return out
}
/** 場所を1つ増やす（配下に空の工種が1つ付いてくる） */
function addArea() { rows.value.push(...newBlockRows('', '', true)) }
/** その場所の中に工種を1つ増やす（場所は引き継ぐ＝同じ場所を打ち直さない） */
function addTradeToArea(a: Area) {
  const lastIdx = Math.max(...a.blocks.flatMap(b => b.idxs))
  rows.value.splice(lastIdx + 1, 0, ...newBlockRows(a.location, ''))
}
function removeBlock(b: Block) {
  if (b.filled && !window.confirm(`この工種の入力済み ${b.filled} 行も一緒に削除します。よろしいですか？`)) return
  // 消す工種が場所の先頭だった場合、場所の開始位置を次の工種へ引き継ぐ
  const first = rows.value[b.idxs[0]]
  const nextIdx = b.idxs[b.idxs.length - 1] + 1
  if (first?._newArea && rows.value[nextIdx]) rows.value[nextIdx]._newArea = true
  for (const i of [...b.idxs].sort((x, y) => y - x)) removeRow(i)   // 後ろから消す（indexズレ防止）
}
function removeArea(a: Area) {
  if (a.filled && !window.confirm(`この場所の入力済み ${a.filled} 行も一緒に削除します。よろしいですか？`)) return
  const idxs = a.blocks.flatMap(b => b.idxs).sort((x, y) => y - x)
  for (const i of idxs) removeRow(i)
}

/**
 * 各ブロックの末尾に空行を SPARE_ROWS 本だけ確保する。
 * Excelは空行が大量にあって「行が足りない心配なくどこにでも打てる」のが前提なので、
 * 「＋行追加」を押させない（レビュー2026-07-28）。打つと自動で下に空きが足される。
 */
// 読み込み中は true。この間に空行を出すと、まだ読み込みが終わっていない画面に
// 人が打ててしまい、その入力が直後の markSaved に「保存済み」として飲み込まれる
// （＝保存し忘れても警告が出ない）。実際にE2Eで踏んだ。
let loadingItems = false
function ensureSpareRows() {
  if (loadingItems || !projectId.value) return
  if (!rows.value.length) { addArea(); return }
  // ★blocks は rows から導出される computed。ループ中に rows を splice すると
  //   blocks が読み直されて添字がズレ、空行を行の**途中**に差し込んでしまう
  //   （並び替え直後に入力値が消えるバグとして実際に踏んだ）。
  //   スナップショットを1回だけ取り、新しい配列を組み立てて差し替える。
  const snapshot = blocks.value
  const out: Row[] = []
  for (const b of snapshot) {
    let trailing = 0
    for (let k = b.idxs.length - 1; k >= 0; k--) {
      if (isBlankRow(rows.value[b.idxs[k]])) trailing++
      else break
    }
    for (const i of b.idxs) out.push(rows.value[i])
    for (let n = trailing; n < SPARE_ROWS; n++) {
      const r = blankRow()
      r.location = b.location; r.trade_name = b.trade_name   // 空行もブロックに属させる
      out.push(r)
    }
  }
  if (out.length !== rows.value.length) rows.value = out   // 変化が無ければ触らない＝watchが止まる
}
// 打つたびに末尾の空きを補充する。補充後は条件を満たすので再帰しない。
watch(rows, ensureSpareRows, { deep: true })

async function save() {
  if (!projectId.value) return
  saving.value = true; saveError.value = ''; savedMsg.value = ''
  try {
    // 削除
    if (removedIds.value.length) {
      await supabase.from('estimate_items').delete().in('id', removedIds.value)
      removedIds.value = []
    }
    // E5 マスタ蓄積（明細保存より前）: 初回入力の材料名を estimate_materials に捕捉し、
    // 新規材料の material_id を行に紐付けてから保存する（E6: 単位も一緒に捕捉）。
    const known = new Map(materials.value.map(m => [m.name.trim().toLowerCase(), m.id]))
    const created = new Map<string, string>()
    for (const r of rows.value) {
      if (isBlankRow(r)) continue
      const nm = (r.item_name || '').trim()
      if (!nm || nm === '(無題)') continue
      const key = nm.toLowerCase()
      if (!r.material_id && known.has(key)) r.material_id = known.get(key)!
      if (!r.material_id && created.has(key)) r.material_id = created.get(key)!
      if (!r.material_id) {
        const { data } = await supabase.from('estimate_materials')
          .insert({ account_id: accountId, name: nm, code: r.product_code || null, unit: r.unit || null, trade_id: r.trade_id, source: 'manual' })
          .select('id').single()
        if (data) { r.material_id = (data as any).id; created.set(key, r.material_id!) }
      }
    }
    // upsert（amount は生成列なので送らない）
    // ★空行は保存しない。末尾に常時5行の空きを用意する仕様なので、
    //   そのまま保存すると「(無題)」のゴミ行が毎回5行ずつ増える。
    //   一度保存した行が空になった場合は削除する（人が消したのと同義）。
    const emptied = rows.value.filter(r => r.id && isBlankRow(r)).map(r => r.id!)
    if (emptied.length) {
      await supabase.from('estimate_items').delete().in('id', emptied)
      for (const r of rows.value) if (r.id && isBlankRow(r)) r.id = null
    }
    let order = 0
    for (const r of rows.value) {
      if (isBlankRow(r)) continue
      const payload: any = {
        account_id: accountId, project_id: projectId.value,
        trade_id: r.trade_id, material_id: r.material_id, supplier_id: r.supplier_id, item_name: r.item_name || '(無題)',
        unit: r.unit || null, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0,
        note: r.location || null, sort_order: order++,
        trade_name: r.trade_name || null, spec: r.spec || null, product_code: r.product_code || null, row_type: r.row_type,
        dim_w: r.dim_w ?? null, dim_d: r.dim_d ?? null, dim_h: r.dim_h ?? null,
        cost_unit_price: r.cost_unit_price || null,
      }
      if (r.id) await supabase.from('estimate_items').update(payload).eq('id', r.id)
      else {
        const { data } = await supabase.from('estimate_items').insert(payload).select('id').single()
        if (data) r.id = (data as any).id
      }
    }
    if (created.size) await loadMaterials()
    // 見積書フィールド（工事場所/工期/有効期限/MEMO/端数調整）も保存
    await supabase.from('estimate_projects').update({
      construction_location: doc.value.construction_location || null, period_text: doc.value.period_text || null,
      margin_rate: doc.value.margin_rate,
      valid_until: doc.value.valid_until || null, memo: doc.value.memo || null, adjustment: Number(doc.value.adjustment) || 0,
    }).eq('id', projectId.value)
    markSaved()   // 保存完了＝離脱ガードの基準を更新（以降は未保存扱いしない）
    savedMsg.value = '保存しました'
    setTimeout(() => (savedMsg.value = ''), 2500)
  } catch (e: any) {
    saveError.value = e?.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

// #3 編集中の離脱ガード: 未保存の明細がある状態で 遷移/タブ閉じ/案件切替 時に確認する
function rowsSig(): string {
  // doc項目は自動保存するため離脱ガードの対象外（明細だけ「保存」ボタン）
  // ★空行は署名に含めない。常に末尾へ空行を補充する仕様なので、含めると
  //   何も打っていないのに「未保存です」と警告が出てしまう。
  return JSON.stringify(rows.value.filter(r => !isBlankRow(r))
    .map(r => [r.location, r.trade_name, r.material_id, r.supplier_id, r.item_name, r.product_code, r.spec,
               r.dim_w, r.dim_d, r.dim_h, r.unit, r.quantity, r.cost_unit_price, r.unit_price]))
}
const savedSig = ref('[]')
function markSaved() { savedSig.value = rowsSig() }   // 「今の明細＝保存済み」とみなす基準を更新
const isDirty = computed(() => !!projectId.value && (rowsSig() !== savedSig.value || removedIds.value.length > 0))
const DIRTY_MSG = '保存していない明細があります。保存せずに移動しますか？'
let lastLoadedProjectId: string | null = null
// ルート遷移（一覧へ戻る・サイドメニュー等）のガード。案件切替は一覧経由＝遷移なのでこれで覆える。
onBeforeRouteLeave(() => (isDirty.value ? window.confirm(DIRTY_MSG) : true))
// タブ閉じ/リロードのガード（ブラウザのネイティブ確認）
function beforeUnload(e: BeforeUnloadEvent) { if (isDirty.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))

onMounted(async () => {
  accountId = await getAccountId()
  await Promise.all([loadProjects(), loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadContractors(), loadSubContacts(), loadCompany(), loadSites()])
  // 一覧から開いた案件（?project=<id>）を初期選択
  const qp = route.query.project
  const pid = Array.isArray(qp) ? qp[0] : qp
  if (pid && projects.value.some(p => p.id === pid)) { projectId.value = pid as string; await loadItems() }
})
</script>

<style scoped>
.page-header { display: flex; align-items: baseline; gap: 16px; }
.page-title { font-size: 22px; font-weight: 700; }
.back-link { font-size: 13px; color: #06864a; text-decoration: none; }
.back-link:hover { text-decoration: underline; }
.bar { display: flex; gap: 10px 28px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.bar-group { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bar label { font-weight: 600; color: #444; }
.bar .input { width: auto; }
.current-project { font-size: 16px; font-weight: 700; color: #222; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
.current-project:hover { background: #f1f5f9; }
.current-project .edit-ic { font-size: 12px; color: #94a3b8; }
.proj-name { font-size: 15px; font-weight: 700; width: 220px; }
/* 新規見積 作成カード */
.new-estimate { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 28px; max-width: 560px; }
.new-estimate h2 { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
.new-estimate .new-row { display: flex; gap: 10px; align-items: center; margin-top: 14px; }
.new-estimate .new-row .input { flex: 1; }
.ok-badge { font-size: 11px; background: #e8fff0; color: #0a8a3a; border-radius: 4px; padding: 2px 8px; font-weight: 700; }
.sel { width: 240px; }
/* 明細のドラッグ並び替え */
.drag-col { width: 28px; }
.drag-handle { cursor: grab; color: #b0b6bd; text-align: center; user-select: none; font-size: 14px; }
.drag-handle:active { cursor: grabbing; }
tr.drag-over td { border-top: 2px solid #06C755; }
/* #6 ビルダーのタブ */
.builder-tabs { display: flex; gap: 4px; border-bottom: 2px solid #eee; margin-bottom: 16px; flex-wrap: wrap; }
.btab { border: none; background: transparent; color: #666; padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; }
.btab:hover { color: #222; }
.btab.active { color: #06864a; border-bottom-color: #06C755; }
.btab.ghost { margin-left: auto; color: #555; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 0; padding: 7px 14px; }
.btab.ghost:hover { background: #f5f5f5; }
/* #4 右ドロワー */
.drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 200; display: flex; justify-content: flex-end; }
.drawer { width: min(1200px, 96vw); height: 100%; background: #f7f8f7; box-shadow: -4px 0 16px rgba(0,0,0,.15); display: flex; flex-direction: column; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e5e5; }
.drawer-subtabs { display: inline-flex; gap: 2px; background: #eef0ee; border-radius: 8px; padding: 3px; }
.dtab { border: none; background: transparent; color: #555; border-radius: 6px; padding: 6px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
.dtab.active { background: #fff; color: #06864a; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.drawer-close { background: #f0f0f0; border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px; }
.grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 14px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel-head h2 { font-size: 15px; margin: 0; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { border-bottom: 1px solid #eee; padding: 6px 8px; font-size: 13px; text-align: left; }
.table th.num, .table td.num { text-align: right; }
.input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; width: 100%; box-sizing: border-box; }
.input.sm { width: 90px; }
.input.num { text-align: right; }
.amount { font-variant-numeric: tabular-nums; }
.actions-row { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.btn-primary { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-weight: 600; cursor: pointer; }
.btn-primary:disabled { opacity: .6; cursor: default; }
.btn-add { background: #eef7f0; color: #06864a; border: 1px solid #bfe3cd; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.btn-add:disabled { opacity: .4; cursor: not-allowed; background: #f3f4f6; color: #9ca3af; border-color: #e5e7eb; }
.btn-del { background: none; border: none; color: #c00; font-size: 16px; cursor: pointer; }
.trade-add { display: flex; gap: 8px; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #ddd; }
.grand td { font-weight: 700; border-top: 2px solid #333; }
.empty { color: #999; text-align: center; padding: 14px; }
.hint { color: #777; }
.err { color: #c00; font-size: 13px; }
.ok { color: #06864a; font-size: 13px; }
.pdf-panel { margin-top: 16px; }
.pdf-preview { background: #fff; color: #111; padding: 24px; border: 1px solid #ddd; max-width: 760px; }
/* 見積書情報の入力フォーム */
.doc-form { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 16px; }
.doc-field { display: flex; flex-direction: column; gap: 4px; }
.doc-field label { font-size: 11px; font-weight: 700; color: #888; }
.doc-field .input { width: 200px; }
.doc-field.wide .input { width: 420px; }
/* ── 見積書(サンプル様式・A4横向き) ── */
/* プレビューはページブロック[data-pdf-page]単位。各ブロックを横A4比率(約297:210)で表示し、
   PDFはブロックごとに改ページ（1=表紙/2=内訳書/3〜=工種明細）。 */
.pdf-panel { overflow-x: auto; }
.panel-head .pager { display: flex; align-items: center; gap: 8px; margin-left: auto; margin-right: 12px; }
.pg-btn { width: 30px; height: 30px; border: 1px solid #cbd5e1; background: #fff; border-radius: 6px; font-size: 16px; line-height: 1; cursor: pointer; color: #334155; }
.pg-btn:hover:not(:disabled) { background: #f1f5f9; }
.pg-btn:disabled { opacity: .4; cursor: default; }
.pg-ind { font-size: 13px; color: #555; font-variant-numeric: tabular-nums; min-width: 76px; text-align: center; }
.pdf-preview.est-doc { max-width: none; width: 1056px; padding: 0; border: none; background: transparent; }
.est-doc { font-size: 12px; color: #111; }
.est-doc [data-pdf-page] { width: 1056px; min-height: 740px; box-sizing: border-box; background: #fff; border: 1px solid #ddd; padding: 28px 32px; }
.est-doc [data-pdf-page] + [data-pdf-page] { margin-top: 14px; }
.est-title { text-align: center; font-size: 26px; letter-spacing: 8px; margin: 0 0 4px; font-weight: 700; }
.est-date { text-align: right; font-size: 12px; }
.est-client { font-size: 18px; border-bottom: 2px solid #333; padding: 6px 4px; margin: 6px 0 14px; }
.est-head { display: grid; grid-template-columns: 1.3fr 1.4fr auto; gap: 14px; align-items: start; }
.est-amounts { display: flex; flex-direction: column; gap: 4px; }
.est-amounts .welfare { text-align: right; font-size: 11px; }
.est-amounts .band { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; background: #ddd; padding: 6px 8px; }
.est-amounts .band.sub { background: #eee; }
.est-amounts .band .big { text-align: center; font-size: 20px; font-weight: 700; }
.est-amounts .band .big.sm { font-size: 14px; }
.est-amounts .band .rgt { font-size: 11px; }
.est-issuer .cname { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.est-issuer div { line-height: 1.5; }
.est-seal { border-collapse: collapse; }
.est-seal th, .est-seal td { border: 1px solid #333; width: 42px; height: 22px; font-size: 10px; text-align: center; }
.est-seal td { height: 44px; }
.est-seal img { max-width: 40px; max-height: 40px; }
.est-applied { font-weight: 700; margin: 14px 0; }
.est-cols { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; }
.est-l .kv { display: grid; grid-template-columns: 90px 1fr; border-bottom: 1px solid #333; padding: 8px 2px; }
.est-l .kv span { font-weight: 700; }
.est-l .sepn { margin-top: 16px; font-weight: 700; }
.est-r .rh { font-weight: 700; margin: 4px 0; }
.est-r .rb { border-bottom: 1px solid #ccc; min-height: 22px; padding: 2px; white-space: pre-wrap; }
.est-bd { margin-top: 22px; }
.bd-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
.bd-table { width: 100%; border-collapse: collapse; }
.bd-table th, .bd-table td { border: 1px solid #bbb; padding: 5px 6px; font-size: 11px; text-align: left; }
.bd-table th { background: #ddd; text-align: center; }
.bd-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.bd-table .r { text-align: right; font-weight: 700; }
.bd-table .neg { color: #c00; }
.bd-table tfoot .bd-grand td { font-weight: 700; border-top: 2px solid #333; }
.est-detail { margin-top: 16px; }
.est-detail .dh { font-weight: 700; background: #f0f4f1; padding: 4px 8px; border-left: 4px solid #06C755; }
.est-detail .dsub { font-weight: 600; color: #444; font-size: 11px; }
.pdf-title { text-align: center; font-size: 22px; letter-spacing: 4px; margin: 0 0 16px; }
.pdf-meta { font-size: 13px; line-height: 1.7; margin-bottom: 10px; }
.pdf-client { font-size: 15px; font-weight: 700; }
.pdf-total { font-size: 16px; font-weight: 700; border: 2px solid #333; display: inline-block; padding: 6px 14px; margin: 8px 0 16px; }
.pdf-group { margin-bottom: 14px; }
.pdf-group-head { font-weight: 700; background: #f0f4f1; padding: 5px 8px; border-left: 4px solid #06C755; }
.pdf-sub { font-weight: 600; color: #444; font-size: 13px; }
.pdf-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
.pdf-table th, .pdf-table td { border: 1px solid #ccc; padding: 4px 6px; font-size: 12px; text-align: left; }
.pdf-table th.num, .pdf-table td.num { text-align: right; }
.pdf-grand { text-align: right; font-size: 16px; font-weight: 700; border-top: 2px solid #333; padding-top: 8px; margin-top: 8px; }
.ocr-panel { margin-bottom: 16px; }
.ocr-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.ocr-row label.btn-add { cursor: pointer; }
.ocr-row label.btn-add.disabled { opacity: .6; pointer-events: none; }
.muted { color: #888; font-size: 12px; }
.btn-primary.sm { padding: 4px 12px; font-size: 13px; }
.badge-new { display: inline-block; margin-left: 6px; font-size: 11px; background: #fde68a; color: #92400e; border-radius: 4px; padding: 1px 6px; }
.diff { color: #06864a; font-weight: 700; }
.actions { white-space: nowrap; }
.rev-alert { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
.settings-panel { margin-top: 20px; }
.settings-head { font-size: 16px; font-weight: 700; color: #333; display: flex; align-items: center; gap: 10px; margin: 4px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #eee; }
.settings-toggle { width: 100%; text-align: left; background: #f7f7f7; border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 16px; font-size: 14px; font-weight: 600; color: #444; cursor: pointer; display: flex; align-items: center; gap: 10px; }
.settings-toggle:hover { background: #f0f0f0; }
.settings-toggle .chev { margin-left: auto; color: #888; }
.settings-body { padding: 14px 4px 4px; }
.subtabs { display: inline-flex; gap: 2px; background: #eef0ee; border-radius: 8px; padding: 3px; margin-bottom: 8px; }
.subtab { border: none; background: transparent; color: #555; border-radius: 6px; padding: 6px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
.subtab:hover { color: #222; }
.subtab.active { background: #fff; color: #06864a; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.setting-block { padding: 12px 0; border-bottom: 1px dashed #e5e5e5; }
.setting-block:last-child { border-bottom: none; }
.setting-block h3 { font-size: 14px; margin: 0 0 8px; }
/* 明細テーブル: 列を詰めすぎず、はみ出したら横スクロール。プルダウンは読める幅に */
.grid > .panel:first-child { overflow-x: auto; }
.table th, .table td { white-space: nowrap; }
.table select.input { min-width: 120px; }
.table input.input { min-width: 90px; }
.table input.input.num { min-width: 64px; }
/* 設定欄の入力はゆとりある幅（プレースホルダー見切れ防止） */
.setting-block .input { width: auto; min-width: 160px; }
.setting-block .input.num { min-width: 100px; }
.ocr-row { align-items: center; }
.price-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 8px; }
.ptab { border: 1px solid #d1d5db; background: #fff; color: #555; border-radius: 999px; padding: 4px 14px; font-size: 13px; cursor: pointer; }
.ptab:hover { background: #f3f4f6; }
.ptab.active { background: #06C755; color: #fff; border-color: #06C755; }
.ptab-add { border-style: dashed; color: #06864a; }
.add-methods { display: flex; gap: 24px; flex-wrap: wrap; margin: 12px 0 4px; }
.method { display: flex; flex-direction: column; gap: 6px; }
.method-label { font-size: 12px; font-weight: 600; color: #555; }
.sub-h { font-size: 13px; font-weight: 700; color: #444; margin: 16px 0 6px; }
.rev-section { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; margin-top: 12px; }
.ocr-progress { margin-top: 8px; max-width: 460px; }
.ocr-bar { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.ocr-bar-fill { height: 100%; background: linear-gradient(90deg, #06C755, #34d399); border-radius: 999px; transition: width .8s ease; }
.ocr-status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #444; margin-top: 6px; }
.spin { width: 14px; height: 14px; border: 2px solid #cbd5e1; border-top-color: #06C755; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #555; white-space: nowrap; }
.send-block { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ddd; }
.send-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.send-row .input.sm { min-width: 200px; width: auto; }
.send-to { font-weight: 700; color: #333; }
.muted-link { font-size: 12px; color: #06864a; }
.send-history { margin-top: 12px; }
.head-actions { display: flex; gap: 10px; align-items: center; }
.btn-ghost { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.btn-ghost:hover { background: #f5f5f5; }
/* ページ送り（プレビュー直上・中央） */
.pager-row { display: flex; justify-content: center; align-items: center; gap: 12px; margin: 6px 0 10px; }
.pager-row .pg-btn { width: auto; padding: 6px 14px; font-size: 13px; }
.doc-saved { align-self: center; }
/* メール送信ダイアログ */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 210; display: flex; align-items: center; justify-content: center; }
.send-modal { background: #fff; border-radius: 12px; padding: 24px; width: min(560px, 92vw); max-height: 88vh; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.send-modal h3 { font-size: 17px; font-weight: 700; margin: 0; }
.send-modal .field { display: flex; flex-direction: column; gap: 6px; }
.send-modal .field > label { font-size: 12px; font-weight: 700; color: #888; }
.send-modal textarea.input { width: 100%; resize: vertical; line-height: 1.6; }
.send-modal .input { width: 100%; }
.recipient { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 4px 0; cursor: pointer; }
.recipient.off { color: #aaa; cursor: not-allowed; }
.modal-actions { display: flex; gap: 12px; margin-top: 4px; }
.btn-cancel { background: #f5f5f5; color: #555; border: none; border-radius: 8px; padding: 10px 18px; cursor: pointer; }
.po-split { margin-top: 16px; }
.po-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 10px; }
.po-card { border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.po-card-head { display: flex; justify-content: space-between; align-items: baseline; }
.po-sup { font-weight: 700; }
.po-tot { font-size: 12px; color: #666; }
.po-card .input.sm { width: 100%; min-width: 0; }
.po-card-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.po-card-foot .btn-primary.sm { margin-left: auto; }
.badge-ok { font-size: 11px; background: #e8fff0; color: #0a8a3a; border-radius: 4px; padding: 2px 8px; font-weight: 700; }
.po-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.pdf-link { color: #1a6fc4; text-decoration: none; font-size: 12px; }
.pdf-link:hover { text-decoration: underline; }
/* 発注書PDF生成用プレビュー: 画面外に置いて html2canvas で取り込む */
.po-print { position: absolute; left: -10000px; top: 0; width: 760px; background: #fff; color: #111; padding: 24px; }

/* ── 見積明細: 原価/客先の分離・粗利プレビュー（Excelの操作感に寄せる）── */
.row-tools { display: flex; align-items: center; gap: 8px; }
.margin-field { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #555; margin-right: 8px; }
.input.xs { width: 52px; padding: 4px 6px; font-size: 12px; }
.margin-hint { color: #aaa; font-size: 11px; }
.btn-link-sm { background: none; border: none; color: #06A050; font-size: 11px; cursor: pointer; padding: 0; text-decoration: underline; }
.est-items .cost-col { background: #f7f8fa; }          /* 原価側は地色を変えて客先側と区別 */
.est-items thead .cost-col { background: #eceff3; }
.est-items .overridden { border-color: #F59E0B; background: #FFFBEB; font-weight: 700; }  /* 手打ち上書き中 */
.btn-revert { background: none; border: none; color: #B45309; cursor: pointer; font-size: 12px; padding: 0 2px; }
.hdr-row td { background: #eef6f0; }
.hdr-input { font-weight: 700; border: none; background: transparent; }
.margin-preview-row td { border-top: none; padding-top: 0; }
.margin-preview-row .mp-label { text-align: right; font-size: 11px; color: #999; padding-right: 8px; }
.mp-cells { display: flex; gap: 4px; justify-content: flex-end; }
.mp-cell { display: inline-flex; flex-direction: column; align-items: center; gap: 1px;
  border: 1px solid #e0e0e0; border-radius: 5px; background: #fff; cursor: pointer; padding: 2px 8px; }
.mp-cell:hover { border-color: #06A050; background: #f2fbf5; }
.mp-cell.active { border-color: #06A050; background: #e8f9ef; }
.mp-pct { font-size: 10px; color: #888; }
.mp-val { font-size: 12px; font-weight: 700; color: #333; }
.cost-summary { display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  background: #f7f8fa; border: 1px solid #e6e8eb; border-radius: 6px; padding: 8px 12px; margin: 10px 0 0; }
.cs-item { display: inline-flex; align-items: baseline; gap: 6px; }
.cs-l { font-size: 11px; color: #888; }
.cs-v { font-size: 14px; font-weight: 700; color: #333; }
.cs-note { margin-left: auto; font-size: 11px; color: #aaa; }
.items-scroll { overflow-x: auto; }
.qr-pages { font-size: 12px; color: #555; white-space: nowrap; }
.hist-wrap { display: inline-flex; align-items: stretch; }
.hist-src { border: 1px solid #D5DEE8; border-left: 0; border-radius: 0 6px 6px 0; background: #fff; cursor: pointer; padding: 0 6px; color: #4A7BC8; }
.hist-src:hover { background: #EEF4FF; }
/* R6: もしかして候補・商品情報 */
.dym { display: block; margin-top: 3px; font-size: 11px; color: #7A8AA0; }
.dym-pick { margin-left: 4px; padding: 1px 6px; border: 1px solid #C7D2DE; border-radius: 10px; background: #fff; cursor: pointer; font-size: 11px; }
.dym-pick:hover { background: #EEF4FF; border-color: #4A7BC8; }
.pinfo-row td { background: #FBFCFD; }
.pinfo { display: flex; gap: 10px; align-items: flex-start; padding: 4px 0; }
.pinfo-img { width: 64px; height: 64px; object-fit: contain; border: 1px solid #E2E8F0; border-radius: 6px; background: #fff; }
.pinfo-body { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.pinfo-maker { font-weight: 700; color: #333; }
.pinfo-line { color: #555; }
.pinfo-none { color: #999; }
.pinfo-links { display: flex; gap: 8px; }
.pinfo-link { font-size: 11px; color: #2F6FD0; }
.pinfo-note { font-size: 10px; color: #A0AEC0; }
.na-cell { color: #C0C8D2; font-size: 12px; padding-left: 6px; }
.hc-alt { display: block; font-size: 10px; color: #B45309; }
.pinfo-ask { display: block; margin-top: 3px; padding: 1px 6px; border: 1px solid #D5DEE8; border-radius: 10px; background: #fff; cursor: pointer; font-size: 11px; color: #4A7BC8; }
.pinfo-ask:hover { background: #EEF4FF; border-color: #4A7BC8; }

/* ── R8: 図面のページ選択→送信 ── */
.att-drop { border: 1px dashed #C7D2DE; border-radius: 8px; padding: 10px 12px; transition: background .12s, border-color .12s; }
.att-drop.over { border-color: #4A7BC8; background: #EEF4FF; }
.dsend-tools { display: flex; align-items: center; gap: 12px; margin: 8px 0; flex-wrap: wrap; }
.dsend-range { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #555; }
.dsend-count { font-size: 12px; color: #7A8AA0; margin-left: auto; }
.dsend-pages { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; padding: 6px; background: #FAFBFC; border-radius: 6px; }
.pg-chip { min-width: 40px; padding: 6px 8px; border: 1px solid #D5DEE8; border-radius: 6px; background: #fff; cursor: pointer; font-size: 12px; }
.pg-chip.on { background: #2F6FD0; border-color: #2F6FD0; color: #fff; font-weight: 700; }
.pg-chip.focus { outline: 2px solid #F0A500; }
.dsend-preview { margin-top: 10px; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; }
.dsp-head { padding: 6px 10px; background: #F5F7FA; font-size: 12px; color: #555; }
.dsp-frame { width: 100%; height: 420px; border: 0; display: block; }
.dsend-contacts { display: flex; flex-wrap: wrap; gap: 12px; }
.cc-check { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
.dsend-to { font-size: 12px; color: #7A8AA0; word-break: break-all; }

/* ── 明細のブロック（場所×工種）── */
.blk-row td { background: #EEF2F7; border-top: 2px solid #D5DEE8; padding: 6px 8px; }
.blk-fields { display: flex; align-items: center; gap: 8px; }
.blk-input { min-width: 180px; font-weight: 600; background: #fff; }
.blk-sep { color: #90A4B8; font-weight: 700; }
.blk-count { font-size: 11px; color: #7A8AA0; }
.blk-del { margin-left: auto; }
.area-row td { background: #E3EAF3; border-top: 2px solid #C3D0E0; padding: 6px 8px; }
.area-label { font-size: 11px; color: #5A6C82; font-weight: 700; }
.area-input { min-width: 200px; font-weight: 700; background: #fff; }
.area-add { margin-left: 4px; }
.blk-indent { padding-left: 22px; }
.dim-col { width: 62px; }
.input.xs.num { width: 56px; }
.blk-add-row td { padding: 10px 8px; background: #FAFBFC; }
/* 列が多いので詰める。入力欄は列幅に追従させる */
.est-items { min-width: 1180px; }
.est-items th, .est-items td { padding: 5px 6px; font-size: 12px; }
.est-items .input { padding: 5px 6px; font-size: 12px; }
.est-items .input.sm { min-width: 0; }
/* ── Q5 案件情報 ── */
.intake-panel { max-width: 900px; }
.intake-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.ifield { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #555; }
.ifield.wide { grid-column: 1 / -1; }
.sub-h { font-size: 13px; margin: 0; color: #555; }
.due-badge { align-self: flex-start; font-size: 11px; font-weight: 700; border-radius: 10px; padding: 2px 8px; margin-top: 2px; }
.due-badge.ok   { background: #e8f9ef; color: #06A050; }
.due-badge.soon { background: #FEF3C7; color: #B45309; }
.due-badge.over { background: #FEE2E2; color: #B91C1C; }
.intake-note { font-size: 12px; color: #B45309; background: #FEF3C7; border: 1px solid #FDE68A;
  border-radius: 6px; padding: 8px 10px; margin: 12px 0 0; line-height: 1.6; }
.att-row { display: flex; align-items: center; gap: 10px; }
.att-pick { cursor: pointer; }
.att-list { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 4px; }
.att-list li { display: flex; align-items: center; gap: 6px; }
.att-name { background: none; border: none; color: #06A050; cursor: pointer; text-decoration: underline;
  font-size: 13px; padding: 0; text-align: left; }
/* ── Q3 相見積 ── */
.qr-badge { font-size: 11px; font-weight: 700; border-radius: 10px; padding: 2px 8px; white-space: nowrap; }
.qr-badge.ok   { background: #e8f9ef; color: #06A050; }
.qr-badge.wait { background: #f3f4f6; color: #6b7280; }
.qr-badge.soon { background: #FEF3C7; color: #B45309; }
.qr-badge.over { background: #FEE2E2; color: #B91C1C; }
.cmp-block { border-top: 1px solid #eee; padding: 10px 0; }
.cmp-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.cmp-title { font-weight: 700; font-size: 13px; }
.cmp-warn { font-size: 11px; color: #B45309; background: #FEF3C7; border: 1px solid #FDE68A;
  border-radius: 6px; padding: 2px 8px; }
.cmp-cards { display: flex; gap: 8px; flex-wrap: wrap; }
.cmp-card { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; position: relative;
  border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; cursor: pointer; padding: 8px 12px; min-width: 150px; }
.cmp-card:hover { border-color: #06A050; }
.cmp-card.selected { border-color: #06A050; background: #e8f9ef; }
.cmp-card.cheapest { box-shadow: 0 0 0 1px #06A05033 inset; }
.cc-sub { font-size: 11px; color: #666; }
.cc-price { font-size: 16px; font-weight: 700; color: #222; }
.cc-price small { font-size: 11px; font-weight: 400; color: #888; }
.cc-meta { font-size: 10px; color: #999; }
.cc-tag { position: absolute; top: -7px; right: 6px; font-size: 10px; font-weight: 700;
  background: #FEF3C7; color: #B45309; border-radius: 8px; padding: 1px 6px; }
.cc-tag.sel { right: auto; left: 6px; background: #06A050; color: #fff; }
/* Q4 過去単価の候補 */
.hist-row td { border-top: none; padding-top: 0; }
.hist-label { text-align: right; font-size: 11px; color: #999; padding-right: 8px; }
.hist-cells { display: flex; gap: 4px; flex-wrap: wrap; }
.hist-cell { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0;
  border: 1px solid #e0e0e0; border-radius: 5px; background: #fff; cursor: pointer; padding: 2px 8px; }
.hist-cell:hover { border-color: #06A050; background: #f2fbf5; }
.hc-top { font-size: 11px; font-weight: 700; color: #333; }
.hc-sub { font-size: 10px; color: #999; }
</style>
