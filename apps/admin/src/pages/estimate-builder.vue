<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">見積もり</h1>
      <RouterLink to="/estimate-list" class="back-link" data-testid="back-to-list">← 見積一覧へ</RouterLink>
    </div>

    <!-- 案件を開いている時のバー（案件名の編集・元請け・別案件の新規作成） -->
    <!-- ★R51: 新規のステップ式フロー中は出さない（順番に入れてもらう画面なので情報を足さない） -->
    <div v-if="projectId && !wizard.on" class="bar">
      <div class="bar-group">
        <label>案件</label>
        <span v-if="!editingName" class="current-project" data-testid="project-select" title="クリックで名称変更" @click="startRename">{{ currentProjectName }} <span class="edit-ic">✎</span></span>
        <input v-else v-model="projectNameEdit" class="input proj-name" data-testid="project-name-input" @keyup.enter="commitRename" @blur="commitRename" />
        <!-- ★R52: 案件名を入れずにステップを飛ばした案件は、仮名のまま帳票に出ると困る。
             クリックで直せることをその場で伝える（一覧でも「下書き」と出る）。 -->
        <span v-if="isDraftProject" class="draft-warn" data-testid="project-draft-warn">案件名が未入力です（クリックして入力）</span>
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
        <!-- ★R55: マスタ編集の共通ルール（docs/design/master-editing-rules.md）に従い、
             元請け・担当者はこの画面から直せるようにする。設定画面へ飛ばすと
             書きかけの見積から離れることになり、実際にブラウザバックで入力が消えていた。 -->
        <button class="btn-edit" data-testid="con-add-open" @click="openContractorModal(null)">＋ 元請けを追加</button>
        <button v-if="currentContractorId" class="btn-edit" data-testid="con-edit-open" @click="openContractorModal(currentContractorId)">
          <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">edit</span> 担当者を編集
        </button>
        <RouterLink to="/contractors" class="muted-link">元請けマスタ全体</RouterLink>
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

    <!-- ★R55: 元請け・担当者をこの画面から編集する（マスタ編集の共通ルール）。
         追加した瞬間に選択肢へ反映する（閉じてから再読込では入力の流れが切れる）。
         ★担当者を候補から消しても、既に送信済みの見積の宛先記録は書き換えない。 -->
    <div v-if="conModal" class="modal-overlay" data-testid="con-modal" @click.self="conModal = null">
      <div class="send-modal">
        <h3>{{ conModal.id ? '元請けを編集' : '元請けを追加' }}</h3>
        <div class="field">
          <label>元請け業者名</label>
          <input v-model="conModal.name" class="input" data-testid="con-name" placeholder="例: 〇〇建設" />
        </div>
        <div class="field">
          <label>担当者（見積書の送信先候補）</label>
          <div v-for="(c, ci) in conModal.contacts" :key="ci" class="con-contact-row">
            <input v-model="c.name" class="input" :data-testid="`con-contact-name-${ci}`" placeholder="担当者名" />
            <input v-model="c.email" class="input" :data-testid="`con-contact-email-${ci}`" placeholder="メールアドレス" />
            <button class="btn-del" :data-testid="`con-contact-del-${ci}`" @click="conModal.contacts.splice(ci, 1)">×</button>
          </div>
          <button class="btn-link-sm" data-testid="con-contact-add" @click="conModal.contacts.push({ id: null, name: '', email: '' })">＋ 担当者を追加</button>
          <p class="hint">担当者をここから消しても、<strong>既に送った見積の宛先記録は変わりません</strong>（候補に出なくなるだけ）。</p>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" :disabled="conSaving || !conModal.name.trim()" data-testid="con-save" @click="saveContractorModal">
            {{ conSaving ? '保存中…' : '保存してこの案件の元請けにする' }}
          </button>
          <button class="btn-cancel" @click="conModal = null">キャンセル</button>
        </div>
        <span v-if="conErr" class="err" data-testid="con-err">{{ conErr }}</span>
      </div>
    </div>

    <!-- E5 マスタ蓄積: 入力済み材料を予測変換候補に（案件選択前から常時ロード） -->
    <datalist id="est-material-codes"><option v-for="c in materialCodeOptions" :key="c" :value="c" /></datalist>
          <datalist id="est-materials">
      <option v-for="m in materials" :key="m.id" :value="m.name" />
    </datalist>

    <!-- ══════════════════════════════════════════════════════════
         ★R51: 新規見積のステップ式フロー
         実際の業務は「元請けから図面が来る」から始まる。案件名を先に打つ形は
         手元にある物と順番が合っておらず、案件名を考えるところで止まっていた。
         図面 → 案件名（ファイル名から自動）→ 依頼日・提出期限 → 元請け の順に置く。
         どのステップも飛ばせる（図面が無い案件・元請けが未定の案件が実際にある）。
         ══════════════════════════════════════════════════════════ -->
    <template v-if="projectId && wizard.on">
      <div class="wiz" data-testid="wizard">
        <div class="wiz-steps">
          <!-- ★タブを押して行き来できる（2026-08-19）。どのステップも元から飛ばせる作りなので、
               進むしかできないのは不自然だった。戻って直す時に「戻る」を何度も押さずに済む。 -->
          <button v-for="s in WIZ_STEPS" :key="s.n" type="button" class="wiz-step"
                  :class="{ on: wizard.step === s.n, done: wizard.step > s.n }"
                  :data-testid="`wiz-step-${s.n}`" @click="goStep(s.n)">
            {{ s.n }}. {{ s.label }}
          </button>
          <!-- ★ステップの中から解析を始めた時も進捗が見えるようにする（2026-08-19）。
               ここに無いと、一番押される「材料を抽出」から始めた時だけ何も出なかった。 -->
          <ExtractProgressChips :project-id="projectId" :quantity-busy="dqty.busy"
                                :quantity-done="dqty.done" :quantity-total="dqty.total" />
          <button class="btn-link-sm wiz-exit" data-testid="wiz-exit" @click="finishWizard()">ステップ入力をやめて明細へ</button>
        </div>

        <!-- 1. 図面 -->
        <section v-if="wizard.step === 1" class="panel" data-testid="wiz-panel-1">
          <div class="panel-head"><h2>① 図面を追加</h2></div>
          <p class="hint">
            元請けから来た図面を先に置きます。<strong>案件名は図面のファイル名から自動で入ります</strong>（次のステップで直せます）。
          </p>
          <div class="att-row att-drop" :class="{ over: attDragOver }" data-testid="wiz-dropzone"
               @dragover.prevent="attDragOver = true" @dragleave="attDragOver = false" @drop.prevent="onWizardDrop">
            <label class="btn-excel att-pick">
              <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">upload_file</span>
              図面を選ぶ
              <input type="file" multiple accept=".pdf,image/*" hidden data-testid="wiz-file" @change="onWizardFiles" />
            </label>
            <span class="hint">ここにドラッグ&ドロップでも追加できます</span>
            <span v-if="attBusy" class="hint">アップロード中…</span>
            <span v-if="attErr" class="err">{{ attErr }}</span>
          </div>
          <ul v-if="attachments.length" class="att-list" data-testid="wiz-att-list">
            <li v-for="a in attachments" :key="a.id">
              <!-- 図面の表紙。押すと別タブで開く（クリック領域を名前と揃える） -->
              <button v-if="attThumbs[a.id]" class="att-thumb" :data-testid="`wiz-att-thumb-${a.id}`" @click="openAttachment(a)">
                <img :src="attThumbs[a.id]" :alt="a.name || a.path" />
              </button>
              <button class="att-name" @click="openAttachment(a)">{{ a.name || a.path }}</button>
              <button class="btn-del" @click="removeAttachment(a)">×</button>
            </li>
          </ul>
          <!-- ★並びは全ステップ共通で 戻る → スキップ → 次へ（2026-08-19）。
               進む向きに左から右へ並べる。1つ目は戻り先が無いので戻るは出さない。 -->
          <div class="wiz-actions">
            <button class="btn-cancel" data-testid="wiz-skip-1" @click="wizard.step = 2">図面は後で（スキップ）</button>
            <button class="btn-primary" :disabled="!attachments.length" data-testid="wiz-next-1" @click="wizard.step = 2">次へ</button>
          </div>
        </section>

        <!-- 2. 案件名（自動入力）＋ 材料抽出 -->
        <section v-else-if="wizard.step === 2" class="panel" data-testid="wiz-panel-2">
          <div class="panel-head"><h2>② 案件名の確認</h2></div>
          <label class="ifield wide"><span>案件名（図面のファイル名から自動で入れました・直せます）</span>
            <input v-model="wizard.name" class="input" data-testid="wiz-name" placeholder="例: 〇〇ビル改修" />
          </label>
          <span v-if="wizard.err" class="err" data-testid="wiz-err">{{ wizard.err }}</span>

          <!-- ★図面ごとに小さなボタンが名前の横に並ぶだけで、何を押せばいいのか分からなかった
               （2026-08-19 大塚さん向け通しレビュー）。図面1件を1枚のカードにして、
               表紙・ファイル名・ボタンを縦に揃える。ボタンはこのステップの主役なので大きく出す。 -->
          <template v-if="pdfAttachments.length">
            <div class="ext-offer" data-testid="wiz-ext-offer">
              <h3 class="sub-h">図面から材料と数量を読み取る（任意）</h3>
              <p class="hint">
                図面に書かれた品番・数量をAIが読み取って、明細の下地を作ります。
                <strong>始めたあとは他の入力を続けて構いません</strong>（進み具合はこのボタンに出ます）。
              </p>
              <ul class="ext-cards" data-testid="wiz-ext-list">
                <li v-for="a in pdfAttachments" :key="a.id" class="ext-card">
                  <button v-if="attThumbs[a.id]" class="ext-thumb" @click="openAttachment(a)">
                    <img :src="attThumbs[a.id]" :alt="a.name || a.path" />
                  </button>
                  <div v-else class="ext-thumb ext-thumb-empty">
                    <span class="material-symbols-rounded">description</span>
                  </div>
                  <span class="ext-name" :title="a.name || a.path">{{ a.name || a.path }}</span>
                  <ExtractControl :att="a" @start="beginExtractFromWizard" @review="openExtractResult" />
                </li>
              </ul>
            </div>
          </template>

          <div class="wiz-actions">
            <button class="btn-cancel" data-testid="wiz-back-2" @click="wizard.step = 1">戻る</button>
            <button class="btn-cancel" data-testid="wiz-skip-2" @click="wizard.step = 3">スキップ</button>
            <button class="btn-primary" data-testid="wiz-next-2" @click="commitWizardName">次へ</button>
          </div>
        </section>

        <!-- 3. 依頼日・提出期限 -->
        <section v-else-if="wizard.step === 3" class="panel" data-testid="wiz-panel-3">
          <div class="panel-head"><h2>③ 元請けからの依頼日・提出期限</h2></div>
          <p class="hint">提出期限を入れておくと、残り日数が案件情報タブと一覧に出ます。</p>
          <div class="intake-grid">
            <label class="ifield"><span>元請けからの依頼日</span>
              <input v-model="intake.request_date" type="date" class="input" data-testid="wiz-request-date" @change="saveIntake" />
            </label>
            <label class="ifield"><span>元請けへの提出期限</span>
              <input v-model="intake.due_date" type="date" class="input" data-testid="wiz-due-date" @change="saveIntake" />
            </label>
          </div>
          <div class="wiz-actions">
            <button class="btn-cancel" data-testid="wiz-back-3" @click="wizard.step = 2">戻る</button>
            <button class="btn-cancel" data-testid="wiz-skip-3" @click="wizard.step = 4">まだ決まっていない（スキップ）</button>
            <button class="btn-primary" data-testid="wiz-next-3" @click="wizard.step = 4">次へ</button>
          </div>
        </section>

        <!-- 4. 元請け情報 -->
        <section v-else class="panel" data-testid="wiz-panel-4">
          <div class="panel-head"><h2>④ 元請け情報</h2></div>
          <p class="hint">見積書の送信先になります。<strong>登録が無ければここで追加できます</strong>（別の画面に移りません）。</p>
          <div class="ifields">
            <label class="ifield"><span>元請け</span>
              <select :value="currentContractorId || ''" class="input" data-testid="wiz-contractor"
                      @change="setProjectContractor(($event.target as HTMLSelectElement).value || null)">
                <option value="">（未設定）</option>
                <option v-for="c in contractors" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </label>
            <div class="ifield">
              <span>&nbsp;</span>
              <span class="wiz-con-btns">
                <button class="btn-edit" data-testid="wiz-con-add" @click="openContractorModal(null)">＋ 元請けを追加</button>
                <button v-if="currentContractorId" class="btn-edit" data-testid="wiz-con-edit" @click="openContractorModal(currentContractorId)">担当者を編集</button>
              </span>
            </div>
          </div>
          <div class="wiz-actions">
            <button class="btn-cancel" data-testid="wiz-back-4" @click="wizard.step = 3">戻る</button>
            <button class="btn-cancel" data-testid="wiz-skip-4" @click="finishWizard()">元請けは後で（スキップ）</button>
            <button class="btn-primary" data-testid="wiz-finish" @click="finishWizard()">入力を終えて明細へ</button>
          </div>
        </section>
      </div>
    </template>

    <template v-else-if="projectId">
      <div class="builder-tabs">
        <button class="btab" :class="{ active: builderTab === 'intake' }" data-testid="tab-intake" @click="builderTab = 'intake'">案件情報</button>
        <button class="btab" :class="{ active: builderTab === 'quotes' }" data-testid="tab-quotes" @click="builderTab = 'quotes'">相見積</button>
        <button class="btab" :class="{ active: builderTab === 'items' }" data-testid="tab-items" @click="builderTab = 'items'">明細入力</button>
        <!-- ★R36: 表示/非表示トグルだと明細のスペースを圧迫するので独立タブにする -->
        <button class="btab" :class="{ active: builderTab === 'breakdown' }" data-testid="tab-breakdown" @click="builderTab = 'breakdown'">工種別内訳</button>
        <button class="btab" :class="{ active: builderTab === 'preview' }" data-testid="tab-preview" @click="builderTab = 'preview'">見積書プレビュー</button>
        <!-- 発注は受注してからしか発生しない。受注前に出ていると紛らわしいので隠す（レビュー2026-07-28） -->
        <button v-if="isOrdered" class="btab" :class="{ active: builderTab === 'po' }" data-testid="tab-po" @click="builderTab = 'po'">商社へ発注</button>
        <!-- ★R53: 解析中はどのタブに居ても進捗が見えるようにする。
             案件情報タブの図面一覧にしか出さないと、明細を打っている間は進んでいるか分からない。
             ★同じものをステップ式の画面にも出す（部品側のコメント参照・2026-08-19） -->
        <ExtractProgressChips :project-id="projectId" :quantity-busy="dqty.busy"
                              :quantity-done="dqty.done" :quantity-total="dqty.total" />
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
              <button v-if="attThumbs[a.id]" class="att-thumb" :data-testid="`intake-att-thumb-${a.id}`" @click="openAttachment(a)">
                <img :src="attThumbs[a.id]" :alt="a.name || a.path" />
              </button>
              <button class="att-name" :data-testid="`intake-att-${a.id}`" @click="openAttachment(a)">{{ a.name || a.path }}</button>
              <!-- R8: 図面はページごとに工種が分かれている。該当ページだけ業者へ送る -->
              <button v-if="isPdf(a)" class="btn-edit" :data-testid="`dsend-open-${a.id}`" @click="openDrawingSend(a)">ページを選んで送る</button>
              <!-- ★案件の図面からそのまま材料を抽出する。独立ページ(/drawing-materials)は
                   案件に紐づかない用途（受注前の当たり付け等）で残す。
                   ★R53: 解析はモーダルで拘束せず、進捗だけ出して裏で進める。 -->
              <template v-if="isPdf(a)">
                <ExtractControl :att="a" @start="beginExtract" @review="openExtractResult" />
                <!-- ★Q7: 材料(品番)とは別に「凡例に書かれた確定数量」を取る。
                     床/置床/天井の面積・建具/器具の台数は設計者が凡例に明記しているので拾い直さない。 -->
                <!-- ★前に解析した図面かどうかがボタンで分かるようにする。
                     結果は保存されているのに、押すまで何も見えないと「消えた」としか見えない
                     （2026-08-19 通しレビューでの指摘）。 -->
                <button class="btn-edit" :disabled="dqty.busy" :data-testid="`dqty-open-${a.id}`" @click="openQuantityExtract(a)">
                  <template v-if="dqty.busy && dqty.att?.id === a.id">数量抽出中… {{ dqty.done }}/{{ dqty.total }}</template>
                  <template v-else-if="qtySavedCount[a.id]">数量を見る（前回 {{ qtySavedCount[a.id] }}件）</template>
                  <template v-else>数量を抽出</template>
                </button>
              </template>
              <button class="btn-del" :data-testid="`intake-att-del-${a.id}`" @click="removeAttachment(a)">×</button>
            </li>
          </ul>
          <p v-else class="hint">まだ図面がありません。元請けから受け取った図面をここに置いておくと、見積作成時に参照できます。</p>
        </section>

        <!-- ★実施図面からの材料抽出。抽出結果を明細へ流し込む出口を作る。
             これまでは独立ページでCSV書き出しまでで、明細には手で打ち直していた。
             ★R53: モーダルではなくパネル。解析中も閉じても構わない（裏で進む）。 -->
        <section v-if="dext.att" class="panel" data-testid="dext-panel">
          <div class="panel-head">
            <h2>材料の抽出結果 — {{ dext.att.name || dext.att.path }}</h2>
            <button class="btn-cancel" data-testid="dext-close" @click="closeExtract">閉じる</button>
          </div>
          <p class="hint">
            図面に書かれたメーカー品番をAIが読み取ります。
            <strong>チェックした行だけ</strong>を明細に入れます。<br>
            ★図面には「(仮)」の品番や<strong>中止になったのに綴じられたままの詳細図</strong>が混ざります。
            全部そのまま入れると中止項目まで計上してしまうので、必ず人が選んでください。
          </p>
          <div v-if="dextJob?.status === 'running'" class="pinfo-loading" data-testid="dext-busy">
            <span class="spin-dot"></span> 解析中… ページ {{ dextJob.done }}/{{ dextJob.total }}（この画面を閉じても続きます）
          </div>
          <div v-else-if="dextJob?.status === 'paused'" class="hint" data-testid="dext-paused">
            {{ dextJob.done }}/{{ dextJob.total }}ページまで完了しています。
            <button class="btn-primary sm" data-testid="dext-resume-panel" @click="beginExtract(dext.att)">残りを続ける</button>
          </div>
          <div v-if="!dext.rows.length && dextJob?.status !== 'running'" class="hint" data-testid="dext-empty">
            {{ dextJob ? '品番は見つかりませんでした' : '「解析する」で図面を読み取ります' }}
          </div>
          <div v-if="dext.rows.length" class="items-scroll dext-list">
            <table class="table">
              <thead><tr><th></th><th>P</th><th>部位</th><th>メーカー</th><th>品番</th><th>規格サイズ</th><th>仕様</th><th>数量</th><th>備考</th></tr></thead>
              <tbody>
                <tr v-for="(r, ri) in dext.rows" :key="ri" :data-testid="`dext-row-${ri}`">
                  <td><input type="checkbox" v-model="r._pick" :data-testid="`dext-pick-${ri}`" /></td>
                  <td>{{ r.page }}</td>
                  <td>{{ r.part }}</td>
                  <td>{{ r.manufacturer }}</td>
                  <td><input v-model="r.code" class="input sm" :data-testid="`dext-code-${ri}`" /></td>
                  <td>{{ r.size }}</td>
                  <td>{{ r.spec }}</td>
                  <td>{{ r.quantity }}</td>
                  <td class="dext-note">{{ r.note }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="actions-row">
            <button v-if="!dextJob" class="btn-primary" data-testid="dext-run" @click="beginExtract(dext.att)">解析する</button>
            <template v-if="dext.rows.length">
              <button class="btn-link-sm" data-testid="dext-all" @click="dext.rows.forEach(r => r._pick = true)">全選択</button>
              <button class="btn-link-sm" data-testid="dext-none" @click="dext.rows.forEach(r => r._pick = false)">全解除</button>
              <button class="btn-primary" :disabled="!dextPicked.length || dextApplying" data-testid="dext-apply" @click="applyExtractToItems">
                <template v-if="dextApplying"><span class="spin-dot"></span> 明細に入れています…</template>
                <template v-else>選んだ {{ dextPicked.length }} 件を明細に入れる</template>
              </button>
            </template>
            <span v-if="dextJob?.error" class="err" data-testid="dext-err">{{ dextJob.error }}</span>
          </div>
        </section>

        <!-- ★Q7: 凡例の確定数量の抽出結果。材料(品番)の抽出とは別パネル。 -->
        <section v-if="dqty.att" class="panel" data-testid="dqty-panel">
          <div class="panel-head">
            <h2>数量の抽出結果 — {{ dqty.att.name || dqty.att.path }}</h2>
            <button class="btn-cancel" data-testid="dqty-close" @click="dqty.att = null">閉じる</button>
          </div>
          <p class="hint">
            図面の<strong>凡例に書かれている数量</strong>（床・置床・天井の面積／建具・器具の台数／紙管の本数）をそのまま読み取ります。
            面積を図面から計算するのではなく、<strong>設計者が明記した確定値</strong>を転記します。<br>
            ★<strong>壁は対象外</strong>です（壁は面積が図面に無いため）。
            ★図面に「平面図数量の為、ロスは見込んでください」とある通り、<strong>ロス率は人が付けてください</strong>。
          </p>

          <div v-if="dqty.busy" class="pinfo-loading" data-testid="dqty-busy">
            <span class="spin-dot"></span> 解析中… ページ {{ dqty.done }}/{{ dqty.total }}
          </div>
          <p v-if="dqty.error" class="err" data-testid="dqty-err">{{ dqty.error }}</p>
          <!-- ★前回の結果を出している時は、解析し直すかを人が決められるようにする。
               毎回AIを呼ぶと待たされるうえ費用もかかる（2026-08-19）。 -->
          <p v-if="!dqty.busy && dqty.rows.length" class="hint" data-testid="dqty-saved-note">
            前回の抽出結果を表示しています。
            <button class="btn-link-sm" data-testid="dqty-rerun" @click="beginQuantityExtract(dqty.att)">もう一度解析する</button>
          </p>
          <!-- ★失敗したページだけやり直せるようにする。以前は1ページの504で全体が止まり、
               残りのページが丸ごと未処理のまま終わっていた（2026-08-18 通しレビューで発生）。 -->
          <ul v-if="dqty.failed.length" class="dqty-failed" data-testid="dqty-failed-pages">
            <li v-for="fp in dqty.failed" :key="fp.pageNo">
              <span>P.{{ fp.pageNo }} — {{ fp.errorMsg }}</span>
              <button class="btn-retry-sm" :disabled="fp.retrying" data-testid="dqty-retry-page" @click="retryQuantityPage(fp)">
                {{ fp.retrying ? '再試行中…' : '再試行' }}
              </button>
            </li>
          </ul>

          <!-- ★検算: 天井合計 ≒ 通り芯面積。抽出漏れ・二重計上を機械で拾う -->
          <p v-if="dqty.check && !dqty.busy"
             :class="['dqty-check', dqty.check.warn ? 'dqty-check-warn' : (dqty.check.available ? 'dqty-check-ok' : 'dqty-check-na')]"
             :data-testid="dqty.check.warn ? 'dqty-check-warn' : 'dqty-check'">
            <span class="material-symbols-rounded dqty-check-icon">{{ dqty.check.warn ? 'error' : (dqty.check.available ? 'check_circle' : 'help') }}</span>
            {{ dqty.check.message }}
          </p>

          <div v-if="!dqty.rows.length && !dqty.busy" class="hint" data-testid="dqty-empty">
            凡例から数量を読み取れませんでした。図面に数量表が無い場合はこの機能では取れません（壁と同じく人が拾う必要があります）。
          </div>

          <div v-if="dqty.rows.length" class="items-scroll dext-list">
            <table class="table">
              <!-- ★符号と品番は別の列で見せる。同じ列にまとめると、明細へ入れた後で
                   どちらが単価を引く鍵なのか分からなくなる（2026-08-19） -->
              <thead><tr><th></th><th>P</th><th>部位</th><th>符号</th><th>品番</th><th>仕様</th><th class="num">数量</th><th>単位</th><th>備考</th></tr></thead>
              <tbody>
                <tr v-for="(r, ri) in dqty.rows" :key="ri" :data-testid="`dqty-row-${ri}`">
                  <td><input type="checkbox" v-model="r._pick" :data-testid="`dqty-pick-${ri}`" /></td>
                  <td>{{ r.page }}</td>
                  <td>{{ r.part }}</td>
                  <td>{{ r.code }}</td>
                  <td><input v-model="r.maker_code" class="input sm" placeholder="—" :data-testid="`dqty-maker-${ri}`" /></td>
                  <td>{{ r.spec || '—' }}</td>
                  <td class="num">{{ r.value }}</td>
                  <td>{{ r.unit }}</td>
                  <td>{{ r.note || '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="panel-actions">
            <template v-if="dqty.rows.length">
              <button class="btn-link-sm" data-testid="dqty-all" @click="dqty.rows.forEach(r => r._pick = true)">全選択</button>
              <button class="btn-link-sm" data-testid="dqty-none" @click="dqty.rows.forEach(r => r._pick = false)">全解除</button>
              <button class="btn-primary" :disabled="!dqtyPicked.length || dqtyApplying" data-testid="dqty-apply" @click="applyQuantityToItems">
                <!-- ★件数が多いと数秒かかる。何も出ないと押せていないと思って連打される
                     （2026-08-19 通しレビューでの指摘）。 -->
                <template v-if="dqtyApplying"><span class="spin-dot"></span> 明細に入れています…</template>
                <template v-else>選んだ {{ dqtyPicked.length }} 件を明細に入れる</template>
              </button>
            </template>
            <span v-if="dqty.msg" class="ok-msg" data-testid="dqty-msg">{{ dqty.msg }}</span>
          </div>
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
              <!-- ★R38: 「ページ指定」の入力欄は廃止。サムネイルで中身を見て選べるようになった今は
                   同じことを2通りで指定でき、かえって混乱を招く（レビュー2026-07-29）。 -->
              <button class="btn-link-sm" data-testid="dsend-all" @click="selectAllPages(true)">全選択</button>
              <button class="btn-link-sm" data-testid="dsend-none" @click="selectAllPages(false)">全解除</button>
              <!-- ★R37: 図面の見やすさは環境で変わるので、列数を人が変えられるようにする -->
              <span class="dsend-cols">表示
                <button v-for="n in [2, 3, 4, 5, 6]" :key="n" class="col-btn" :class="{ on: thumbCols === n }"
                        :data-testid="`dsend-cols-${n}`" @click="thumbCols = n">{{ n }}</button>
                列
              </span>
              <span class="dsend-count" data-testid="dsend-count">{{ dsend.selected.length }} / {{ dsend.pageCount }} ページ</span>
            </div>
            <div class="dsend-thumbs" data-testid="dsend-thumbs"
                 :style="{ gridTemplateColumns: `repeat(${thumbCols}, minmax(0, 1fr))` }">
              <div v-for="p in dsend.pageCount" :key="p" class="pg-card"
                   :class="{ on: dsend.selected.includes(p) }"
                   :data-testid="`dsend-page-${p}`" :data-page="p"
                   @click="togglePage(p)">
                <div class="pg-thumb">
                  <img v-if="dsend.thumbs[p]" :src="dsend.thumbs[p]" :alt="`P.${p}`" :data-testid="`dsend-thumb-${p}`" />
                  <span v-else class="pg-loading">…</span>
                </div>
                <label class="pg-foot" @click.stop>
                  <input type="checkbox" :checked="dsend.selected.includes(p)"
                         :data-testid="`dsend-check-${p}`" @change="togglePage(p)" />
                  <span>P.{{ p }}</span>
                </label>
              </div>
            </div>
            <p class="hint">クリックで選択／拡大して見たいページは <button class="btn-link-sm" data-testid="dsend-preview-open" @click="previewPage(dsend.selected[0] ?? 1)">下に大きく表示</button> できます。</p>
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
              <!-- ★R48: 依頼行の工種名が空のまま作られていたので、送信時に入れておく。
                   任意（後から相見積タブでも直せる）。 -->
              <label class="ifield"><span>工種（見積依頼に記録・任意）</span>
                <input v-model="dsend.trade" class="input" list="dsend-trade-options" data-testid="dsend-trade" placeholder="例: 軽鉄工事" />
                <datalist id="dsend-trade-options">
                  <option v-for="t in trades" :key="t.id" :value="t.name" />
                </datalist>
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
                      <option value=""></option>
                      <option v-for="k in PRICE_KINDS" :key="k.key" :value="k.key">{{ k.label }}</option>
                    </select>
                    <!-- ★R46: 区分が未選択の行にだけ推定を出す。押すまで確定しない。
                         根拠（人工の有無・定価比）を併記しないと人が判断できない。 -->
                    <button v-if="kindGuessOf(l)" type="button" class="kind-guess"
                            :data-testid="`ql-kind-guess-${li}`"
                            :title="`${kindLabel(kindGuessOf(l)!.kind)} と推定：${kindGuessOf(l)!.reason}（押すと採用）`"
                            @click="applyKindGuess(l)">
                      推定: {{ kindLabel(kindGuessOf(l)!.kind) }}
                      <span class="kind-guess-why">{{ kindGuessOf(l)!.reason }}</span>
                    </button>
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
              <!-- ★R44: 添付した見積書から項目・単位・単価を読み取って下書きにする。
                   これまでは添付を残すだけで単価は手打ちだった。 -->
              <button class="btn-edit" :disabled="qocr.busy" :data-testid="`qf-ocr-${f.id}`" @click="readQuoteFile(f)">
                {{ qocr.busy && qocr.fileId === f.id ? `読み取り中… ${qocr.done}/${qocr.total}` : '見積書を読み取る' }}
              </button>
              <button class="btn-del" :data-testid="`qf-del-${f.id}`" @click="removeQuoteFile(f)">×</button>
            </li>
          </ul>

          <!-- ★読み取り結果は「下書き」。人が選んで初めて受領明細に入る（勝手に確定しない） -->
          <div v-if="qocr.rows.length || qocr.err" class="qocr-panel" data-testid="qocr-panel">
            <div class="panel-head" style="margin-top:12px">
              <h3 class="sub-h">読み取り結果（下書き・チェックした行だけ明細に入ります）</h3>
              <button class="btn-cancel" data-testid="qocr-close" @click="qocr.rows = []; qocr.err = ''">閉じる</button>
            </div>
            <p v-if="qocr.err" class="err" data-testid="qocr-err">{{ qocr.err }}</p>
            <p v-else class="hint">
              合計・値引き・消費税の行は取り込みません。<strong>単価の区分が読めなかった行は空</strong>のままなので、
              明細に入れてから選んでください（区分が違う業者を横並びにすると誤選定します）。
            </p>
            <div v-if="qocr.rows.length" class="items-scroll">
              <table class="table est-items">
                <thead><tr><th></th><th>P</th><th>項目</th><th>形状・詳細</th><th>単位</th><th class="num">数量</th><th class="num">単価</th><th>区分</th><th>備考</th></tr></thead>
                <tbody>
                  <tr v-for="(r, ri) in qocr.rows" :key="ri" :data-testid="`qocr-row-${ri}`">
                    <td><input type="checkbox" v-model="r._pick" :data-testid="`qocr-pick-${ri}`" /></td>
                    <td>{{ r.page }}</td>
                    <td>{{ r.item_name }}</td>
                    <td>{{ r.spec || '—' }}</td>
                    <td>{{ r.unit || '—' }}</td>
                    <td class="num">{{ r.quantity ?? '—' }}</td>
                    <td class="num">{{ r.unit_price != null ? yen(r.unit_price) : '—' }}</td>
                    <td>{{ r.price_kind ? kindLabel(r.price_kind) : '—' }}</td>
                    <td>{{ r.note || '' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="qocr.rows.length" class="actions-row">
              <button class="btn-link-sm" data-testid="qocr-all" @click="qocr.rows.forEach(r => r._pick = true)">全選択</button>
              <button class="btn-link-sm" data-testid="qocr-none" @click="qocr.rows.forEach(r => r._pick = false)">全解除</button>
              <button class="btn-primary" :disabled="!qocrPicked.length" data-testid="qocr-apply" @click="applyQuoteOcr">
                選んだ {{ qocrPicked.length }} 件を明細に入れる
              </button>
              <span v-if="qocr.msg" class="ok-msg" data-testid="qocr-msg">{{ qocr.msg }}</span>
            </div>
          </div>
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
      <div class="grid grid-wide">
        <!-- 明細入力 -->
        <section class="panel">
          <div class="panel-head">
            <h2>明細入力</h2>
            <!-- ★抽出結果を入れた直後はこのタブに移るので、結果の知らせもここに出す
                 （案件情報タブに出すと、移った先で何も言われないまま行が増えて見える） -->
            <span v-if="dext.msg" class="ok" data-testid="dext-msg">{{ dext.msg }}</span>
            <div class="row-tools">
              <!-- 粗利率: アカウント既定 ＋ この見積だけ上書き。
                   行ごとの 5/10/15/20% プレビューは 2026-07-28 に一度撤去したが、
                   2026-07-29 の第3回レビューで復活の要望が出たため戻した（ExcelのR〜Y列と同じ形）。 -->
              <button class="btn-link-sm" data-testid="open-cand-name-modal" @click="openCandModal('name')">名称の候補</button>
              <button class="btn-link-sm" data-testid="open-cand-code-modal" @click="openCandModal('code')">品番の候補</button>
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
                <th class="num dim-col">W(t)</th><th class="num dim-col">D(＠)</th><th class="num dim-col">H(L)</th>
                <th class="num">数量</th><th>単位</th>
                <th class="num">単価</th><th class="num">金額</th>
                <th class="cost-col">商社</th><th class="num cost-col">単価原価</th><th class="num cost-col">金額原価</th>
                <!-- ★R32: 粗利パターンはExcelのR〜Y列と同じく行の右端に置く。
                     名称の下に1行使うと明細1行あたり表が2行分の高さになり、
                     縦の情報量を上げたい他の要望（R29/R30）と噛み合わない。 -->
                <th v-for="pct in MARGIN_PRESETS" :key="pct" class="num mp-col">{{ Math.round(pct * 100) }}%</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <!-- ★場所（大項目）> 工種（中項目）> 明細行 の2階層。
                   Excelは「壁面工事」の下に「軽鉄工事」「塗装工事」…と複数の工種がぶら下がる。
                   1場所1工種にすると、同じ場所を工種の数だけ書くことになる（レビュー2026-07-29）。 -->
              <template v-for="(a, ai) in areas" :key="ai">
                <!-- ★R30: 場所の見出しを列見出しの直下に固定する。
                     どの場所・工種を打っているのかがスクロール中も分かる。 -->
                <tr class="area-row sticky-area" :data-testid="`area-row-${ai}`"
                    @dragover.prevent @drop="onDropArea(ai)">
                  <!-- ★R39: 場所ごと掴んで並び替える（配下の工種・明細がまとまって動く） -->
                  <td class="drag-col drag-handle" draggable="true" title="ドラッグで場所ごと並び替え"
                      :data-testid="`area-drag-${ai}`" @dragstart="onDragArea(ai)" @dragend="onDragEnd">⠿</td>
                  <td colspan="18">
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
                <!-- ★R30: 工種の見出しは場所のさらに下に固定。
                     次の工種が来たら押し上げられて入れ替わる（3段目）。 -->
                <tr class="blk-row sticky-trade" :data-testid="`blk-row-${blocks.indexOf(b)}`"
                    @dragover.prevent @drop="onDropBlock(blocks.indexOf(b))">
                  <!-- ★R39: 工種ごと掴んで並び替える。別の場所へ落とせばその場所に移る -->
                  <td class="drag-col drag-handle" draggable="true" title="ドラッグで工種ごと並び替え"
                      :data-testid="`blk-drag-${blocks.indexOf(b)}`" @dragstart="onDragBlock(blocks.indexOf(b))" @dragend="onDragEnd">⠿</td>
                  <td colspan="18">
                    <span class="blk-fields blk-indent">
                      <span class="blk-sep">└</span>
                      <!-- 工種は自由記述＋予測変換（固定マスタからの選択を強制しない） -->
                      <input :value="b.trade_name" class="input sm blk-input" :data-testid="`blk-trade-${blocks.indexOf(b)}`"
                             list="est-trades" autocomplete="off" placeholder="工種（例：軽鉄工事）"
                             @input="onBlockField(b, 'trade_name', ($event.target as HTMLInputElement).value)" />
                      <!-- ★R27: マスタの編集ボタンは「使う場所の近く」に置く。
                           設定画面まで探しに行かせない。 -->
                      <button class="btn-icon" data-testid="open-trade-modal" title="工種の候補を編集" @click="openTradeModal">
                        <span class="material-symbols-rounded ico">edit_note</span>
                      </button>
                      <span class="blk-count">{{ b.filled }}件</span>
                      <button class="btn-del blk-del" :data-testid="`blk-del-${blocks.indexOf(b)}`" title="この工種を削除" @click="removeBlock(b)">×</button>
                    </span>
                  </td>
                </tr>
                <template v-for="i in b.idxs" :key="rows[i]._k">
                <!-- ★R22: セルを離れた時点で保存する。native の change はバブルするので
                     行に1つ付ければ配下の全セル（input/select）を拾える。 -->
                <tr :class="{ 'drag-over': dragOverIndex === i && dragIndex !== null && dragIndex !== i }"
                    @change="autoSaveRow(rows[i])"
                    @dragover.prevent="dragOverIndex = i" @drop="onDrop(i)" @dragleave="dragOverIndex = null">
                  <td class="drag-handle" draggable="true" title="ドラッグで並び替え" :data-testid="`item-drag-${i}`" @dragstart="onDragStart(i)" @dragend="onDragEnd">⠿</td>
                  <td>
                    <input v-model="rows[i].item_name" class="input" :data-testid="`item-name-${i}`" list="est-materials"
                           autocomplete="off" @input="computeDidYouMean(rows[i])"
                           @change="onItemNameChange(rows[i])" @blur="onItemNameChange(rows[i])" />
                    <!-- ★R6: 表記ゆれ・打ち間違い用の「もしかして」。予測変換(datalist)は
                         前方一致しか効かないので、似ている既存名を別に出す。 -->
                    <span v-if="didYouMean(rows[i]).length" class="dym" :data-testid="`item-dym-${i}`">
                      もしかして:
                      <button v-for="(c, ci) in didYouMean(rows[i])" :key="c" class="dym-pick"
                              :data-testid="`item-dym-${i}-${ci}`" @click="applyDidYouMean(rows[i], c)">{{ c }}</button>
                    </span>
                  </td>
                  <!-- ★R3: 品番は形状・詳細と別列。品番はメーカー特定・商品情報取得のキーになる -->
                  <td class="code-cell">
                    <input v-model="rows[i].product_code" class="input sm code-in" :data-testid="`item-code-${i}`"
                           list="est-material-codes" autocomplete="off" placeholder="SLP314 等"
                           @change="onCodeChange(rows[i])" @blur="onCodeChange(rows[i])" />
                    <!-- ★R23: 品番の横に虫眼鏡。押した時だけ調べ、結果はモーダルで出す
                         （明細の下に出すと縦に伸びて入力欄が押し下げられる） -->
                    <!-- ★R31: 押しても即モーダルを開かない（調べている間も入力を続けられる）。
                         状態はアイコンで示す: 砂時計=検索中 / 赤バツ=見つからなかった / 青i=結果あり -->
                    <button v-if="isMaterialRow(rows[i])" class="pinfo-ico"
                            :class="pinfoIcon(rows[i]).cls" :data-testid="`item-pinfo-ask-${i}`"
                            :title="pinfoIcon(rows[i]).title" @click="onPinfoClick(rows[i])">
                      <span class="material-symbols-rounded ico">{{ pinfoIcon(rows[i]).name }}</span>
                    </button>
                  </td>
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
                    <template v-else>
                      <select v-model="rows[i].supplier_id" class="input sm" :data-testid="`item-supplier-${i}`" @change="onSupplierPick(rows[i])">
                        <option :value="null">—</option>
                        <!-- ★R41: 「単価表の絶対額」と「定価×掛率」を同じ土俵で並べる -->
                        <option v-for="p in pricesForRow(rows[i].material_id, rows[i].product_code)" :key="p.supplier_id" :value="p.supplier_id">
                          {{ p.supplierName }} ¥{{ p.unit_price.toLocaleString('ja-JP') }}（{{ p.from }}）
                        </option>
                      </select>
                      <!-- ★R42: 最安が一目で分かり、ワンクリックで採用できる（勝手に確定しない） -->
                      <button v-if="cheapestFor(rows[i]) && rows[i].supplier_id !== cheapestFor(rows[i])!.supplier_id"
                              class="cheap-btn" :data-testid="`item-cheapest-${i}`"
                              :title="`最安は ${cheapestFor(rows[i])!.supplierName} ¥${cheapestFor(rows[i])!.unit_price.toLocaleString('ja-JP')}（${cheapestFor(rows[i])!.from}）`"
                              @click="applyCheapest(rows[i])">
                        最安 {{ cheapestFor(rows[i])!.supplierName }} ¥{{ cheapestFor(rows[i])!.unit_price.toLocaleString('ja-JP') }}
                      </button>
                      <span v-else-if="cheapestFor(rows[i])" class="cheap-now" :data-testid="`item-cheapest-now-${i}`">最安</span>
                    </template>
                  </td>
                  <td class="num cost-col"><input v-model.number="rows[i].cost_unit_price" type="number" step="any" class="input sm num" :data-testid="`item-cost-${i}`" @input="onCostInput(rows[i])" /></td>
                  <td class="num cost-col amount" :data-testid="`item-cost-amount-${i}`">{{ yen(lineCostAmount(rows[i])) }}</td>
                  <td v-for="pct in MARGIN_PRESETS" :key="pct" class="num mp-col">
                    <button v-if="(rows[i].cost_unit_price ?? 0) > 0" class="mp-cell"
                            :class="{ active: Math.round(marginPct) === Math.round(pct * 100) }"
                            :data-testid="`item-margin-${i}-${Math.round(pct * 100)}`"
                            :title="`粗利${Math.round(pct * 100)}%の単価を採用`"
                            @click="applyMarginToRow(rows[i], pct)">{{ yen(priceAtMargin(rows[i], pct)) }}</button>
                  </td>
                  <td><button class="btn-del" :data-testid="`item-del-${i}`" @click="removeRow(i)">×</button></td>
                </tr>
                <!-- Q4: この項目の過去の業者別単価（受領登録で貯まったもの）。クリックで原価に採用 -->
                <tr v-if="historyFor(rows[i].item_name).length" class="hist-row">
                  <td></td>
                  <td colspan="18">
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
                <td colspan="19"><button class="btn-add" data-testid="area-add" @click="addArea()">＋ 場所を追加</button></td>
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
            <!-- ★R22: 保存ボタンは廃止（セルを離れた時点で保存済み）。
                 いつ保存されたかだけ出す。 -->
            <span class="autosave" data-testid="autosave-state">
              {{ saving ? '保存中…' : (savedAt ? `保存しました ${savedAt}` : '入力すると自動で保存されます') }}
            </span>
            <span v-if="saveError" class="err">{{ saveError }}</span>
            <!-- ★R33: 消したことに気づけるようにする＋取り消せるようにする -->
            <span v-if="undoRow" class="undo-bar" data-testid="undo-bar">
              「{{ undoRow.row.item_name || '(名称なし)' }}」を削除しました
              <button class="btn-link-sm" data-testid="undo-remove" @click="undoRemoveRow">元に戻す</button>
            </span>

          </div>
        </section>


      </div>

      </div><!-- /tab 明細入力 -->

      <div v-show="builderTab === 'breakdown'">
        <!-- 工種別 自動集計（転記操作なし）。★既定は畳んでおく。
             明細は列が多く、常時2カラムだと入力欄が狭くなる（レビュー2026-07-29）。 -->
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

      <!-- ★R23: 商品情報はモーダルで出す。明細の下に出すと縦に伸びて入力欄が押し下げられる -->
      <div v-if="pinfoModal" class="modal-back" data-testid="pinfo-modal" @click.self="pinfoModal = null">
        <div class="modal-card">
          <div class="modal-head">
            <h3>商品情報 — {{ pinfoModal.product_code || pinfoModal.item_name }}</h3>
            <button class="btn-cancel" data-testid="pinfo-close" @click="pinfoModal = null">閉じる</button>
          </div>
          <div v-if="pinfoBusyKey" class="pinfo-loading" data-testid="pinfo-loading">
            <span class="spin-dot"></span> ネット検索で調べています…
          </div>
          <template v-else-if="pinfoModalInfo">
            <div v-if="pinfoModalInfo.not_found" class="pinfo-none" data-testid="pinfo-none">
              商品情報は見つかりませんでした
            </div>
            <div v-else class="pinfo-body-modal">
              <img v-if="pinfoModalInfo.image_url" :src="pinfoModalInfo.image_url" class="pinfo-img-lg"
                   data-testid="pinfo-img" alt="" @error="pinfoModalInfo!.image_url = null" />
              <dl class="pinfo-dl">
                <template v-if="pinfoModalInfo.maker"><dt>メーカー</dt><dd data-testid="pinfo-maker">{{ pinfoModalInfo.maker }}</dd></template>
                <template v-if="pinfoModalInfo.sizes"><dt>サイズ展開</dt><dd data-testid="pinfo-sizes">{{ pinfoModalInfo.sizes }}</dd></template>
                <template v-if="pinfoModalInfo.spec"><dt>仕様</dt><dd data-testid="pinfo-spec">{{ pinfoModalInfo.spec }}</dd></template>
                <template v-if="(pinfoModalInfo.source_urls ?? []).length"><dt>出典</dt><dd>
                  <a v-for="(u, ui) in pinfoModalInfo.source_urls.slice(0, 3)" :key="ui" :href="u" target="_blank"
                     rel="noopener" class="pinfo-link" :data-testid="`pinfo-src-${ui}`">リンク{{ ui + 1 }}</a>
                </dd></template>
              </dl>
            </div>
            <p class="pinfo-note">AIがWeb検索した内容です。発注前に必ず現物・カタログで確認してください。</p>
          </template>
          <div class="actions-row">
            <button class="btn-ghost" :disabled="!!pinfoBusyKey" data-testid="pinfo-refresh" @click="lookupProductInfo(pinfoModal!, true)">調べ直す</button>
          </div>
        </div>
      </div>

      <!-- ★R21: 名称・品番の候補を画面上で直せるようにする。
           誤入力がそのまま候補に残り続けると、次から間違いを選んでしまう。 -->
      <div v-if="candModal" class="modal-back" data-testid="cand-modal" @click.self="candModal = false">
        <div class="modal-card wide">
          <div class="modal-head">
            <h3>{{ candKind === 'code' ? '品番の候補' : '名称の候補' }}</h3>
            <button class="btn-cancel" data-testid="cand-close" @click="candModal = false">閉じる</button>
          </div>
          <p class="hint">
            候補は<strong>商社単価表</strong>と<strong>過去に打った明細</strong>から作られます。
            打ち間違いが残っている場合はここで直せます。<br>
            ここで消しても、<strong>すでに作った見積の中身は変わりません</strong>（候補に出なくなるだけです）。
          </p>
          <input v-model="candFilter" class="input" placeholder="絞り込み" data-testid="cand-filter" />
          <div class="cand-list">
            <div v-for="(c, ci) in candidatesFiltered" :key="c.name" class="cand-row"
                 :class="{ 'code-first': candKind === 'code' }" :data-testid="`cand-row-${ci}`">
              <!-- 開いた種類の欄を主役にして広く見せる（直したいものがすぐ見つかるように） -->
              <input v-model="c.name" class="input sm" :data-testid="`cand-name-${ci}`" placeholder="名称" />
              <input v-model="c.code" class="input sm" placeholder="品番" :data-testid="`cand-code-${ci}`" />
              <input v-model="c.unit" class="input sm unit-in" placeholder="単位" :data-testid="`cand-unit-${ci}`" />
              <button class="btn-del" :data-testid="`cand-del-${ci}`" title="候補から外す" @click="removeCandidate(c)">×</button>
            </div>
            <p v-if="!candidatesFiltered.length" class="hint">候補がありません</p>
          </div>
          <div class="actions-row">
            <span v-if="candMsg" class="ok" data-testid="cand-msg">{{ candMsg }}</span>
          </div>
        </div>
      </div>

      <!-- ★R27: マスタはページ内のモーダルで編集し、追加した瞬間に候補へ反映する。
           設定画面へ遷移させると、書きかけの見積から離れることになる。 -->
      <div v-if="tradeModal" class="modal-back" data-testid="trade-modal" @click.self="tradeModal = false">
        <div class="modal-card">
          <div class="modal-head">
            <h3>工種の候補</h3>
            <button class="btn-cancel" data-testid="trade-close" @click="tradeModal = false">閉じる</button>
          </div>
          <p class="hint">ここで追加した工種は、<strong>閉じなくてもすぐ候補に出ます</strong>。</p>
          <div class="trade-add">
            <input v-model="newTradeName" class="input" placeholder="工種名（例：軽鉄工事）" data-testid="trade-new-name"
                   @keyup.enter="addTradeInline" />
            <button class="btn-add" :disabled="!newTradeName.trim()" data-testid="trade-add" @click="addTradeInline">追加</button>
          </div>
          <ul class="trade-list" data-testid="trade-list">
            <li v-for="(t, ti) in trades" :key="t.id">
              <input v-model="t.name" class="input sm" :data-testid="`trade-name-${ti}`" @change="renameTrade(t)" />
              <button class="btn-del" :data-testid="`trade-del-${ti}`" @click="removeTrade(t)">×</button>
            </li>
            <li v-if="!trades.length" class="hint">まだ登録がありません</li>
          </ul>
          <span v-if="tradeErr" class="err" data-testid="trade-err">{{ tradeErr }}</span>
        </div>
      </div>

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
        <!-- ★未登録でもここで直接埋める（2026-08-19）。
             以前は未登録の時だけモーダルへ飛ばしていたが、**まさに登録したい時にだけ
             別UIになる**という逆の作りだった。マスタは、それが出る場所のすぐ隣で
             直せるのが一番早い。登録済み/未登録で見た目を変えず、注意書きだけ足す。 -->
        <p v-if="!company.company_name" class="muted warn-inline" data-testid="company-missing">
          自社情報が未登録です。下に入れると、そのまま見積書の発行元になります。
        </p>
        <!-- ★R34: 発行元（自社情報）は見積書のページで直接編集する。
             モーダルを開かせず、出る場所でそのまま直せるようにする。 -->
        <div class="doc-form company-inline" data-testid="company-inline">
          <div class="doc-field"><label>会社名</label>
            <input v-model="companyForm.company_name" class="input" data-testid="ci-name" @change="saveCompanyInline" /></div>
          <div class="doc-field"><label>代表者</label>
            <input v-model="companyForm.company_rep" class="input" data-testid="ci-rep" @change="saveCompanyInline" /></div>
          <div class="doc-field"><label>電話</label>
            <input v-model="companyForm.company_tel" class="input" data-testid="ci-tel" @change="saveCompanyInline" /></div>
          <div class="doc-field wide"><label>住所</label>
            <input v-model="companyForm.company_address" class="input" data-testid="ci-address" @change="saveCompanyInline" /></div>
          <span class="muted company-note">
            <template v-if="company.company_name">発行元: <b data-testid="company-name">{{ company.company_name }}</b> ／ </template>
            印影など細かい設定は<RouterLink to="/company-profile">自社情報ページ</RouterLink>
            <span v-if="companyMsg" class="ok" data-testid="ci-msg">{{ companyMsg }}</span>
          </span>
        </div>
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
              <thead>
                <tr>
                  <th>名　称</th><th>形状・詳細</th>
                  <th class="num">W(t)</th><th class="num">D(＠)</th><th class="num">H(L)</th>
                  <th class="num">数量</th><th>単位</th><th class="num">単　価</th><th class="num">金　額</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(ln, li) in pg" :key="li">
                  <tr v-if="ln.kind === 'area'" class="bd-area"><td colspan="9">{{ ln.text }}</td></tr>
                  <tr v-else-if="ln.kind === 'trade'" class="bd-trade"><td colspan="9">{{ ln.text }}</td></tr>
                  <tr v-else>
                    <td>{{ ln.row.item_name }}</td>
                    <td>{{ ln.row.spec }}</td>
                    <td class="num">{{ ln.row.dim_w ?? '' }}</td>
                    <td class="num">{{ ln.row.dim_d ?? '' }}</td>
                    <td class="num">{{ ln.row.dim_h ?? '' }}</td>
                    <td class="num">{{ ln.row.quantity || '' }}</td>
                    <td>{{ ln.row.unit }}</td>
                    <td class="num">{{ ln.row.unit_price ? yen(ln.row.unit_price) : '' }}</td>
                    <td class="num">{{ ln.row.unit_price ? yen(lineAmount(ln.row)) : '' }}</td>
                  </tr>
                </template>
              </tbody>
              <tfoot v-if="pi === breakdownPages.length - 1">
                <tr><td colspan="8" class="r">小計</td><td class="num">{{ yen(subtotal) }}</td></tr>
                <tr><td>法定福利費</td><td colspan="7">請負金額 × {{ welfareA }}％ × {{ welfareB }}％</td><td class="num">{{ yen(welfare) }}</td></tr>
                <tr v-if="adjustment"><td>端数調整</td><td colspan="7"></td><td class="num" :class="{ neg: adjustment < 0 }">{{ yen(adjustment) }}</td></tr>
                <tr class="bd-grand"><td colspan="8" class="r">合計</td><td class="num">{{ yen(totalExclTax) }}</td></tr>
              </tfoot>
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
            <!-- ★R34: 自社情報のタブは廃止。見積書PDFのページで直接編集する形にした
                 （発行元が出る場所で直せるのが自然で、探しに行かせない）。
                 ここには商社ごとの資材価格表の読み取りだけを残す。 -->
            <div class="drawer-subtabs">
              <button class="dtab active" data-testid="drawer-masters">商社の資材価格表</button>
            </div>
            <button class="drawer-close" data-testid="drawer-close" @click="closeDrawer">閉じる ✕</button>
          </div>
          <div class="drawer-body">
            <EstimateMasters embedded />
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
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { supabase } from '../lib/supabase'
// ★このファイルには別ルールの normalizeName が既にあり、<script setup> 内では
//  ローカル定義が import を隠す。推定側と定価引き側で正規化が食い違うと永久に一致しないので、
//  別名で入れて「推定に使う正規化はこちら」と明示する。
import { guessPriceKind, normalizeName as normalizeGuessName, type Guess } from '../lib/priceKindGuess'
import { getAccountId } from '../lib/account'
import { openDoc } from '../lib/docUrl'
import EstimateMasters from './estimate-masters.vue'
import ExtractControl from '../components/ExtractControl.vue'
import ExtractProgressChips from '../components/ExtractProgressChips.vue'
import { crossCheckCeiling, type CrossCheck, type QuantityPart } from '../lib/drawingQuantity'
// ★R53: 材料抽出の実行はこのコンポーネントの外（モジュールスコープ）で回す。
//  画面遷移で解析が死なないようにするため。
import { jobFor, startExtract, loadJobsForProject, ackJob, refreshExtractBadge, runningJobsOf, type ExtractRow } from '../lib/extractJobs'

const BUCKET = 'expense-receipts'        // 印影など既存公開物の表示用（後方互換）
const PDF_BUCKET = 'admin-docs'          // 新規の見積/発注PDFは非公開バケット（署名URL配信）
const IS_DEV = import.meta.env.DEV
const route  = useRoute()   // 一覧から ?project=<id> で開いた案件を初期選択する
const router = useRouter()  // ステップ入力を終えた時に ?step= を落とす（R51）
// #6 ビルダーのタブ（明細入力／見積書プレビュー／商社へ発注）
// ★R54: 既定は案件情報。新規は「図面 → 依頼日/期限 → 元請け」の順に入れるので、
//  開いた時に案件情報から始まるのが業務の流れと合う（既存案件でも例外を作らない）。
const builderTab = ref<'intake' | 'quotes' | 'items' | 'preview' | 'po'>('intake')
/** ★R52: 案件名がまだ決まっていない下書きか（「＋新規見積」を押した直後の状態） */
const isDraftProject = ref(false)

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

/**
 * R46: 受領見積の行が材工一体か材料のみかを推定する。
 * 定価（R41）と、同じ見積に労務行があるか（Q3の price_kind）を材料に使う。
 * ★区分が既に入っている行では null＝人の選択を上書きしない。
 */
function kindGuessOf(l: QuoteLine): Guess | null {
  return guessPriceKind(
    { item_name: l.item_name, unit_price: l.unit_price, price_kind: l.price_kind },
    openedLines.value.map(x => ({ item_name: x.item_name, unit_price: x.unit_price, price_kind: x.price_kind })),
    listPriceByName,
  )
}
/** 推定を採用する（人が押した時だけ入る＝勝手に確定しない） */
function applyKindGuess(l: QuoteLine) {
  const g = kindGuessOf(l)
  if (g) l.price_kind = g.kind
}

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
    .eq('is_deleted', false).order('sort_order').order('name')
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
// ── ★R44: 受領した見積書PDFを読み取って受領明細の下書きにする ──
//  R5で見積書は添付保存できるようになったが、単価は今も手打ちだった。
//  ★DBには書かない。読み取り結果は下書きで、人がチェックした行だけ明細に入る
//   （価格表OCRと同じ「承認した分だけ反映」の原則。確定は既存の「保存」ボタン）。
type QocrRow = {
  page: number; item_name: string; spec: string | null; unit: string | null
  quantity: number | null; unit_price: number | null; price_kind: string | null; note: string | null; _pick: boolean
}
const qocr = ref<{ fileId: string; busy: boolean; done: number; total: number; rows: QocrRow[]; err: string; msg: string }>(
  { fileId: '', busy: false, done: 0, total: 0, rows: [], err: '', msg: '' })
const qocrPicked = computed(() => qocr.value.rows.filter(r => r._pick))

async function readQuoteFile(f: QuoteFile) {
  if (qocr.value.busy) return
  qocr.value = { fileId: f.id, busy: true, done: 0, total: 0, rows: [], err: '', msg: '' }
  try {
    const { data: file, error } = await supabase.storage.from(DRAWING_BUCKET).download(f.path)
    if (error || !file) throw error ?? new Error('見積書を取得できませんでした')
    const isPdf = /\.pdf$/i.test(f.name || f.path)
    const pages: { b64: string; mime: string }[] = []
    const toB64 = (bytes: Uint8Array) => {
      let bin = ''
      const chunk = 0x8000
      for (let k = 0; k < bytes.length; k += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(k, k + chunk)) as any)
      return btoa(bin)
    }
    if (isPdf) {
      // PDFは1ページずつ送る（複数ページの見積書に対応・1枚が重いとまとめて送れない）
      const { PDFDocument } = await import('pdf-lib')
      const src = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()))
      for (let i = 0; i < src.getPageCount(); i++) {
        const one = await PDFDocument.create()
        const [pg] = await one.copyPages(src, [i])
        one.addPage(pg)
        pages.push({ b64: toB64(await one.save()), mime: 'application/pdf' })
      }
    } else {
      pages.push({ b64: toB64(new Uint8Array(await file.arrayBuffer())), mime: file.type || 'image/jpeg' })
    }
    qocr.value.total = pages.length
    const { data: sess } = await supabase.auth.getSession()
    for (let i = 0; i < pages.length; i++) {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-quote-ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess?.session?.access_token ?? ''}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ image_base64: pages[i].b64, mime: pages[i].mime, page: i + 1 }),
      })
      const j = await resp.json().catch(() => null)
      if (!resp.ok || j?.error) { qocr.value.err = j?.error || `読み取りエラー(${resp.status})`; break }
      for (const l of (j?.lines ?? [])) {
        qocr.value.rows.push({
          page: i + 1, item_name: l.item_name, spec: l.spec ?? null, unit: l.unit ?? null,
          quantity: l.quantity ?? null, unit_price: l.unit_price ?? null,
          price_kind: l.price_kind ?? null, note: l.note ?? null, _pick: true,
        })
      }
      qocr.value.done = i + 1
    }
    if (!qocr.value.rows.length && !qocr.value.err) qocr.value.err = '明細を読み取れませんでした。手入力で追加してください。'
  } catch (e: any) {
    qocr.value.err = e?.message ?? '見積書の読み取りに失敗しました'
  } finally { qocr.value.busy = false }
}

