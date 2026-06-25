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
        <button v-else class="btn-add" data-testid="promote-open" @click="openPromote">🏗 受注して現場化</button>
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
    <datalist id="est-materials">
      <option v-for="m in materials" :key="m.id" :value="m.name" />
    </datalist>

    <template v-if="projectId">
      <div class="builder-tabs">
        <button class="btab" :class="{ active: builderTab === 'items' }" data-testid="tab-items" @click="builderTab = 'items'">明細入力</button>
        <button class="btab" :class="{ active: builderTab === 'preview' }" data-testid="tab-preview" @click="builderTab = 'preview'">見積書プレビュー</button>
        <button class="btab" :class="{ active: builderTab === 'po' }" data-testid="tab-po" @click="builderTab = 'po'">商社へ発注</button>
        <button class="btab ghost" data-testid="open-drawer" @click="openDrawer">⚙ マスタ・自社情報</button>
      </div>

      <div v-show="builderTab === 'items'">
      <div class="grid">
        <!-- 明細入力 -->
        <section class="panel">
          <div class="panel-head">
            <h2>明細入力</h2>
            <button class="btn-add" data-testid="add-row" @click="addRow">＋ 行追加</button>
          </div>
          <table class="table">
            <thead>
              <tr><th class="drag-col"></th><th>場所</th><th>工種</th><th>品名</th><th>単位</th><th class="num">数量</th><th>商社</th><th class="num">単価</th><th class="num">金額</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r._k"
                  :class="{ 'drag-over': dragOverIndex === i && dragIndex !== null && dragIndex !== i }"
                  @dragover.prevent="dragOverIndex = i" @drop="onDrop(i)" @dragleave="dragOverIndex = null">
                <td class="drag-handle" draggable="true" title="ドラッグで並び替え" :data-testid="`item-drag-${i}`" @dragstart="onDragStart(i)" @dragend="onDragEnd">⠿</td>
                <td><input v-model="r.location" class="input sm" :data-testid="`item-loc-${i}`" /></td>
                <td>
                  <select v-model="r.trade_id" class="input sm" :data-testid="`item-trade-${i}`">
                    <option :value="null">—</option>
                    <option v-for="t in trades" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                </td>
                <td><input v-model="r.item_name" class="input" :data-testid="`item-name-${i}`" list="est-materials" autocomplete="off" @change="resolveMaterial(r)" @blur="resolveMaterial(r)" /></td>
                <td><input v-model="r.unit" class="input sm" :data-testid="`item-unit-${i}`" placeholder="m²/個 等" /></td>
                <td class="num"><input v-model.number="r.quantity" type="number" step="0.01" class="input sm num" :data-testid="`item-qty-${i}`" /></td>
                <td>
                  <select v-model="r.supplier_id" class="input sm" :data-testid="`item-supplier-${i}`" @change="onSupplierPick(r)">
                    <option :value="null">—</option>
                    <option v-for="p in pricesForMaterial(r.material_id)" :key="p.supplier_id" :value="p.supplier_id">{{ p.supplierName }} ¥{{ p.unit_price.toLocaleString('ja-JP') }}</option>
                  </select>
                </td>
                <td class="num"><input v-model.number="r.unit_price" type="number" class="input sm num" :data-testid="`item-price-${i}`" /></td>
                <td class="num amount" :data-testid="`item-amount-${i}`">{{ yen(lineAmount(r)) }}</td>
                <td><button class="btn-del" @click="removeRow(i)">×</button></td>
              </tr>
              <tr v-if="rows.length === 0"><td colspan="10" class="empty">「＋ 行追加」で明細を入力</td></tr>
            </tbody>
          </table>
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
            <button class="btn-ghost" data-testid="open-send" @click="openSendDialog">✉ メール送信</button>
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

        <!-- ✉ メール送信ダイアログ（件名・本文・複数宛先） -->
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

      <div v-show="builderTab === 'po'">
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
              <a v-if="poFor(g.supplierId)?.pdf_path" :href="poPdfUrl(poFor(g.supplierId)!.pdf_path)" target="_blank" rel="noopener" class="pdf-link" :data-testid="`po-pdf-${g.supplierId}`">📄 PDFを表示/DL</a>
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
import EstimateMasters from './estimate-masters.vue'
import CompanyProfile from './company-profile.vue'

const BUCKET = 'expense-receipts'
const IS_DEV = import.meta.env.DEV
const route  = useRoute()   // 一覧から ?project=<id> で開いた案件を初期選択する
// #6 ビルダーのタブ（明細入力／見積書プレビュー／商社へ発注）
const builderTab = ref<'items' | 'preview' | 'po'>('items')
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
type Material = { id: string; name: string; unit: string | null; code: string | null }
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
  unit: string
  quantity: number
  unit_price: number
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
const doc     = ref<{ construction_location: string; period_text: string; valid_until: string; memo: string; adjustment: number }>(
  { construction_location: '', period_text: '', valid_until: '', memo: '', adjustment: 0 })

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')
const lineAmount = (r: Row) => (Number(r.quantity) || 0) * (Number(r.unit_price) || 0)