/** 選んだ下書き行を受領明細に入れる（★保存はしない。既存の「保存」ボタンで確定する） */
const qocrApplying = ref(false)
function applyQuoteOcr() {
  if (qocrApplying.value || !openedRequest.value) return
  const picked = qocrPicked.value
  if (!picked.length) return
  qocrApplying.value = true
  try {
    for (const r of picked) {
      openedLines.value.push({
        id: null, _k: ++qlKey, request_id: openedRequest.value.id,
        item_name: r.item_name, spec: r.spec ?? '', unit: r.unit ?? '',
        // ★区分が読めなかった行は既定に倒さず空にする。材工共と労務のみを取り違えると
        //  比較で誤選定するため、人に必ず選ばせる。
        price_kind: r.price_kind ?? '',
        quantity: r.quantity, unit_price: r.unit_price ?? 0, is_selected: false,
      } as any)
    }
    qocr.value.rows = qocr.value.rows.filter(r => !r._pick)
    qocr.value.msg = `${picked.length}件を明細に入れました（内容を確認して「保存」で確定してください）`
    setTimeout(() => { qocr.value.msg = '' }, 2500)
  } finally { qocrApplying.value = false }
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
//  issued  … 元請けへ提出済み。
//            ★R49: 「PDF発行時に自動セット」と書いてあったが、実際に書くコードは無く手動だけだった。
//            見積書を**メール送信した時**に draft からだけ自動で進めるようにした（下記 markIssuedAfterSend）。
//            ローカルへのPDFダウンロード(exportPdf)では進めない＝社内確認のために落としただけで
//            「提出済み」になってしまうと、出していないのに出したことになる。
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
const pdfAttachments = computed(() => attachments.value.filter(isPdf))

// ════════════════════════════════════════════════════════════
//  ★R51: 新規見積のステップ式フロー（図面 → 案件名 → 依頼日/期限 → 元請け）
//
//  なぜこの順番か（2026-07-30 レビュー第5回）:
//   実際の業務は「元請けから図面が来る」から始まる。最初に案件名を要求されると
//   まだ決まっていない名前を考えるところで手が止まり、図面はその後で登録していた。
//   案件名は図面のファイル名からほぼ確定できるので、自動で入れて直せるようにする。
//  ★各ステップはスキップできる。図面が無い案件・元請けが未定の案件が実際にある。
// ════════════════════════════════════════════════════════════
const WIZ_STEPS = [
  { n: 1, label: '図面' }, { n: 2, label: '案件名' },
  { n: 3, label: '依頼日・期限' }, { n: 4, label: '元請け' },
] as const
const wizard = ref<{ on: boolean; step: number; name: string; err: string }>(
  { on: false, step: 1, name: '', err: '' })

/**
 * 図面のファイル名から案件名を起こす。
 * 実ファイル名は「0603　銀座リシャール見積もり.pdf」「20260730_〇〇ビル_実施図面.pdf」のような形。
 * 先頭の日付／末尾の書類名を落として案件名だけ残す。外しても人が直せる前提で強く削る。
 */
function projectNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  let s = base.normalize('NFKC').replace(/[_\-]+/g, ' ')
  s = s.replace(/^\s*\d{4}[-/年]?\d{1,2}[-/月]?\d{1,2}日?\s*/, '')   // 20260730 / 2026-07-30 / 2026年7月30日
  s = s.replace(/^\s*\d{3,4}\s+/, '')                                // 「0603 銀座…」の先頭日付
  s = s.replace(/(見積(もり)?書?|図面|実施図|平面図|意匠図|展開図|一式|最終|改訂?\d*|rev\.?\d*|ver\.?\d*|\(\d+\)|コピー)/gi, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s || base   // 全部削れてしまったら元のファイル名を使う（空にはしない）
}

function onWizardFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  return uploadWizardFiles(files)
}
function onWizardDrop(e: DragEvent) {
  attDragOver.value = false
  return uploadWizardFiles(Array.from(e.dataTransfer?.files ?? []))
}
async function uploadWizardFiles(files: File[]) {
  if (!files.length) return
  // ★案件名を図面のファイル名から起こす。既に何か入っていれば触らない
  //   （人が直した値も、先に入れた図面から起こした値も上書きしない）
  if (!wizard.value.name.trim()) wizard.value.name = projectNameFromFile(files[0].name)
  await uploadAttachments(files)
}

/** 案件名を確定して下書きから外す。成功したら true */
async function saveWizardName(): Promise<boolean> {
  const name = wizard.value.name.trim()
  wizard.value.err = ''
  if (!name) { wizard.value.err = '案件名を入力してください（後から変えられます）'; return false }
  if (projects.value.some(p => p.id !== projectId.value && p.name.trim().toLowerCase() === name.toLowerCase())) {
    wizard.value.err = `案件「${name}」は既にあります`
    return false
  }
  const { error } = await supabase.from('estimate_projects')
    .update({ name, is_draft: false }).eq('id', projectId.value)
  if (error) {
    wizard.value.err = /duplicate|unique/i.test(error.message) ? `案件「${name}」は既にあります` : error.message
    return false
  }
  const p = projects.value.find(x => x.id === projectId.value)
  if (p) p.name = name
  isDraftProject.value = false
  return true
}

/** ステップ2の「次へ」 */
async function commitWizardName() {
  if (await saveWizardName()) wizard.value.step = 3
}
/**
 * ステップタブから直接移動する。
 * ★ステップ2から離れる時は先に案件名を保存する。タブで飛べるようにした以上、
 *  「次へ」を押した時だけ保存では、打った名前が黙って消える。
 *  保存できない場合（同名など）は移動せず、その場でエラーを見せる。
 */