// 工種別の自動集計（明細を入れるだけで集計＝手コピペ撲滅）
const byTrade = computed(() => {
  const m = new Map<string, { tradeId: string | null; tradeName: string; total: number; key: string }>()
  for (const r of rows.value) {
    const tid = r.trade_id ?? null
    const name = tid ? (trades.value.find(t => t.id === tid)?.name ?? '(不明)') : '(工種未設定)'
    const key = tid ?? 'none'
    const cur = m.get(key) ?? { tradeId: tid, tradeName: name, total: 0, key }
    cur.total += lineAmount(r)
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ja'))
})
const grandTotal = computed(() => rows.value.reduce((s, r) => s + lineAmount(r), 0))

// E2 帳票PDF: 工種別に明細をまとめた印刷プレビュー用データ
const groupedDetailed = computed(() => {
  const m = new Map<string, { key: string; tradeName: string; total: number; items: Row[] }>()
  for (const r of rows.value) {
    const tid = r.trade_id ?? null
    const name = tid ? (trades.value.find(t => t.id === tid)?.name ?? '(不明)') : '(工種未設定)'
    const key = tid ?? 'none'
    const cur = m.get(key) ?? { key, tradeName: name, total: 0, items: [] as Row[] }
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
  const [moved] = arr.splice(from, 1)
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
// 発注書PDFのURL（プレビュー/ダウンロード）と送信日時表示
function poPdfUrl(path: string) { return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }
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
    const path = `estimates/${accountId}/${projectId.value}-${Date.now()}.pdf`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, pdf.output('blob'), { upsert: true, contentType: 'application/pdf' })
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
        pdf_path: path, total_amount: Math.round(grandTotal.value), project_name: currentProjectName.value,
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
    const path = `purchase-orders/${accountId}/${orderId}.pdf`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'application/pdf' })
    if (upErr) throw upErr
    await supabase.from('purchase_orders').update({ pdf_path: path }).eq('id', orderId)
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
    .select('id, name, unit, code').eq('account_id', accountId).order('name')
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
async function loadCompany() {
  const { data } = await supabase.from('settings').select('key, value').eq('account_id', accountId).in('key', COMPANY_KEYS)
  company.value = Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
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
    .select('id, subcontractor_id, subcontractor_contact_id, order_number, total_amount, email_sent_at, pdf_path, status')
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
function resolveMaterial(r: Row) {
  const nm = (r.item_name || '').trim().toLowerCase()
  if (!nm) { r.material_id = null; return }
  const m = materials.value.find(x => x.name.trim().toLowerCase() === nm)
  if (m) {
    r.material_id = m.id
    if (!r.unit && m.unit) r.unit = m.unit
  } else {
    r.material_id = null
  }
  // 材料に単価の無い商社選択はクリア
  if (r.supplier_id && !matPrices.value.some(p => p.material_id === r.material_id && p.supplier_id === r.supplier_id)) {
    r.supplier_id = null
  }
}
async function loadItems() {
  rows.value = []
  removedIds.value = []
  doc.value = { construction_location: '', period_text: '', valid_until: '', memo: '', adjustment: 0 }
  lastLoadedProjectId = projectId.value
  if (!projectId.value) { markSaved(); return }
  const [{ data }, { data: pj }] = await Promise.all([
    supabase.from('estimate_items')
      .select('id, category_id, trade_id, material_id, supplier_id, item_name, unit, quantity, unit_price, note')
      .eq('project_id', projectId.value).order('sort_order'),
    supabase.from('estimate_projects')
      .select('construction_location, period_text, valid_until, memo, adjustment').eq('id', projectId.value).single(),
  ])
  rows.value = (data ?? []).map((d: any) => ({
    id: d.id, _k: ++rowKey, location: d.note ?? '', trade_id: d.trade_id, material_id: d.material_id ?? null,
    supplier_id: d.supplier_id ?? null, item_name: d.item_name, unit: d.unit ?? '',
    quantity: Number(d.quantity) || 0, unit_price: Number(d.unit_price) || 0,
  }))
  doc.value = {
    construction_location: pj?.construction_location ?? '', period_text: pj?.period_text ?? '',
    valid_until: pj?.valid_until ?? '', memo: pj?.memo ?? '', adjustment: Number(pj?.adjustment) || 0,
  }
  currentPage.value = 0   // 案件を開いたら先頭ページへ
  editingName.value = false
  builderTab.value = 'items'
  markSaved()
  sendContactIds.value = []
  await Promise.all([loadSends(), loadProjectPOs()])
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

function addRow() {
  rows.value.push({ id: null, _k: ++rowKey, location: '', trade_id: null, material_id: null, supplier_id: null, item_name: '', unit: '', quantity: 0, unit_price: 0 })
}
function removeRow(i: number) {
  const r = rows.value[i]
  if (r.id) removedIds.value.push(r.id)
  rows.value.splice(i, 1)
}

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
      const nm = (r.item_name || '').trim()
      if (!nm || nm === '(無題)') continue
      const key = nm.toLowerCase()
      if (!r.material_id && known.has(key)) r.material_id = known.get(key)!
      if (!r.material_id && created.has(key)) r.material_id = created.get(key)!
      if (!r.material_id) {
        const { data } = await supabase.from('estimate_materials')
          .insert({ account_id: accountId, name: nm, unit: r.unit || null, trade_id: r.trade_id, source: 'manual' })
          .select('id').single()
        if (data) { r.material_id = (data as any).id; created.set(key, r.material_id!) }
      }
    }
    // upsert（amount は生成列なので送らない）
    let order = 0
    for (const r of rows.value) {
      const payload: any = {
        account_id: accountId, project_id: projectId.value,
        trade_id: r.trade_id, material_id: r.material_id, supplier_id: r.supplier_id, item_name: r.item_name || '(無題)',
        unit: r.unit || null, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0,
        note: r.location || null, sort_order: order++,
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
  return JSON.stringify(rows.value.map(r => [r.location, r.trade_id, r.material_id, r.supplier_id, r.item_name, r.unit, r.quantity, r.unit_price]))
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
</style>