async function goStep(n: number) {
  if (n === wizard.value.step) return
  if (wizard.value.step === 2 && !(await saveWizardName())) return
  wizard.value.step = n
}

/**
 * ステップ2からの抽出開始。★ステップは進めない。
 * 押した直後に画面が切り替わると、始めたはずの進捗が見えなくなって不安になる。
 * 案件名だけ先に確定させておく（このまま明細へ行っても下書きのまま残らないように）。
 */
function beginExtractFromWizard(a: Attachment) {
  beginExtract(a)
  if (isDraftProject.value && wizard.value.name.trim()) void saveWizardName()
}

/** ステップ入力を終える。以降は通常のタブ表示に戻す */
function finishWizard() {
  wizard.value.on = false
  builderTab.value = 'intake'
  // URLから step を落とす（リロードでステップ画面に戻らないように。案件IDは残す）
  const q = { ...route.query } as Record<string, any>
  delete q.step
  void router.replace({ path: route.path, query: q })
}

// ════════════════════════════════════════════════════════════
//  ★R55: 元請け・担当者をこの画面から編集する（マスタ編集の共通ルール）
//   元請けが未登録だと見積書を送れないが、その登録のために画面を移ると
//   書きかけの見積から離れ、ブラウザバックで入力が消えていた。
// ════════════════════════════════════════════════════════════
type ConContactEdit = { id: string | null; name: string; email: string }
const conModal  = ref<{ id: string | null; name: string; contacts: ConContactEdit[] } | null>(null)
const conSaving = ref(false)
const conErr    = ref('')

function openContractorModal(contractorId: string | null) {
  conErr.value = ''
  if (!contractorId) { conModal.value = { id: null, name: '', contacts: [{ id: null, name: '', email: '' }] }; return }
  const c = contractors.value.find(x => x.id === contractorId)
  const cs = contractorContacts.value.filter(x => x.contractor_id === contractorId)
    .map(x => ({ id: x.id, name: x.name ?? '', email: x.email ?? '' }))
  conModal.value = {
    id: contractorId, name: c?.name ?? '',
    contacts: cs.length ? cs : [{ id: null, name: '', email: '' }],
  }
}

async function saveContractorModal() {
  const m = conModal.value
  if (!m || !m.name.trim()) return
  conSaving.value = true; conErr.value = ''
  try {
    let id = m.id
    if (id) {
      const { error } = await supabase.from('contractors').update({ name: m.name.trim() }).eq('id', id)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('contractors')
        .insert({ account_id: accountId, name: m.name.trim(), active: true }).select('id').single()
      if (error) throw error
      id = (data as any).id
    }
    // 担当者: 名前がある行だけ残す。外れた既存行は削除（contractors.vue と同型）
    const want = m.contacts.filter(c => c.name.trim())
    const { data: have } = await supabase.from('contractor_contacts')
      .select('id').eq('contractor_id', id).eq('is_deleted', false)
    const haveIds = ((have ?? []) as { id: string }[]).map(h => h.id)
    const keepIds = want.map(c => c.id).filter(Boolean) as string[]
    for (const [i, c] of want.entries()) {
      const row = {
        contractor_id: id, account_id: accountId, name: c.name.trim(),
        email: c.email.trim() || null, sort_order: i, updated_at: new Date().toISOString(),
      }
      if (c.id) { const { error } = await supabase.from('contractor_contacts').update(row).eq('id', c.id); if (error) throw error }
      else      { const { error } = await supabase.from('contractor_contacts').insert(row); if (error) throw error }
    }
    const toDel = haveIds.filter(x => !keepIds.includes(x))
    if (toDel.length) await supabase.from('contractor_contacts').delete().in('id', toDel)

    // ★追加した瞬間に選択肢へ反映し、この案件の元請けにする（閉じてから探させない）
    await loadContractors()
    if (id && id !== currentContractorId.value) await setProjectContractor(id)
    conModal.value = null
  } catch (e: any) {
    conErr.value = e?.message ?? '保存に失敗しました'
  } finally { conSaving.value = false }
}

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

/** ★保存を直列化するための鎖。
 *  依頼日→提出期限と続けて入力すると、1回目の保存が飛んでいる最中に2回目が走り、
 *  遅れて着いた1回目（提出期限がまだ空）が null で上書きして**入力が消えていた**。
 *  最後に投げたものが最後に着くとは限らないので、前の保存を待ってから次を投げる。
 *  （2026-08-18 admin.estimate-intake AC1 の失敗として表面化） */
let intakeSaveChain: Promise<unknown> = Promise.resolve()
/** ★遅延は入れない。250ms のデバウンスを挟んだら、入力直後に画面を離れると
 *  タイマーが発火せず保存が消える別の穴ができた。投げるのは即時、順番だけ守る。 */
function saveIntake(): Promise<unknown> {
  intakeSaveChain = intakeSaveChain.then(() => saveIntakeNow()).catch(() => {})
  return intakeSaveChain
}

async function saveIntakeNow() {
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
  thumbs: Record<number, string>
  rangeText: string; preview: number | null; previewUrl: string
  subId: string; contactIds: string[]; subject: string; body: string; trade: string
  msg: string; err: string
}>({
  att: null, loading: false, sending: false, bytes: null, pageCount: 0, selected: [], thumbs: {},
  rangeText: '', preview: null, previewUrl: '', subId: '', contactIds: '' as any,
  subject: '', body: '', msg: '', err: '', trade: '',
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

/**
 * 添付図面の1ページ目のサムネイル（attachment.id → dataURL）。
 * ★なぜ1ページ目だけか: 図面は50ページ超が普通にあり、全ページ描くと固まる。
 *  一覧で要るのは「どの図面か見分けが付くこと」なので表紙だけで足りる。
 *  全ページ見たい時は既存の「ページを選んで送る」で拡大できる。
 * ★pdfjs は重いので、実際に図面がある時だけ動的importする。
 * （2026-08-18 通しレビュー: 図面を入れた直後に何も見えず、入ったのか分からなかった）
 */
const attThumbs = ref<Record<string, string>>({})
const attThumbBusy = new Set<string>()

async function buildAttThumb(a: Attachment) {
  if (!a?.id || attThumbs.value[a.id] || attThumbBusy.has(a.id) || !isPdf(a)) return
  attThumbBusy.add(a.id)
  try {
    const { data, error } = await supabase.storage.from(DRAWING_BUCKET).download(a.path)
    if (error || !data) return
    const bytes = new Uint8Array(await data.arrayBuffer())
    const pdfjs: any = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const doc = await pdfjs.getDocument({ data: bytes }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 220 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    attThumbs.value = { ...attThumbs.value, [a.id]: canvas.toDataURL('image/png') }
    doc.destroy?.()
  } catch { /* 描けなくてもファイル名は出ているので操作は続けられる */ } finally {
    attThumbBusy.delete(a.id)
  }
}

// 添付が変わったら表紙を描く（既に描いたものは使い回す）
watch(attachments, (list) => { for (const a of list ?? []) void buildAttThumb(a) }, { deep: true })

async function openDrawingSend(a: Attachment) {
  const d = dsend.value
  d.att = a; d.loading = true; d.err = ''; d.msg = ''
  d.selected = []; d.rangeText = ''; d.preview = null; d.previewUrl = ''
  d.thumbs = {}; thumbObserver?.disconnect(); pdfDoc?.destroy?.(); pdfDoc = null
  d.contactIds = []; d.subject = ''; d.body = ''
  try {
    const { data, error } = await supabase.storage.from(DRAWING_BUCKET).download(a.path)
    if (error || !data) throw error ?? new Error('図面を取得できませんでした')
    d.bytes = new Uint8Array(await data.arrayBuffer())
    const { PDFDocument } = await import('pdf-lib')
    d.pageCount = (await PDFDocument.load(d.bytes)).getPageCount()
    void initThumbs()
  } catch (e: any) {
    d.err = e?.message ?? '図面を読み込めませんでした'
    d.pageCount = 0
  } finally { d.loading = false }
}
/**
 * R17: ページのサムネイルを描く。
 * ★50ページ超の図面が普通にあるので、開いた瞬間に全ページ描くと固まる。
 *   画面に入ったページだけ描く（IntersectionObserver）。一度描いたら使い回す。
 * pdfjs は重いので、図面を開いた時にだけ動的importする（初回表示を遅くしない）。
 */
let pdfDoc: any = null
let thumbObserver: IntersectionObserver | null = null
const renderingPages = new Set<number>()

async function initThumbs() {
  const d = dsend.value
  if (!d.bytes) return
  const pdfjs: any = await import('pdfjs-dist')
  // ワーカーはバンドルから取る（CDNを見に行かせない＝オフライン/社内網でも動く）
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  // pdf-lib と同じ配列を渡すと片方が detach するので複製して渡す
  pdfDoc = await pdfjs.getDocument({ data: d.bytes.slice() }).promise
  await nextTick()
  observeThumbs()
}
function observeThumbs() {
  thumbObserver?.disconnect()
  const root = document.querySelector('[data-testid="dsend-thumbs"]')
  if (!root) return
  thumbObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const p = Number((e.target as HTMLElement).dataset.page)
      if (p) void renderThumb(p)
    }
  }, { root, rootMargin: '200px' })
  root.querySelectorAll('[data-page]').forEach(el => thumbObserver!.observe(el))
}
async function renderThumb(p: number) {
  const d = dsend.value
  if (!pdfDoc || d.thumbs[p] || renderingPages.has(p)) return
  renderingPages.add(p)
  try {
    const page = await pdfDoc.getPage(p)
    const base = page.getViewport({ scale: 1 })
    const scale = 420 / base.width          // 表示が大きくなったぶん解像度も上げる（粗いと図面が読めない）
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise
    d.thumbs = { ...d.thumbs, [p]: canvas.toDataURL('image/png') }
  } catch { /* 1ページ描けなくても他のページの選択は続けられる */ } finally {
    renderingPages.delete(p)
  }
}

function closeDrawingSend() {
  if (dsend.value.previewUrl) URL.revokeObjectURL(dsend.value.previewUrl)
  thumbObserver?.disconnect(); thumbObserver = null
  pdfDoc?.destroy?.(); pdfDoc = null
  dsend.value.att = null; dsend.value.bytes = null; dsend.value.previewUrl = ''
  dsend.value.thumbs = {}
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
        trade_name: d.trade || null,   // ★R48: 依頼行の工種名をEF側で埋めるため送る
      }),
    })
    const json = await resp.json()
    if (!resp.ok || json?.error) throw new Error(json?.error || `送信エラー(${resp.status})`)
    d.msg = json?.skipped === 'no_api_key'
      ? `${pages.length}ページを記録しました（メール未設定のため実送信はスキップ）`
      : `${pages.length}ページを送信しました`
    // ★R48: 見積依頼行の作成は Edge Function 側へ移した（送信と一体で成立させる）。
    //   以前はここ（fetch後のブラウザ処理）で作っていたため、送信成功後にタブが閉じる/
    //   リロードされると「メールは届いているのに依頼行が無い」状態になり、
    //   回収期限の管理から黙って漏れていた。
    //   EFが作れなかった場合だけ警告を出す（無音にしない）。
    if (json?.quote_request_warning) d.err = json.quote_request_warning
    await loadDrawingSends()
    await loadQuotes()
  } catch (e: any) {
    d.err = e?.message ?? '送信に失敗しました'
  } finally { d.sending = false }
}

// ★R48: ここにあった ensureQuoteRequestFromSend（ブラウザ側での依頼行作成）は撤去した。
//  送信成功後の後処理だったため、タブが閉じる/リロードで依頼行だけ生まれず
//  「メールは届いているのに依頼が無い」状態を作っていた。
//  現在は Edge Function（_shared/drawing-mail.ts）が送信履歴と同じ流れで作る。

async function loadDrawingSends() {
  if (!projectId.value) { drawingSends.value = []; return }
  const { data } = await supabase.from('estimate_drawing_sends')
    .select('id, subcontractor_id, pages, source_name, email_to, sent_at')
    .eq('project_id', projectId.value).order('created_at', { ascending: false })
  drawingSends.value = (data ?? []) as DrawingSend[]
}

// ★R26: 自社情報をその場で登録・編集する（ページ遷移させない）
//  label は自社情報ページ(company-profile.vue)と同じ表示名を使う（設定一覧での見え方を揃える）
const COMPANY_LABELS: Record<string, string> = {
  company_name: '会社名', company_rep: '代表者', company_address: '住所', company_tel: 'TEL',
}
const companySaving = ref(false)
const companyMsg    = ref('')
const companyErr    = ref('')
const companyForm   = ref<Record<string, string>>({ company_name: '', company_rep: '', company_tel: '', company_address: '' })
/** ★R34: 見積書ページでその場で直した自社情報を保存する（明細と同じくセルを離れた時点で） */
async function saveCompanyInline() {
  await saveCompanyInlineNow()
}
async function saveCompanyInlineNow() {
  companySaving.value = true; companyMsg.value = ''; companyErr.value = ''
  try {
    // settings は key-value。既存の自社情報ページと同じ入れ物に書く（保存先を分けない）。
    // ★label は NOT NULL。自社情報ページと同じ表示名を入れないと 400 で落ちる。
    const rows = Object.entries(companyForm.value)
      .map(([key, value]) => ({ account_id: accountId, key, value: (value ?? '').trim(), label: COMPANY_LABELS[key] ?? key }))
    // 一意制約は (key, account_id) の順（settings_pkey）。順序を合わせないと upsert が通らない
    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key,account_id' })
    if (error) { companyErr.value = error.message; return }
    await loadCompany()   // 保存したら即座に見積書へ反映する
    companyMsg.value = '保存しました'
    setTimeout(() => { companyMsg.value = '' }, 1200)
  } finally { companySaving.value = false }
}

// #4 マスタ・自社情報の右ドロワー（閉じると明細の選択肢・見積書計算に即反映）
const drawerOpen = ref(false)
function openDrawer() { drawerOpen.value = true }
async function closeDrawer() {
  drawerOpen.value = false
  await Promise.all([loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadContractors(), loadCompany()])
}

type Project  = { id: string; name: string; client_name: string | null; contractor_id: string | null; status: string; site_id: string | null }
type Site     = { id: string; name: string }
type Contractor = { id: string; name: string }
type Trade    = { id: string; name: string }
type Material = { id: string | null; name: string; unit: string | null; code: string | null; spec?: string | null }
type Supplier = { id: string; name: string }
type MatPrice = { id: string; material_id: string | null; product_code: string | null; supplier_id: string; unit_price: number; effective_date: string | null }
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
/**
 * ★R25: 内訳書はExcelの「全体見積」と同じ形にする。
 *  （壁面工事）＝場所の見出し / ■軽鉄工事＝工種の見出し / その下に明細行、を行単位でそのまま出す。
 *  2026-07-29 ユーザー回答で「内訳書の形」を選択。工種ごとの小計だけ並べる形は採らない。
 *  ★空行は出さない（打ちかけの予備行が帳票に出ると体裁が崩れる）。
 */
type DocLine =
  | { kind: 'area';  text: string }
  | { kind: 'trade'; text: string }
  | { kind: 'item';  row: Row }
const docLines = computed<DocLine[]>(() => {
  const out: DocLine[] = []
  let loc = '\u0000', trade = '\u0000'
  for (const r of rows.value) {
    if (isBlankRow(r) || !isItemRow(r)) continue
    const l = (r.location ?? '').trim()
    const t = (r.trade_name ?? '').trim()
    if (l !== loc) { if (l) out.push({ kind: 'area', text: `（${l}）` }); loc = l; trade = '\u0000' }
    if (t !== trade) { if (t) out.push({ kind: 'trade', text: `■${t}` }); trade = t }
    out.push({ kind: 'item', row: r })
  }
  return out
})
const breakdownPages = computed(() => chunk(docLines.value, BD_ROWS_PER_PAGE))
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
// ★R25: 工種別の明細ページは内訳書に統合したので無くなった（同じ明細を2回出さない）
const detailBase   = computed(() => 1 + breakdownPages.value.length)
const totalPages   = computed(() => 1 + breakdownPages.value.length)
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
  // ★R52: 名前を付けた時点で下書きではなくなる。
  //  ここで外さないと仮名（「（案件名未入力）07/30 …」）のまま帳票に出る恐れがある。
  const { error } = await supabase.from('estimate_projects').update({ name, is_draft: false }).eq('id', p.id)
  if (error) { projectErr.value = error.message; return }
  p.name = name
  isDraftProject.value = false
}
// #5 明細のドラッグ並び替え（ハンドルで掴んで移動。順序は保存時 sort_order に反映）
let rowKey = 0   // 明細行の安定キー採番（並び替え用）
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
function onDragStart(i: number) { dragKind.value = 'row'; dragIndex.value = i }
function onDragEnd() { dragIndex.value = null; dragOverIndex.value = null }
/**
 * ★R39: 工種・場所の単位でドラッグ移動する。
 *  行単位だけだと、工種をまるごと別の場所へ移すのに何十行も動かすことになる。
 *  掴んだ塊の行をまとめて抜き、落とし先の直前に差し込む。
 */
const dragKind = ref<'row' | 'block' | 'area'>('row')
const dragBlockIdx = ref<number | null>(null)
const dragAreaIdx  = ref<number | null>(null)
function onDragBlock(bi: number) { dragKind.value = 'block'; dragBlockIdx.value = bi }
function onDragArea(ai: number)  { dragKind.value = 'area';  dragAreaIdx.value = ai }

/** 塊(行indexの配列)を、落とし先の先頭行の位置へ移す */
function moveChunk(fromIdxs: number[], targetFirstIdx: number) {
  const arr = rows.value
  const moved = fromIdxs.map(i => arr[i])
  if (moved.includes(arr[targetFirstIdx])) return false   // 自分自身へは落とさない
  const rest = arr.filter(r => !moved.includes(r))
  const at = rest.indexOf(arr[targetFirstIdx])
  if (at < 0) return false
  rest.splice(at, 0, ...moved)
  rows.value = rest
  void save()   // 並び順(sort_order)を保存する
  return true
}
function onDropBlock(targetBi: number) {
  const target = blocks.value[targetBi]
  if (!target) return
  if (dragKind.value === 'block' && dragBlockIdx.value != null) {
    const src = blocks.value[dragBlockIdx.value]
    if (src && src !== target) {
      // 別の場所へ落としたら、その場所を引き継ぐ（見た目どおりの挙動）
      const loc = target.location
      for (const i of src.idxs) rows.value[i].location = loc
      moveChunk(src.idxs, target.idxs[0])
    }
  } else if (dragKind.value === 'area' && dragAreaIdx.value != null) {
    const src = areas.value[dragAreaIdx.value]
    if (src) moveChunk(src.blocks.flatMap(b => b.idxs), target.idxs[0])
  }
  dragKind.value = 'row'; dragBlockIdx.value = null; dragAreaIdx.value = null
}
function onDropArea(targetAi: number) {
  const target = areas.value[targetAi]
  if (!target) return
  const firstIdx = target.blocks[0]?.idxs[0]
  if (firstIdx == null) return
  if (dragKind.value === 'area' && dragAreaIdx.value != null) {
    const src = areas.value[dragAreaIdx.value]
    if (src && src !== target) moveChunk(src.blocks.flatMap(b => b.idxs), firstIdx)
  } else if (dragKind.value === 'block' && dragBlockIdx.value != null) {
    const src = blocks.value[dragBlockIdx.value]
    if (src) {
      for (const i of src.idxs) rows.value[i].location = target.location   // その場所へ移す
      moveChunk(src.idxs, firstIdx)
    }
  }
  dragKind.value = 'row'; dragBlockIdx.value = null; dragAreaIdx.value = null
}

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
  void save()   // R22: 並び順(sort_order)も即保存する
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
    await markIssuedAfterSend()
    await loadSends()
  } catch (e: any) {
    sendErr.value = e?.message ?? '送信に失敗しました'
  } finally {
    sending.value = false
  }
}

/**
 * ★R49: 見積書を元請けへ送ったら「提出済み」へ進める。
 *
 * ★draft の時だけ進める。理由:
 *  - 既に人が手で「提出済み」にしていたら触る必要がない
 *  - 受注(active)・失注(lost)・辞退(declined) まで進んだ案件で**差し替えの再送**をした時に、
 *    ステータスが「提出済み」へ巻き戻ると業務の進捗が壊れる（ACの「不自然に動かない」）
 * 送信自体は成立しているので、ここが失敗しても送信をエラーにはしない。
 */
async function markIssuedAfterSend() {
  if (!projectId.value) return
  if (intake.value.status !== 'draft') return
  const { error } = await supabase.from('estimate_projects')
    .update({ status: 'issued' })
    .eq('id', projectId.value)
    .eq('status', 'draft')   // 競合しても draft のものだけ（他タブで進めていたら触らない）
  if (error) { console.warn('[estimate] 提出済みへの更新に失敗:', error.message); return }
  intake.value.status = 'issued'
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
/**
 * ★R28: 名称・品番の候補は「商社単価表」＋「過去の明細入力履歴」から作る。
 *  材料マスタ(estimate_materials)は明細を保存するたびに自動登録される作りで、
 *  作業内容（壁面外周LGS間仕切り等＝商品ではないもの）まで材料として溜まっていた。
 *  一本化後は
 *    材料（品番あり）→ 商社単価表から
 *    作業内容（品番なし）→ 過去に打った明細から
 *  を候補にする。既存の材料マスタは移行期間として読むだけ残す（新規登録はしない）。
 */
async function loadMaterials() {
  const [{ data: legacy }, { data: prices }, { data: past }] = await Promise.all([
    supabase.from('estimate_materials')
      .select('id, name, unit, code, spec').eq('account_id', accountId).order('name'),
    supabase.from('estimate_material_prices')
      .select('material_id, product_code, item_name, unit')
      .eq('account_id', accountId).eq('is_current', true),
    // 過去の明細入力履歴（作業内容の候補元）。件数が増えるので直近を上限付きで取る
    supabase.from('estimate_items')
      .select('item_name, product_code, unit')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(3000),
  ])
  const seen = new Map<string, Material>()
  const put = (name: string, code: string | null, unit: string | null, id: string | null) => {
    const nm = (name ?? '').trim()
    if (!nm || nm === '(無題)') return
    const key = nm.toLowerCase()
    const cur = seen.get(key)
    // ★id は必ず null か実UUID。空文字を入れると material_id に '' が渡って
    //   uuid列のinsertが落ち、その行だけ黙って保存されない（E2Eで検出）。
    if (!cur) seen.set(key, { id: id ?? null, name: nm, unit: unit ?? null, code: code ?? null })
    else {   // 先に入った方を優先しつつ、欠けている情報だけ補う
      if (!cur.code && code) cur.code = code
      if (!cur.unit && unit) cur.unit = unit
      if (!cur.id && id) cur.id = id
    }
  }
  for (const m of (legacy ?? []) as any[]) put(m.name, m.code, m.unit, m.id)          // 移行期間: 既存マスタも候補に残す
  for (const p of (prices ?? []) as any[]) put(p.item_name, p.product_code, p.unit, p.material_id)
  for (const it of (past ?? []) as any[]) put(it.item_name, it.product_code, it.unit, null)
  materials.value = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
}
// 商社＝下請け業者マスタ(区分=商社)。新設せず既存 subcontractors を流用（subcontractors はRLS無効のため account_id で絞る）
async function loadSuppliers() {
  const { data } = await supabase.from('subcontractors')
    .select('id, name').eq('account_id', accountId).eq('category', '商社').order('sort_order').order('name')
  suppliers.value = (data ?? []) as Supplier[]
}
async function loadMaterialPrices() {
  const { data } = await supabase.from('estimate_material_prices')
    .select('id, material_id, product_code, item_name, unit, supplier_id, unit_price, effective_date').eq('account_id', accountId).eq('is_current', true)
  matPrices.value = (data ?? []) as MatPrice[]
}
// ③ 元請けと担当者（見積書の送信先候補）。元請けマスタ(contractors)＋ contractor_contacts。
async function loadContractors() {
  const [{ data: cs }, { data: ccs }] = await Promise.all([
    supabase.from('contractors').select('id, name').eq('account_id', accountId).eq('active', true).order('sort_order').order('name'),
    supabase.from('contractor_contacts').select('id, contractor_id, name, email').eq('account_id', accountId).eq('is_deleted', false).order('sort_order'),
  ])
  contractors.value = (cs ?? []) as Contractor[]
  contractorContacts.value = (ccs ?? []) as Contact[]
}
// 現場一覧（受注時の紐付け先・現場名表示用）
async function loadSites() {
  const { data } = await supabase.from('sites').select('id, name, name_kana').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name')
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
    if (looseMatch(nm, cand)) return true                     // 「天井下地」≒「天井LGS下地組」（議事録の実例）
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
  // R34: 見積書ページの自社情報欄に現在値を入れる
  companyForm.value = {
    company_name: company.value.company_name ?? '', company_rep: company.value.company_rep ?? '',
    company_tel: company.value.company_tel ?? '', company_address: company.value.company_address ?? '',
  }
  syncMarginPct()
  await loadSubcontractorOptions()
  await loadPriceHistory()
  await loadListPrices()   // R41: 定価と商社別掛率
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
/**
 * その材料の商社別単価。
 * ★R28: material_id は新規では付かなくなるので、品番でも引けるようにする。
 *  （品番は材料の同一性の核なので、マスタIDが無くても単価表と突き合わせられる）
 */
// ════════════════════════════════════════════════════════════
//  R41: 定価 × 商社別掛率で仕入単価（原価）を出す
//  議事録§2.3「定価は統一されているが仕入価格は商社により異なる／掛率は商社により0.4〜0.45掛け」
//  ★既存の「掛け率」は粗利率（原価→客先の値付け）で、こちらは仕入側。別物。
//  ★絶対額(unit_price)が入っていればそれを優先する。価格表OCRは絶対額しか取れないことがあり、
//   既存データもすべて絶対額なので、両方が並存できる形にしておく。
// ════════════════════════════════════════════════════════════
type ListPrice = { product_code: string; item_name: string | null; unit: string | null; list_price: number }
type SupplierRate = { supplier_id: string; rate: number }
const listPrices    = ref<ListPrice[]>([])
const supplierRates = ref<SupplierRate[]>([])
async function loadListPrices() {
  const [{ data: lp }, { data: sr }] = await Promise.all([
    supabase.from('estimate_list_prices').select('product_code, item_name, unit, list_price').eq('account_id', accountId),
    supabase.from('estimate_supplier_rates').select('supplier_id, rate').eq('account_id', accountId),
  ])
  listPrices.value = (lp ?? []).map((x: any) => ({ ...x, list_price: Number(x.list_price) }))
  supplierRates.value = (sr ?? []).map((x: any) => ({ ...x, rate: Number(x.rate) }))
}
const listPriceOf = (code: string | null | undefined) => {
  const c = (code ?? '').trim().toLowerCase()
  if (!c) return null
  return listPrices.value.find(l => l.product_code.trim().toLowerCase() === c) ?? null
}
const supplierRateOf = (supplierId: string) => supplierRates.value.find(r => r.supplier_id === supplierId)?.rate ?? null

/**
 * 名称から定価を引く（R46の推定用）。品番ではなく名称で引くのは、
 * 受領見積の明細に品番が無いことが多いため。表記ゆれは normalizeGuessName で吸収する
 * （★このファイル内の normalizeName とは別ルール。推定側と必ず同じ関数を使うこと）。
 */
function listPriceByName(normName: string): number | null {
  if (!normName) return null
  const hit = listPrices.value.find(l => normalizeGuessName(l.item_name) === normName)
  return hit ? hit.list_price : null
}

/**
 * その商社から仕入れる時の単価。
 * 優先順: ①単価表の絶対額 ②定価 × 掛率（品番×商社の上書き → 商社の既定）
 */
function purchaseUnitPrice(p: { supplier_id: string; unit_price: number; rate?: number | null; product_code?: string | null },
                           code: string | null | undefined): { price: number; from: '単価表' | '定価×掛率' } | null {
  if (Number(p.unit_price) > 0) return { price: Number(p.unit_price), from: '単価表' }
  const lp = listPriceOf(code ?? p.product_code)
  const rate = p.rate ?? supplierRateOf(p.supplier_id)
  if (lp && rate != null && rate > 0) return { price: Math.round(lp.list_price * rate), from: '定価×掛率' }
  return null
}

function pricesForRow(materialId: string | null, productCode?: string | null) {
  const code = (productCode ?? '').trim().toLowerCase()
  if (!materialId && !code) return [] as Array<{ supplier_id: string; supplierName: string; unit_price: number }>
  const hit = matPrices.value
    .filter(p => (materialId && p.material_id === materialId)
              || (!!code && (p.product_code ?? '').trim().toLowerCase() === code))
    .map(p => {
      const calc = purchaseUnitPrice(p as any, productCode)
      return {
        supplier_id: p.supplier_id,
        supplierName: suppliers.value.find(s => s.id === p.supplier_id)?.name ?? '(商社)',
        unit_price: calc?.price ?? 0,
        from: calc?.from ?? '—',
      }
    })
    .filter(x => x.unit_price > 0)
  // ★R41: 単価表に絶対額が無くても、定価×掛率が引ける商社は候補に出す
  //   （その商社の行が単価表に無いケース。掛率だけ登録している運用がある）
  const lp = listPriceOf(productCode)
  if (lp) {
    for (const r of supplierRates.value) {
      if (hit.some(x => x.supplier_id === r.supplier_id)) continue
      if (!(r.rate > 0)) continue
      hit.push({
        supplier_id: r.supplier_id,
        supplierName: suppliers.value.find(s => s.id === r.supplier_id)?.name ?? '(商社)',
        unit_price: Math.round(lp.list_price * r.rate), from: '定価×掛率',
      })
    }
  }
  return hit.sort((a, b) => a.unit_price - b.unit_price)
}
/** R42: その行で一番安い商社（比較の基準は仕入単価。定価×掛率と絶対額を同じ土俵で見る） */
function cheapestFor(r: Row) {
  const list = pricesForRow(r.material_id, r.product_code)
  return list.length ? list[0] : null
}
/** R42: 最安の商社を採用する（勝手に確定せず、押した時だけ） */
function applyCheapest(r: Row) {
  const best = cheapestFor(r)
  if (!best) return
  r.supplier_id = best.supplier_id
  r.cost_unit_price = best.unit_price
  if (!r._priceTouched) r.unit_price = autoPrice(r)
  void autoSaveRow(r)
}
const pricesForMaterial = (materialId: string | null) => pricesForRow(materialId)
// 商社を選ぶと、その商社×材料の単価を明細単価に反映（金額は生成列/computedで追従）
/**
 * 商社を選んだら、その商社の単価を**原価**に入れる。
 * ★R28: material_id が無くても品番で引く。
 * ★入れる先を unit_price（客先単価）から cost_unit_price（原価）に直した。
 *   商社から買う値段は原価であって客先に出す値段ではない。原価に入れれば
 *   粗利率から客先単価が生える（Q1/Q2で決めた主動線）。
 */
function onSupplierPick(r: Row) {
  if (!r.supplier_id) return
  const code = (r.product_code ?? '').trim().toLowerCase()
  // ★R41: 絶対額が無い商社でも、定価×掛率で仕入単価が出る
  const picked = pricesForRow(r.material_id, r.product_code).find(x => x.supplier_id === r.supplier_id)
  if (!picked) return
  void code
  r.cost_unit_price = picked.unit_price
  if (!r._priceTouched) r.unit_price = autoPrice(r)
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
  (s ?? '').normalize('NFKC')          // 全角英数・半角カナを揃える（価格表OCR側と同じ扱いにする）
    .trim().toLowerCase().replace(/[\s\u3000・\-ー_（）()]/g, '')

/**
 * 一方が他方の「部分列」になっているか（間に別の語が挟まっていてもよい）。
 * ★議事録の実例「天井下地」と「天井LGS下地組」がこれ。
 *   編集距離だと 4文字 vs 9文字で長さの足切りに引っかかり、判定にすら到達しなかった。
 *   業者ごとに語を足し引きする表記ゆれ（下地→LGS下地組、間仕切→間仕切り工事）は
 *   文字が順番に残るので、部分列で拾うのが実態に合う。
 */
function isSubsequence(short: string, long: string): boolean {
  if (short.length < 2 || short.length > long.length) return false
  let i = 0
  for (const ch of long) { if (ch === short[i]) i++; if (i === short.length) return true }
  return false
}
/** 短い方が2文字だと何にでも当たるので、実質的な長さを要求する */
const looseMatch = (a: string, b: string) => {
  const [sh, lg] = a.length <= b.length ? [a, b] : [b, a]
  return sh.length >= 3 && isSubsequence(sh, lg)
}
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
    if (looseMatch(nm, cand)) { out.push({ name: m.name, d: 0 }); continue }   // 語の足し引きの表記ゆれ
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
// ════════════════════════════════════════════════════════════
//  R27: マスタ編集の共通ルール
//   ・ページ遷移せず、その場のモーダルで編集する
//   ・追加した瞬間に候補へ反映する（閉じるまで待たせない）
//   ・編集ボタンは「そのマスタを使う場所の近く」に置く
//  ここでは工種に適用。自社情報は R26 で見積書プレビュー内に置いた。
// ════════════════════════════════════════════════════════════
const tradeModal   = ref(false)
const newTradeName = ref('')
const tradeErr     = ref('')
function openTradeModal() { tradeErr.value = ''; newTradeName.value = ''; tradeModal.value = true }
async function addTradeInline() {
  const name = newTradeName.value.trim()
  if (!name) return
  tradeErr.value = ''
  if (trades.value.some(t => t.name.trim() === name)) { tradeErr.value = `「${name}」は既にあります`; return }
  const { data, error } = await supabase.from('estimate_trades')
    .insert({ account_id: accountId, name }).select('id, name').single()
  if (error) { tradeErr.value = error.message; return }
  newTradeName.value = ''
  // ★閉じるのを待たずに候補へ反映する（追加してすぐ使えるのが要件）
  trades.value = [...trades.value, data as Trade].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
}
async function renameTrade(t: Trade) {
  const name = t.name.trim()
  if (!name) return
  const { error } = await supabase.from('estimate_trades').update({ name }).eq('id', t.id)
  if (error) tradeErr.value = error.message
}
async function removeTrade(t: Trade) {
  // ★候補から消すだけ。既に打った明細の工種名（trade_name は自由記述）は変えない
  if (!window.confirm(`「${t.name}」を工種の候補から外しますか？\n※すでに作った見積の工種名は変わりません。`)) return
  const { error } = await supabase.from('estimate_trades').delete().eq('id', t.id)
  if (error) { tradeErr.value = error.message; return }
  trades.value = trades.value.filter(x => x.id !== t.id)
}

// ════════════════════════════════════════════════════════════
//  実施図面からの材料抽出（案件情報の図面から直接）
//
//  これまでは独立ページ /drawing-materials でしか使えず、
//  ・案件に紐づかない（アップロードするだけ）
//  ・出口がCSV書き出しだけ（見積への反映は手動）
//  だったため、抽出した品番を明細に手で打ち直していた。
//  R3(品番列)・R14(品番で材料判定)・R28(品番から商社単価)が揃ったので、
//  案件の図面から抽出して明細へ流し込めるようにする。
//
//  ★全件を自動投入しない。図面には「(仮)」の品番や、中止になったのに
//   綴じられたままの詳細図が混ざる（実図面で確認済み）。機械的に入れると
//   中止項目を過大計上するので、人が選んだ行だけを入れる。
// ════════════════════════════════════════════════════════════
//  ★R53（2026-07-30 レビュー第5回）: 解析はモーダルで人を拘束しない。
//   実行そのものは lib/extractJobs.ts（画面の外）に置き、
//   ・別のタブ／別の画面に移っても解析が止まらない
//   ・1ページ終わるごとにDBへ保存するので、タブを閉じても続きから再開できる
//   ここに残すのは「結果を見て、選んで明細に入れる」部分だけ。
type PickRow = ExtractRow & { _pick: boolean }
const dext = ref<{ att: Attachment | null; rows: PickRow[]; msg: string }>({ att: null, rows: [], msg: '' })
const dextPicked = computed(() => dext.value.rows.filter(r => r._pick))
/** 表示中の図面のジョブ（進捗・状態はストアが正）。 */
const dextJob = computed(() => (dext.value.att ? jobFor(dext.value.att.id) : null))
/** この案件で走っている抽出（タブの横に進捗を出す） */
const runningExtracts = computed(() => (projectId.value ? runningJobsOf(projectId.value) : []))

/** 解析を開始／中断したところから再開する。await しない＝押した直後から他の操作ができる */
function beginExtract(a: Attachment | null) {
  if (!a || !projectId.value) return
  dext.value.msg = ''
  void startExtract({ projectId: projectId.value, attachmentId: a.id, path: a.path, sourceName: a.name ?? '' })
}
/** 結果を見る（解析中でも開ける。ここまでの結果が並ぶ） */
async function openExtractResult(a: Attachment) {
  dext.value = { att: a, rows: [], msg: '' }
  syncDextRows()
  const job = jobFor(a.id)
  // 完了を見たらナビのバッジから落とす
  if (job && job.status === 'done') await ackJob(job)
}
function closeExtract() { dext.value.att = null; dext.value.rows = [] }

/**
 * ジョブの抽出結果を、チェックボックス付きの表示用行に写す。
 * ★既存行のチェック状態は保つ（解析が進んで行が増えるたびに選び直させない）。
 * ★既定はオフ。「(仮)」「要確認」等が混ざるので、選ぶのを人の判断にする。
 */
function syncDextRows() {
  const job = dextJob.value
  if (!job) { dext.value.rows = []; return }
  const picked = new Set(dext.value.rows.filter(r => r._pick).map(r => `${r.page}|${r.code}|${r.part}`))
  dext.value.rows = job.rows.map(r => ({ ...r, _pick: picked.has(`${r.page}|${r.code}|${r.part}`) }))
}
// 解析が進んだら表示も伸ばす（結果を開いたまま眺めていられるように）
watch(() => dextJob.value?.rows.length ?? 0, () => { if (dext.value.att) syncDextRows() })

/** 選んだ抽出行を明細に入れる。空行があればそこを埋める（末尾に足すと見つけにくい） */
// ── Q7: 図面凡例からの確定数量の抽出 ──
//  材料(品番)の抽出とは別物。凡例に「書いてある」数量を転記するだけで、面積の拾い出しはしない。
//  ★材料抽出(R53)はジョブ化して裏で走らせるが、数量抽出は対象ページが凡例のある数枚で
//   終わるため、その場で回してパネルに出す（ジョブ表を増やさない）。
type QtyRow = { page: number; part: QuantityPart; code: string; maker_code: string | null; spec: string | null; value: number; unit: string; note: string | null; _pick: boolean }
/** 失敗したページ。★1ページの失敗で全体を止めず、そのページだけやり直せるようにする */
type QtyFailedPage = { pageNo: number; b64: string; errorMsg: string; retrying: boolean }
const dqty = ref<{
  att: any | null; busy: boolean; done: number; total: number
  rows: QtyRow[]; check: CrossCheck | null; error: string; msg: string
  failed: QtyFailedPage[]
  gridX: number | null; gridY: number | null
  merged: { part: QuantityPart; rows: any[] }[]
}>({ att: null, busy: false, done: 0, total: 0, rows: [], check: null, error: '', msg: '',
     failed: [], gridX: null, gridY: null, merged: [] })
const dqtyPicked = computed(() => dqty.value.rows.filter(r => r._pick))

/**
 * 1ページぶんの数量抽出。失敗は投げる（呼び出し側が失敗ページとして記録する）。
 */
async function callQuantityExtract(b64: string, pageNo: number, token: string): Promise<any> {
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drawing-quantity-extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ image_base64: b64, mime: 'application/pdf', page: pageNo }),
  })
  const j = await resp.json().catch(() => null)
  if (!resp.ok || j?.error) throw new Error(j?.error || `解析エラー(${resp.status})`)
  return j
}

/** 抽出結果を画面の行と検算用の集計に取り込む */
function absorbQuantityResult(j: any, pageNo: number) {
  const d = dqty.value
  for (const g of (j?.parts ?? [])) {
    for (const r of (g.rows ?? [])) {
      d.rows.push({
        page: pageNo, part: g.part, code: r.code ?? '', maker_code: r.maker_code ?? null, spec: r.spec ?? null,
        value: Number(r.value) || 0, unit: r.unit || '㎡', note: r.note ?? null, _pick: true,
      })
    }
    const slot = d.merged.find(m => m.part === g.part)
      ?? (d.merged.push({ part: g.part, rows: [] }), d.merged[d.merged.length - 1])
    slot.rows.push(...(g.rows ?? []))
  }
  // 通り芯は最初に読めたページの値を採用（複数ページに同じ通り芯が載るため）
  if (d.gridX == null && Number(j?.gridSpanX) > 0) d.gridX = Number(j.gridSpanX)
  if (d.gridY == null && Number(j?.gridSpanY) > 0) d.gridY = Number(j.gridSpanY)
}

/** 検算をやり直す（再試行でページが増えた後にも呼ぶ） */
function recheckQuantity() {
  const d = dqty.value
  d.check = crossCheckCeiling({ parts: d.merged as any, gridSpanX: d.gridX, gridSpanY: d.gridY })
}

/**
 * ★同時に投げる本数。図面は50ページ超が普通にあり、1ページずつ直列だと
 *  1ページ数秒でも数分かかる（2026-08-18 通しレビューで実際に遅く、かつ 504 に当たった）。
 *  増やしすぎるとAI側のレート制限と Edge Function の同時実行に当たるので控えめにする。
 */
const QTY_CONCURRENCY = 4

/**
 * 添付ごとの「保存済みの数量抽出の件数」（attachment_id → 件数）。
 * ★ボタンの文言に使う。押す前に前回の結果があると分かるようにするため。
 */
const qtySavedCount = ref<Record<string, number>>({})

async function loadQtySavedCounts() {
  qtySavedCount.value = {}
  if (!projectId.value || !accountId) return
  const { data } = await supabase.from('estimate_drawing_extract_jobs')
    .select('attachment_id, rows')
    .eq('account_id', accountId).eq('project_id', projectId.value).eq('kind', 'quantity')
  const m: Record<string, number> = {}
  for (const j of (data ?? []) as any[]) {
    const n = Array.isArray(j?.rows?.rows) ? j.rows.rows.length : 0
    if (n > 0) m[j.attachment_id] = n
  }
  qtySavedCount.value = m
}

// 案件を切り替えたら読み直す（添付の一覧と同じタイミング）
watch(() => projectId.value, () => { void loadQtySavedCounts() })

/**
 * 数量抽出の結果を保存する。
 * ★以前はブラウザのメモリだけで、明細タブへ移って戻るだけで消えていた
 *  （2026-08-18 本番の通しレビュー）。解析はAIを呼ぶので時間も費用もかかる。それを毎回捨てていた。
 * ★保存先は材料抽出と同じ estimate_drawing_extract_jobs（kind='quantity'）。
 *  似たテーブルを2つ作ると「どちらを見るか」を毎回考えることになる。
 */
async function saveQuantityJob(att: any, status: 'running' | 'done' | 'error') {
  if (!att?.id || !projectId.value || !accountId) return
  const d = dqty.value
  await supabase.from('estimate_drawing_extract_jobs').upsert({
    account_id: accountId, project_id: projectId.value, attachment_id: att.id, kind: 'quantity',
    source_name: att.name ?? att.path ?? '', status,
    total_pages: d.total, done_pages: d.done,
    rows: { rows: d.rows, gridX: d.gridX, gridY: d.gridY, merged: d.merged },
    error: d.error || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'attachment_id,kind' })
  // ボタンの文言に出す件数もその場で更新する（次に開き直すまで古いままにしない）
  if (d.rows.length) qtySavedCount.value = { ...qtySavedCount.value, [att.id]: d.rows.length }
}

/** 保存済みの数量抽出があれば手元に戻す。無ければ false */
async function restoreQuantityJob(att: any): Promise<boolean> {
  if (!att?.id || !accountId) return false
  const { data } = await supabase.from('estimate_drawing_extract_jobs')
    .select('total_pages, done_pages, rows, error')
    .eq('account_id', accountId).eq('attachment_id', att.id).eq('kind', 'quantity').maybeSingle()
  const saved = (data as any)?.rows
  if (!saved?.rows?.length) return false
  dqty.value = {
    att, busy: false, done: (data as any).done_pages ?? 0, total: (data as any).total_pages ?? 0,
    rows: saved.rows, check: null, error: '', msg: '',
    failed: [], gridX: saved.gridX ?? null, gridY: saved.gridY ?? null, merged: saved.merged ?? [],
  }
  recheckQuantity()
  return true
}

/**
 * 「数量を抽出」を押した時の入口。
 * ★前回の結果があれば、まずそれを出す。解析し直すかは人が決める
 *  （毎回AIを呼ぶと待たされるうえ費用もかかる）。
 */
async function openQuantityExtract(att: any) {
  if (dqty.value.busy) return
  if (await restoreQuantityJob(att)) return
  await beginQuantityExtract(att)
}

async function beginQuantityExtract(att: any) {
  if (dqty.value.busy) return
  dqty.value = { att, busy: true, done: 0, total: 0, rows: [], check: null, error: '', msg: '',
                 failed: [], gridX: null, gridY: null, merged: [] }
  try {
    const { data: file, error } = await supabase.storage.from('estimate-drawings').download(att.path)
    if (error || !file) throw error ?? new Error('図面を取得できませんでした')
    const buf = new Uint8Array(await file.arrayBuffer())
    const { PDFDocument } = await import('pdf-lib')
    const src = await PDFDocument.load(buf)
    dqty.value.total = src.getPageCount()
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token ?? ''

    // 先に全ページを1枚ずつのPDFへ切り出す（AIへ渡す形にする）
    const pages: string[] = []
    for (let i = 0; i < dqty.value.total; i++) {
      const one = await PDFDocument.create()
      const [pg] = await one.copyPages(src, [i])
      one.addPage(pg)
      const bytes = await one.save()
      let bin = ''
      const chunk = 0x8000
      for (let k = 0; k < bytes.length; k += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(k, k + chunk)) as any)
      }
      pages.push(btoa(bin))
    }

    // ★数ページずつ同時に投げる。★1ページの失敗（504等）で全体を止めない。
    //  以前は break していたため、途中で 504 が出ると残りが丸ごと未処理のまま終わっていた。
    let cursor = 0
    const worker = async () => {
      for (;;) {
        const i = cursor++
        if (i >= pages.length) return
        const pageNo = i + 1
        try {
          absorbQuantityResult(await callQuantityExtract(pages[i], pageNo, token), pageNo)
        } catch (e: any) {
          dqty.value.failed.push({ pageNo, b64: pages[i], errorMsg: e?.message ?? '解析に失敗しました', retrying: false })
        }
        dqty.value.done++
      }
    }
    await Promise.all(Array.from({ length: Math.min(QTY_CONCURRENCY, pages.length) }, worker))

    // ★検算: 天井合計 ≒ 通り芯面積。抽出漏れ・二重計上をここで拾う
    recheckQuantity()
    if (dqty.value.failed.length) {
      dqty.value.error = `${dqty.value.failed.length}ページで解析エラーが出ました。下の「再試行」でそのページだけやり直せます。`
    }
    // ★ここで残す。残さないとページを移った瞬間に消え、また解析からやり直しになる
    await saveQuantityJob(att, dqty.value.failed.length ? 'error' : 'done')
  } catch (e: any) {
    dqty.value.error = e?.message ?? '数量の抽出に失敗しました'
  } finally {
    dqty.value.busy = false
  }
}

/** 失敗したページだけやり直す */
async function retryQuantityPage(fp: QtyFailedPage) {
  if (fp.retrying) return   // 連打で二重に取り込まないためのガード
  fp.retrying = true
  try {
    const { data: sess } = await supabase.auth.getSession()
    absorbQuantityResult(await callQuantityExtract(fp.b64, fp.pageNo, sess?.session?.access_token ?? ''), fp.pageNo)
    dqty.value.failed = dqty.value.failed.filter(p => p !== fp)
    if (!dqty.value.failed.length) dqty.value.error = ''
    recheckQuantity()
    await saveQuantityJob(dqty.value.att, dqty.value.failed.length ? 'error' : 'done')
  } catch (e: any) {
    fp.errorMsg = e?.message ?? '解析に失敗しました'
    fp.retrying = false
  }
}

/** 選んだ数量を明細の初期値として入れる（★確定ではない。単価・ロス率は人が入れる） */
const dqtyApplying = ref(false)
async function applyQuantityToItems() {
  // ★連打ガード（独立レビュー指摘）。disabled属性だけだと押下〜再描画の隙間で
  //  2回目が通り、同じ数量が二重に明細へ入る。
  if (dqtyApplying.value) return
  const picked = dqtyPicked.value
  if (!picked.length) return
  dqtyApplying.value = true
  try {
  const added: Row[] = []
  for (const x of picked) {
    let row = rows.value.find(r => isItemRow(r) && isBlankRow(r) && !added.includes(r))
    if (!row) { row = blankRow(); rows.value.push(row) }
    // ★品番の列には**メーカー品番**を入れる（符号ではない）。
    //  符号（AD-1 / C-01）はこの図面の中だけの記号なので、品番の列に入れても
    //  価格表・定価とは永久に当たらない。単価を引く鍵になるのはメーカー品番の方。
    //  （2026-08-19 本番レビュー: 63件すべて単価0。メーカー品番が仕様の文章に
    //    埋もれて品番の列が空だったのが原因。抽出側で分けるように直した）
    row.item_name = [x.part, x.code].filter(Boolean).join(' ') || '(名称未設定)'
    row.product_code = x.maker_code ?? ''
    row.spec = x.spec ?? ''
    row.quantity = x.value
    row.unit = x.unit
    added.push(row)
  }
  await autoSaveRows(added)
  dqty.value.msg = `${picked.length}件を明細に入れました（単価とロス率は人が入れてください）`
  builderTab.value = 'items'
  setTimeout(() => { dqty.value.msg = ''; dqty.value.att = null }, 2200)
  } finally { dqtyApplying.value = false }
}

const dextApplying = ref(false)
async function applyExtractToItems() {
  // ★連打ガード＋ローディング。件数が多いと数秒かかり、何も出ないと押せていないと
  //  思って連打され、同じ材料が二重に入る（数量側と同じ理由・2026-08-19）。
  if (dextApplying.value) return
  const picked = dextPicked.value
  if (!picked.length) return
  dextApplying.value = true
  try {
  const added: Row[] = []
  for (const x of picked) {
    let row = rows.value.find(r => isItemRow(r) && isBlankRow(r) && !added.includes(r))
    if (!row) { row = blankRow(); rows.value.push(row) }
    row.item_name = [x.manufacturer, x.part].filter(Boolean).join(' ') || x.code || '(名称未設定)'
    row.product_code = x.code || ''
    // 規格サイズは形状・詳細に入れる（W/D/Hは人が読み替える。自動で分解すると外す）
    row.spec = [x.size, x.spec].filter(Boolean).join(' / ')
    const q = Number(String(x.quantity ?? '').replace(/[^0-9.]/g, ''))
    if (Number.isFinite(q) && q > 0) row.quantity = q
    added.push(row)
  }
  await autoSaveRows(added)
  await loadMaterials()
  dext.value.msg = `${picked.length}件を明細に入れました`
  builderTab.value = 'items'
  setTimeout(() => { dext.value.msg = ''; dext.value.att = null }, 1800)
  } finally { dextApplying.value = false }
}

// ════════════════════════════════════════════════════════════
//  R21: 名称・品番の候補を画面上で編集・削除する
//  候補は「商社単価表」＋「過去に打った明細」から作られる（R28）。
//  ★消しても既存の見積の中身は変えない。候補に出なくなるだけ。
//   過去の見積の名称を書き換えると、出した帳票と食い違うため。
// ════════════════════════════════════════════════════════════
// ★R35: 名称の候補と品番の候補は別物として扱う（直したい対象が違う）。
//  ボタンもそれぞれの列の近くに置く。
const candModal  = ref(false)
const candKind   = ref<'name' | 'code'>('name')
function openCandModal(kind: 'name' | 'code') { candKind.value = kind; candFilter.value = ''; candModal.value = true }
const candFilter = ref('')
const candMsg    = ref('')
const candidatesFiltered = computed(() => {
  const q = candFilter.value.trim().toLowerCase()
  // 品番の候補を開いている時は、品番を持つものだけ出す（名称だけの作業内容は対象外）
  const base = candKind.value === 'code' ? materials.value.filter(m => (m.code ?? '').trim()) : materials.value
  const list = q ? base.filter(m => m.name.toLowerCase().includes(q) || (m.code ?? '').toLowerCase().includes(q)) : base
  return list.slice(0, 200)   // 一度に出しすぎない（絞り込んで使う想定）
})
/** 候補から外す。単価表由来なら単価表側も消す必要があるので、その旨を伝える */
async function removeCandidate(c: Material) {
  const fromPrice = matPrices.value.some(p =>
    (p.item_name ?? '').trim().toLowerCase() === c.name.trim().toLowerCase())
  const msg = fromPrice
    ? `「${c.name}」を候補から外します。\n※この名称は商社単価表にも登録されています。単価表の行は残るため、単価表から消さないと再び候補に出ます。`
    : `「${c.name}」を候補から外しますか？\n※すでに作った見積の中身は変わりません。`
  if (!window.confirm(msg)) return
  materials.value = materials.value.filter(m => m !== c)
  // 材料マスタ由来（移行期間の既存データ）なら実体も消す
  if (c.id) await supabase.from('estimate_materials').delete().eq('id', c.id)
  candMsg.value = '候補から外しました'
  setTimeout(() => { candMsg.value = '' }, 2000)
}

// ★R23: 商品情報はモーダルで見せる（明細の下に出すと縦に伸びて入力欄が押し下げられる）
// ★R37: サムネイルの列数。図面の見やすさは画面幅と図面の内容で変わるので人が決められるようにする
const thumbCols = ref(5)
const pinfoModal = ref<Row | null>(null)
const pinfoModalInfo = computed(() => pinfoModal.value ? productInfoOf(pinfoModal.value) : null)
/**
 * ★R31: アイコンの見た目で状態を伝える。
 *  未調査=虫眼鏡 / 調査中=砂時計 / 見つからなかった=赤バツ / 結果あり=青のi
 */
function pinfoIcon(r: Row): { name: string; cls: string; title: string } {
  if (pinfoBusyKey.value === productKeyOf(r)) return { name: 'hourglass_top', cls: 'busy', title: '調べています…' }
  const info = productInfoOf(r)
  if (!info) return { name: 'search', cls: '', title: 'この品番の商品情報をネット検索で調べる' }
  if (info.not_found) return { name: 'cancel', cls: 'none', title: '情報はありませんでした（押すと詳細）' }
  return { name: 'info', cls: 'done', title: '調べた商品情報を見る' }
}
/**
 * ★R31: 押した時にモーダルを強制的に開かない。
 *  調べている間もそのまま他のセルを打てるようにする（調査は数十秒かかることがある）。
 *  結果が出てからアイコンを押すとモーダルが開く。
 */
function onPinfoClick(r: Row) {
  const info = productInfoOf(r)
  if (info) { pinfoModal.value = r; return }        // 結果あり/なしが確定していれば見せる
  if (pinfoBusyKey.value === productKeyOf(r)) return  // 調査中は何もしない（待たせない）
  void lookupProductInfo(r, true)                   // まだなら調べるだけ。モーダルは開かない
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
// R19: Excel の R〜Y列（0.05/0.10/0.15/0.20 とそれぞれの見積単価）と同じ見比べ。
//  ★2026-07-28 に一度撤去したが、第3回レビューで復活の要望が出たため戻した。
//  計算は既存の priceAtMargin をそのまま使う（自動単価と同じ式でないと見比べにならない）。
const MARGIN_PRESETS = [0.05, 0.10, 0.15, 0.20] as const
/** その率の単価を採用する（＝手打ち扱い。以降は粗利率を変えても勝手に動かない） */
function applyMarginToRow(r: Row, rate: number) {
  r.unit_price = priceAtMargin(r, rate)
  r._priceTouched = true
}
const showBreakdown = ref(false)

const isMaterialRow = (r: Row) => !!(r.product_code ?? '').trim()
/**
 * 商社を出してよい行か。
 * 品番が無くても、マスタで商社別単価が登録されている材料（品名で選んだケース）は
 * 材料として扱う。品番の有無だけで切ると、その動線で商社が選べなくなる。
 */
const hasSupplierChoice = (r: Row) => isMaterialRow(r) || pricesForRow(r.material_id, r.product_code).length > 0

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
  const code = normalizeName(r.product_code)
  if (!code) return
  const m = materials.value.find(x => normalizeName(x.code ?? '') === code)
  if (!m) return
  r.material_id = m.id ?? null
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
  // ★照合の正規化は「もしかして」と同じ関数を使う。別々だと
  //   「もしかして側は一致と判断／解決側は不一致」で候補も自動補完も出ない穴ができる。
  const nm = normalizeName(r.item_name)
  if (!nm) { r.material_id = null; return }
  const m = materials.value.find(x => normalizeName(x.name) === nm)
  if (m) {
    r.material_id = m.id ?? null
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
  builderTab.value = 'intake'   // ★R54: 既定タブは案件情報
  currentPage.value = 0   // 案件を開いたら先頭ページへ
  editingName.value = false
  if (!projectId.value) { markSaved(); return }
  const [{ data }, { data: pj }] = await Promise.all([
    supabase.from('estimate_items')
      .select('id, category_id, trade_id, trade_name, material_id, supplier_id, item_name, spec, product_code, dim_w, dim_d, dim_h, row_type, unit, quantity, cost_unit_price, unit_price, note')
      .eq('project_id', projectId.value).order('sort_order'),
    supabase.from('estimate_projects')
      .select('construction_location, period_text, valid_until, memo, adjustment, margin_rate, request_date, due_date, status, lost_reason, is_draft').eq('id', projectId.value).single(),
  ])
  isDraftProject.value = !!pj?.is_draft
  rows.value = (data ?? []).map((d: any) => ({
    id: d.id, _k: ++rowKey, location: d.note ?? '', trade_id: d.trade_id, trade_name: d.trade_name ?? '',
    spec: d.spec ?? '', row_type: (d.row_type === 'header' ? 'header' : 'item'),
    // ★保存している列は必ずここでも読み戻すこと。読み戻し漏れは
    //   「開く→保存」で列が消える形のデータ欠損になる（品番・寸法で実際に踏んだ）。
    product_code: d.product_code ?? '',
    dim_w: d.dim_w == null ? null : Number(d.dim_w),
    dim_d: d.dim_d == null ? null : Number(d.dim_d),
    dim_h: d.dim_h == null ? null : Number(d.dim_h),
    cost_unit_price: Number(d.cost_unit_price) || 0,
    // ★客先単価が入っている行だけ「人が決めた値」として尊重する。
    //   0 を手打ち扱いにすると、原価だけ入った行（最安採用・図面からの抽出など）を
    //   開き直した後に客先単価が永久に生えなくなる。
    _priceTouched: (Number(d.unit_price) || 0) > 0,
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
  // ★R53: 前回の材料抽出（中断・完了）を復元する。タブを閉じた分はここで「中断」として出る
  await loadJobsForProject(projectId.value)
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
/**
 * ★R33: 行を消したら「元に戻す」を出す。
 *  R22でリアルタイム保存にしたため、削除は即DBに効く。
 *  取り消しが無いと、誤操作で明細が消えたことに気づかないまま提出する事故が起きる。
 *  戻す時は同じ内容で作り直す（元のidは復元しない＝並び順は sort_order で決まるので支障ない）。
 */
const undoRow = ref<{ row: Row; index: number } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | null = null
function removeRow(i: number) {
  const r = rows.value[i]
  if (r.id) void supabase.from('estimate_items').delete().eq('id', r.id).then(() => markAutoSaved())
  rows.value.splice(i, 1)
  if (isBlankRow(r)) return          // 空行を消しただけなら知らせる意味が無い
  undoRow.value = { row: { ...r, id: null }, index: i }
  if (undoTimer) clearTimeout(undoTimer)
  undoTimer = setTimeout(() => { undoRow.value = null }, 15000)   // 気づける長さは要る
}
async function undoRemoveRow() {
  const u = undoRow.value
  if (!u) return
  undoRow.value = null
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = null }
  const at = Math.min(u.index, rows.value.length)
  const restored: Row = { ...u.row, _k: ++rowKey }
  rows.value.splice(at, 0, restored)
  await autoSaveRow(restored)
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
// 各ブロックの末尾に常に確保しておく空行数。
// ★5→1（2026-08-04 ユーザー要望）: 工種ごとに空行を5本置くと明細が縦に伸びて
//  全体を見渡せなかった。1本でも「打つと下に1本補充される」ので打ち続けられ、
//  Excel感覚（行が足りない心配をしない）は維持される。
const SPARE_ROWS = 1

/** 中身が空＝まだ何も打たれていない行。場所/工種はブロックから継承するので判定に含めない */
function isBlankRow(r: Row): boolean {
  return !(r.item_name || '').trim() && !(r.spec || '').trim() && !(r.product_code || '').trim() && !(r.unit || '').trim()
    && !(Number(r.quantity) || 0) && !(Number(r.cost_unit_price) || 0) && !(Number(r.unit_price) || 0)
    && r.dim_w == null && r.dim_d == null && r.dim_h == null   // 寸法だけ入れた行を空扱いで消さない
    && !r.material_id && !r.supplier_id
}
const blockKeyOf = (r: Row) => `${r.location ?? ''}\u001f${r.trade_name ?? ''}`

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
  void autoSaveRows(b.idxs.map(i => rows.value[i]))   // R22: まとめて変えた分も即保存
}
/** 場所を変えたら、その場所配下の**全工種の全行**に反映する（一対多の実体） */
function onAreaLocation(a: Area, value: string) {
  for (const b of a.blocks) for (const i of b.idxs) rows.value[i].location = value
  void autoSaveRows(a.blocks.flatMap(b => b.idxs.map(i => rows.value[i])))
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

// ════════════════════════════════════════════════════════════
//  R22: 明細のリアルタイム保存（保存ボタン廃止）
//
//  2026-07-29 ユーザー回答:「完全自動・ボタン廃止」
//  セルを離れたら即保存し、右上に「保存しました HH:MM」を出す。
//  未保存警告（離脱ガード）も無くす＝そもそも未保存の状態が存在しない。
//
//  ★1行ずつ直列化して保存する理由
//   同じ行を続けて編集すると、先に投げた古い値のリクエストが後着して
//   新しい値を上書きする（last-write-wins）。実行時に最新stateを読む関数を
//   鎖にすることで、順序保証と最新値への合流を同時に満たす。
// ════════════════════════════════════════════════════════════
const saveChains = new Map<string, Promise<unknown>>()
function serializeSave(key: string, fn: () => Promise<unknown>): Promise<unknown> {
  const next = (saveChains.get(key) ?? Promise.resolve()).catch(() => {}).then(fn)
  saveChains.set(key, next)
  return next
}
const savedAt = ref('')
function markAutoSaved() {
  const d = new Date()
  savedAt.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function itemPayload(r: Row, order: number) {
  return {
    account_id: accountId, project_id: projectId.value,
    trade_id: r.trade_id || null, material_id: r.material_id || null, supplier_id: r.supplier_id || null,
    item_name: r.item_name || '(無題)',
    unit: r.unit || null, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0,
    note: r.location || null, sort_order: order,
    trade_name: r.trade_name || null, spec: r.spec || null, product_code: r.product_code || null, row_type: r.row_type,
    dim_w: r.dim_w ?? null, dim_d: r.dim_d ?? null, dim_h: r.dim_h ?? null,
    cost_unit_price: r.cost_unit_price || null,
  }
}

/** 1行を保存する。空になった行は削除する（人が消したのと同義） */
async function doSaveRow(r: Row) {
  if (!projectId.value || loadingItems) return
  saveError.value = ''
  const order = rows.value.indexOf(r)
  if (isBlankRow(r)) {
    if (r.id) { await supabase.from('estimate_items').delete().eq('id', r.id); r.id = null; markAutoSaved() }
    return
  }
  const payload = itemPayload(r, order < 0 ? 0 : order)
  if (r.id) {
    const { error } = await supabase.from('estimate_items').update(payload).eq('id', r.id)
    if (error) { saveError.value = error.message; return }
  } else {
    const { data, error } = await supabase.from('estimate_items').insert(payload).select('id').single()
    if (error) { saveError.value = error.message; return }
    if (data) r.id = (data as any).id
  }
  rememberAsCandidate(r)
  markAutoSaved()
}

/**
 * 打った名称をその場で候補に足す。
 * ★保存のたびに候補を全件読み直す（loadMaterials）のは重いので、手元の一覧に足すだけにする。
 *   これをやらないと「1行目に打った名前が2行目の予測変換に出ない」（自動保存にして実際に踏んだ）。
 */
function rememberAsCandidate(r: Row) {
  const nm = (r.item_name ?? '').trim()
  if (!nm || nm === '(無題)') return
  const key = nm.toLowerCase()
  const cur = materials.value.find(m => m.name.trim().toLowerCase() === key)
  if (cur) {
    if (!cur.unit && r.unit) cur.unit = r.unit
    if (!cur.code && r.product_code) cur.code = r.product_code
    return
  }
  materials.value = [...materials.value, {
    id: r.material_id ?? null, name: nm, unit: r.unit || null, code: r.product_code || null,
  }].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
}
/** セルを離れた時に呼ぶ入口。行ごとに直列化する */
function autoSaveRow(r: Row) { return serializeSave(`row:${r._k}`, () => doSaveRow(r)) }
/** ブロック（工種）や場所をまとめて変えた時など、複数行を保存する */
async function autoSaveRows(list: Row[]) { for (const r of list) await autoSaveRow(r) }

/**
 * 全行を保存する（並び替え後の sort_order 反映・比較選定からの流し込み等）。
 * 保存ボタンは無いので、人が押す用途ではなくプログラムから呼ぶためのもの。
 */
async function save() {
  if (!projectId.value) return
  saving.value = true; saveError.value = ''
  try {
    if (removedIds.value.length) {
      await supabase.from('estimate_items').delete().in('id', removedIds.value)
      removedIds.value = []
    }
    for (const r of rows.value) await autoSaveRow(r)
    await loadMaterials()   // 打った名称がそのまま次回の候補になる（材料マスタは介さない）
    await saveDocFields()
  } catch (e: any) {
    saveError.value = e?.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}
/** 見積書フィールド（工事場所/工期/有効期限/MEMO/端数調整/粗利率） */
async function saveDocFields() {
  if (!projectId.value) return
  await supabase.from('estimate_projects').update({
    construction_location: doc.value.construction_location || null, period_text: doc.value.period_text || null,
    margin_rate: doc.value.margin_rate,
    valid_until: doc.value.valid_until || null, memo: doc.value.memo || null, adjustment: Number(doc.value.adjustment) || 0,
  }).eq('id', projectId.value)
  markAutoSaved()
}

/**
 * ★解析中だけの離脱ガード（2026-08-18 通しレビュー）。
 *  数量抽出はブラウザの中で走るので、ブラウザバックやタブを閉じると途中で消える。
 *  実際にレビュー中に戻ってしまい、解析がやり直しになった。
 *  ★「未保存の編集」に対するガードは R22 で意図的に撤去されている（自動保存にしたため）。
 *   ここで復活させるのはその話ではなく、**走っている処理が消える**時だけに限る。
 *   材料抽出はサーバ側のジョブとして残るので対象外。
 */
onBeforeRouteLeave((_to, _from, next) => {
  if (!dqty.value.busy) return next()
  next(window.confirm('数量の抽出が進行中です。このページを離れると解析は中断されます。移動しますか？'))
})
function guardUnloadWhileExtracting(e: BeforeUnloadEvent) {
  if (!dqty.value.busy) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', guardUnloadWhileExtracting))
onUnmounted(() => window.removeEventListener('beforeunload', guardUnloadWhileExtracting))

// #3 編集中の離脱ガード: 未保存の明細がある状態で 遷移/タブ閉じ/案件切替 時に確認する
let lastLoadedProjectId: string | null = null   // 同じ案件の二重読み込みを避けるための記録
// ★R22: リアルタイム保存にしたので「未保存」という状態が無くなった。
//   保存ボタン・離脱ガード（ルート遷移確認 / beforeunload）はいずれも撤去。
//   markSaved は読み込み完了時の互換のために残すが、何もしない。
function markSaved() { /* no-op: 自動保存になったので基準の更新は不要 */ }

onMounted(async () => {
  accountId = await getAccountId()
  await Promise.all([loadProjects(), loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadContractors(), loadSubContacts(), loadCompany(), loadSites()])
  // 一覧から開いた案件（?project=<id>）を初期選択
  const qp = route.query.project
  const pid = Array.isArray(qp) ? qp[0] : qp
  if (pid && projects.value.some(p => p.id === pid)) { projectId.value = pid as string; await loadItems() }
  // ★R51: 「＋新規見積」から来た（?step=1）／案件名が未確定の下書きなら、ステップ入力から始める
  const stepQ = Array.isArray(route.query.step) ? route.query.step[0] : route.query.step
  if (projectId.value && (stepQ || isDraftProject.value)) {
    wizard.value = { on: true, step: Number(stepQ) || 1, name: '', err: '' }
  }
  await refreshExtractBadge()
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
/* 未登録の注意書き。muted（薄いグレー）のままだと見落とすので色だけ起こす */
.warn-inline { color: #b45309; margin: 0 0 6px; }
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
/* ★R25: 白黒コピー対応。グレー地は潰れて金額が読めなくなるので枠線で見せる */
.est-amounts .band { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; padding: 6px 8px; border: 2px solid #333; }
.est-amounts .band.sub { border-width: 1px; }
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
/* ★R25: 白黒コピー前提。色地は潰れて読めなくなるので使わない（枠線と太字で区切る） */
.bd-table th { background: #fff; text-align: center; font-weight: 700; border-bottom: 2px solid #333; }
/* 場所（大項目）・工種（中項目）の見出し行。Excelの （壁面工事） / ■軽鉄工事 と同じ */
.bd-table .bd-area td { font-weight: 700; border-left: none; border-right: none; padding-top: 8px; }
.bd-table .bd-trade td { font-weight: 700; padding-left: 14px; border-left: none; border-right: none; }
.bd-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.bd-table .r { text-align: right; font-weight: 700; }
.bd-table .neg { color: #c00; }
.bd-table tfoot .bd-grand td { font-weight: 700; border-top: 2px solid #333; }
.est-detail { margin-top: 16px; }
.est-detail .dh { font-weight: 700; padding: 4px 8px; border-left: 4px solid #333; }
.est-detail .dsub { font-weight: 600; color: #444; font-size: 11px; }
.pdf-title { text-align: center; font-size: 22px; letter-spacing: 4px; margin: 0 0 16px; }
.pdf-meta { font-size: 13px; line-height: 1.7; margin-bottom: 10px; }
.pdf-client { font-size: 15px; font-weight: 700; }
.pdf-total { font-size: 16px; font-weight: 700; border: 2px solid #333; display: inline-block; padding: 6px 14px; margin: 8px 0 16px; }
.pdf-group { margin-bottom: 14px; }
.pdf-group-head { font-weight: 700; padding: 5px 8px; border-left: 4px solid #333; }
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
.cheap-btn { display: block; margin-top: 3px; padding: 1px 6px; border: 1px solid #FDE68A; border-radius: 10px;
             background: #FEF3C7; color: #B45309; cursor: pointer; font-size: 10px; white-space: nowrap; }
.cheap-btn:hover { background: #FDE68A; }
.cheap-now { display: block; margin-top: 3px; font-size: 10px; color: #059669; font-weight: 700; }
.na-cell { color: #C0C8D2; font-size: 12px; padding-left: 6px; }
/* R18: 内訳を畳んだら明細を全幅に */
.grid.grid-wide { grid-template-columns: 1fr; }
/* R18: ヘッダー固定＋内部スクロール（40行超の実案件でも見出しを見失わない） */
/* ★R29: 明細は画面の余白いっぱいまで使う（打つ行数が多いので縦が命） */
.items-scroll { max-height: calc(100vh - 300px); min-height: 420px; overflow: auto; }
/* ★R30: 三段のスティッキー。上から 列見出し → 場所 → 工種 の順に積む。
   段の高さが変わると重なるので、実測に合わせた固定値で積んでいる。
   スクロールすると、下の段（工種）から順に押し上げられて入れ替わる。 */
.est-items thead th { position: sticky; top: 0; z-index: 30; background: #fff; box-shadow: 0 1px 0 #E2E8F0; }
/* ★セルに sticky を付けても、セルは自分の行の高さに閉じ込められて動けない。
   行(tr)そのものを sticky にする（border-collapse:separate が前提）。 */
.est-items tr.sticky-area { position: sticky; top: 28px; z-index: 20; }
.est-items tr.sticky-trade { position: sticky; top: 75px; z-index: 10; }
/* 固定中に下の行が透けないよう、行にも地色を敷く */
.est-items tr.sticky-area td, .est-items tr.sticky-trade td { background-clip: padding-box; }
/* R19: 粗利パターン */
.margin-preview-row td { background: #FBFCFD; }
.mp-cells { padding: 3px 0; }
.mp-label { font-size: 11px; color: #999; margin-right: 8px; }
.mp-col { width: 84px; }
.mp-cell { display: block; width: 100%; padding: 2px 4px; border: 1px solid #D5DEE8; border-radius: 5px;
           background: #fff; cursor: pointer; font-size: 11px; font-variant-numeric: tabular-nums; }
.mp-cell:hover { background: #EEF4FF; border-color: #4A7BC8; }
.mp-cell.active { border-color: #2F6FD0; background: #EEF4FF; }
.mp-pct { font-size: 10px; color: #7A8AA0; }
.mp-val { font-size: 12px; font-weight: 600; }
.hc-alt { display: block; font-size: 10px; color: #B45309; }
.pinfo-ask { display: block; margin-top: 3px; padding: 1px 6px; border: 1px solid #D5DEE8; border-radius: 10px; background: #fff; cursor: pointer; font-size: 11px; color: #4A7BC8; }
.pinfo-ask:hover { background: #EEF4FF; border-color: #4A7BC8; }
/* R23: 品番セルの虫眼鏡 */
.code-cell { white-space: nowrap; }
.code-in { width: calc(100% - 26px); }
.pinfo-ico { border: 0; background: transparent; cursor: pointer; color: #7A8AA0; padding: 0 2px; vertical-align: middle; }
.pinfo-ico:hover { color: #2F6FD0; }
.pinfo-ico.done { color: #2F6FD0; }
.pinfo-ico.busy { color: #F0A500; }
.pinfo-ico.none { color: #DC2626; }   /* 見つからなかった＝赤バツ（R31） */
.pinfo-ico .ico { font-size: 16px; vertical-align: middle; }
.modal-back { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal-card.wide { width: min(760px, 94vw); }
.btn-icon { border: 0; background: transparent; cursor: pointer; color: #7A8AA0; padding: 0 2px; }
.btn-icon:hover { color: #2F6FD0; }
.btn-icon .ico { font-size: 18px; vertical-align: middle; }
.trade-add { display: flex; gap: 6px; margin-bottom: 10px; }
.trade-list { list-style: none; margin: 0; padding: 0; max-height: 46vh; overflow-y: auto; }
.trade-list li { display: flex; gap: 6px; align-items: center; margin-bottom: 5px; }
.cand-list { max-height: 48vh; overflow-y: auto; margin-top: 8px; }
.cand-row { display: grid; grid-template-columns: 1fr 180px 80px 32px; gap: 6px; margin-bottom: 5px; }
.cand-row.code-first { grid-template-columns: 200px 1fr 80px 32px; }
.dsend-cols { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: #7A8AA0; }
.col-btn { min-width: 24px; padding: 1px 5px; border: 1px solid #D5DEE8; border-radius: 5px; background: #fff; cursor: pointer; font-size: 11px; }
.col-btn.on { background: #2F6FD0; border-color: #2F6FD0; color: #fff; }
.modal-card { background: #fff; border-radius: 10px; padding: 16px 18px; width: min(560px, 92vw); max-height: 86vh; overflow: auto; }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.pinfo-loading { display: flex; align-items: center; gap: 8px; color: #666; padding: 18px 0; }
.spin-dot { width: 14px; height: 14px; border: 2px solid #D5DEE8; border-top-color: #2F6FD0; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.pinfo-body-modal { display: flex; gap: 14px; align-items: flex-start; }
.pinfo-img-lg { width: 160px; height: 160px; object-fit: contain; border: 1px solid #E2E8F0; border-radius: 6px; }
.pinfo-dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 13px; margin: 0; }
.pinfo-dl dt { color: #7A8AA0; }
.pinfo-dl dd { margin: 0; }

/* ── R8: 図面のページ選択→送信 ── */
/* R24: 落とせる範囲が狭いと狙いを外すので縦に広げる（レビュー2026-07-29） */
.att-drop { border: 1px dashed #C7D2DE; border-radius: 8px; padding: 22px 12px; min-height: 88px;
            display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
            transition: background .12s, border-color .12s; }
.att-drop.over { border-color: #4A7BC8; background: #EEF4FF; }
.dsend-tools { display: flex; align-items: center; gap: 12px; margin: 8px 0; flex-wrap: wrap; }
.dsend-range { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #555; }
.dsend-count { font-size: 12px; color: #7A8AA0; margin-left: auto; }
.dsend-pages { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; padding: 6px; background: #FAFBFC; border-radius: 6px; }
/* R24: 中身を見て選ぶので、3〜4カラムで大きく見せる（幅に応じて自動で列数が変わる） */
.dqty-failed { margin: 8px 0 0; padding: 8px 10px; list-style: none; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; }
.dqty-failed li { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #991B1B; padding: 2px 0; }
.btn-retry-sm { padding: 2px 10px; border: 1px solid #DC2626; border-radius: 999px; background: #fff; color: #DC2626; font-size: 11px; font-weight: 700; cursor: pointer; }
.btn-retry-sm:disabled { opacity: .5; cursor: default; }
.att-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.att-thumb { padding: 0; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; line-height: 0; }
.att-thumb img { display: block; width: 96px; height: auto; border-radius: 3px; }
.dsend-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;
                max-height: 620px; overflow-y: auto; padding: 10px; background: #FAFBFC; border-radius: 6px; }
.pg-card { border: 2px solid #D5DEE8; border-radius: 8px; background: #fff; cursor: pointer; overflow: hidden; }
.pg-card.on { border-color: #2F6FD0; box-shadow: 0 0 0 2px rgba(47,111,208,.18); }
.pg-thumb { height: 260px; display: flex; align-items: center; justify-content: center; background: #F2F4F7; overflow: hidden; }
.pg-thumb img { width: 100%; height: 100%; object-fit: contain; }
.pg-loading { color: #B9C2CD; font-size: 20px; }
.pg-foot { display: flex; align-items: center; gap: 6px; padding: 5px 8px; font-size: 12px; border-top: 1px solid #EDF0F4; cursor: pointer; }
.dsend-preview { margin-top: 10px; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; }
.dsp-head { padding: 6px 10px; background: #F5F7FA; font-size: 12px; color: #555; }
.dsp-frame { width: 100%; height: 420px; border: 0; display: block; }
.dsend-contacts { display: flex; flex-wrap: wrap; gap: 12px; }
.cc-check { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
.dext-list { max-height: 46vh; }
.dext-note { font-size: 11px; color: #B45309; max-width: 180px; }
.dsend-to { font-size: 12px; color: #7A8AA0; word-break: break-all; }

/* ── 明細のブロック（場所×工種）── */
.blk-row td { background: #EEF2F7; border-top: 2px solid #D5DEE8; padding: 6px 8px; }
.blk-fields { display: flex; align-items: center; gap: 8px; }
.blk-input { min-width: 320px; font-weight: 600; background: #fff; }
.blk-sep { color: #90A4B8; font-weight: 700; }
.blk-count { font-size: 11px; color: #7A8AA0; }
.blk-del { margin-left: auto; }
.area-row td { background: #E3EAF3; border-top: 2px solid #C3D0E0; padding: 6px 8px; }
.area-label { font-size: 11px; color: #5A6C82; font-weight: 700; }
.area-input { min-width: 360px; font-weight: 700; background: #fff; }
.area-add { margin-left: 4px; }
.blk-indent { padding-left: 22px; }
.dim-col { width: 62px; }
.input.xs.num { width: 56px; }
.blk-add-row td { padding: 10px 8px; background: #FAFBFC; }
/* 列が多いので詰める。入力欄は列幅に追従させる */
/* ★R30: tbody のセルは border-collapse:collapse だと position:sticky が効かない（Chromeの制約）。
   場所・工種の見出しを固定するために separate に切り替える。
   罫線は行の border で描いているので見た目は変わらない。 */
.est-items { min-width: 1180px; border-collapse: separate; border-spacing: 0; }
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
.att-name-static { font-size: 13px; color: #333; }
.draft-warn { font-size: 11px; font-weight: 700; color: #B45309; background: #FEF3C7; border-radius: 10px; padding: 2px 8px; }
/* R53 解析中の進捗（タブ列に常時表示） */
.ext-chip { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; font-size: 12px;
  font-weight: 700; color: #06864a; background: #e8f9ef; border-radius: 12px; padding: 4px 12px; white-space: nowrap; }
/* ── R51 新規見積のステップ入力 ── */
/* ★820pxだと画面の大半が余白だった（2026-08-19）。図面のサムネイルや抽出の一覧は
   横を使ったほうが見やすい。ただし無制限に伸ばすと入力欄が間延びするので上限は残す。 */
.wiz { max-width: 1180px; }
.wiz-steps { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
/* ★押せるようになったので、押せると分かる見た目にする（カーソル・ホバー） */
.wiz-step {
  font-size: 12px; font-weight: 700; color: #94a3b8; background: #f1f5f9;
  border: 1px solid transparent; border-radius: 14px; padding: 5px 12px;
  cursor: pointer; font-family: inherit;
}
.wiz-step:hover { border-color: #cbd5e1; background: #e2e8f0; }
.wiz-step.on   { color: #fff; background: #06A050; }
.wiz-step.on:hover { background: #05904a; border-color: transparent; }
.wiz-step.done { color: #06864a; background: #e8f9ef; }
.wiz-step.done:hover { background: #d7f3e3; border-color: #a7e3c4; }
.wiz-exit { margin-left: auto; }
/* ステップ2「図面から材料と数量を読み取る」。任意の操作だと分かるよう囲って区切る */
.ext-offer { margin-top: 18px; padding: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; }
.ext-offer .sub-h { margin: 0 0 4px; font-size: 14px; }
.ext-offer .hint { margin: 0 0 12px; }
.ext-cards { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 12px; }
.ext-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  width: 190px; padding: 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
}
.ext-thumb { width: 100%; height: 110px; padding: 0; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; overflow: hidden; }
.ext-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.ext-thumb-empty { display: flex; align-items: center; justify-content: center; cursor: default; color: #cbd5e1; }
.ext-thumb-empty .material-symbols-rounded { font-size: 40px; }
/* ファイル名は長いので1行に丸める。全文は title 属性で出す */
.ext-name { font-size: 12px; color: #475569; width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wiz-actions { display: flex; align-items: center; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
.wiz-con-btns { display: flex; gap: 8px; }
/* ── R55 元請け・担当者のその場編集 ── */
.con-contact-row { display: grid; grid-template-columns: 1fr 1.4fr auto; gap: 6px; margin-bottom: 6px; }
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
.qocr-panel { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; margin-top: 12px; background: #fafafa; }
.sub-h { font-size: 14px; font-weight: 700; }

/* R46: 単価区分の推定チップ。押すまで確定しないので、確定済みの選択と見た目を分ける */
.kind-guess { display: block; margin-top: 3px; width: 100%; text-align: left; cursor: pointer;
  background: #fffbeb; border: 1px dashed #fbbf24; color: #92400e; border-radius: 6px;
  padding: 2px 6px; font-size: 10px; line-height: 1.3; }
.kind-guess:hover { background: #fef3c7; }
.kind-guess-why { display: block; opacity: .85; }
</style>
