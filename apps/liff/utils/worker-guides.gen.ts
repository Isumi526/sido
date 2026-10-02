// ⚠️ AUTO-GENERATED from shared/worker-guides.ts — DO NOT EDIT.
// 共有ロジックの正本は shared/worker-guides.ts。編集したら `npm run sync:shared` で本ファイルを再生成すること。

// ============================================================
//  shared/worker-guides.ts — 作業員アプリの画面ごとの「使い方」（2026-10-02 設計「見やすさと分かりやすさ」II-4）
//
//  作業員アプリの見出しの横の「使い方」で出す文面の正本。
//  ★II-5（作業員アプリの AI チャット）が答える根拠もここだけにする（二重管理しない）。
//   ここに無い手順を AI が作らないように、書いてあることだけが「使い方」として正しい内容。
//  ★画面の文言（ボタン名など）と食い違わせない。ボタン名を変えたらここも直す。
//  ★お客様の画面に出る文。LINE は使っていない（作業員アプリは Web アプリ）ので「LINE で」と書かない。
//  編集したら npm run sync:shared で各アプリへ展開する。
// ============================================================

export type GuideLang = 'ja' | 'en'
export type GuideSection = { heading: Record<GuideLang, string>; steps: Record<GuideLang, string[]> }
export type WorkerGuide = {
  key: string
  title: Record<GuideLang, string>
  /** その画面でできること（1〜2文） */
  summary: Record<GuideLang, string>
  sections: GuideSection[]
}

export const WORKER_GUIDES: WorkerGuide[] = [
  {
    key: 'checkin',
    title: { ja: '出退勤', en: 'Check in / out' },
    summary: {
      ja: '出勤と退勤を記録する画面です。1日に出勤1回・退勤1回を記録します。',
      en: 'Record when you start and finish work. You record one check-in and one check-out per day.',
    },
    sections: [
      {
        heading: { ja: '出勤するとき', en: 'When you start work' },
        steps: {
          ja: [
            'この画面を開き、今日の稼働を選びます（稼働あり／有給（終日）／稼働なし）。有給・稼働なしを選ぶと、打刻はせずにその日の日報が送られて終わります。',
            '確認事項が出たら、読んで全部にチェックします。',
            '「出勤を記録する」を押します。押すと現在地も一緒に記録します（勤怠の確認のためだけに使います）。',
            '位置が取れない時は理由の欄が出ます。理由を書けば記録できます。',
          ],
          en: [
            'Open this screen and choose your status for today (Working / Paid leave (full day) / Not working). If you choose Paid leave or Not working, there is no punch: your daily report for that day is sent and you are done.',
            'If check items appear, read them and check all of them.',
            'Tap "Record check-in". Your location is recorded at the same time (used only to confirm attendance).',
            'If your location cannot be found, a reason box appears. Write the reason and you can still record.',
          ],
        },
      },
      {
        heading: { ja: '退勤するとき', en: 'When you finish work' },
        steps: {
          ja: [
            '同じ画面を開くと退勤の画面になります。確認事項があればチェックして「退勤を記録する」を押します。',
            '押すとそのまま日報の画面に移ります。続けて日報を書いてください。',
            '夜勤明けにそのまま日中も働く時などは、「もう一度 出勤する」から同じ日に2回目の出退勤ができます。',
          ],
          en: [
            'Open the same screen and it shows check-out. Check the items if any, then tap "Record check-out".',
            'You then go straight to the daily report screen. Please write your daily report.',
            'If you work again on the same day (for example after a night shift), use "Check in again" to record a second check-in and check-out.',
          ],
        },
      },
      {
        heading: { ja: '打刻を忘れた・間違えたとき', en: 'If you forgot or made a mistake' },
        steps: {
          ja: [
            '記録の画面の下にある「打刻を忘れた・間違えた時は」を開きます。',
            '押し忘れた日は「打刻を忘れた日を入力する」から、日付と時刻を入れて記録します（今日から4日前まで）。あとから入れた分と分かるように残ります。',
            '押し間違えた時は「打刻を間違えた時の修正申請」から、直したい打刻を選び、何を直すか（出勤・退勤を押し間違えた／時刻が違う／この打刻自体が要らない）と理由を入れて申請します（直近7日まで）。',
            '修正は承認されると直ります。結果は同じ場所に「承認されました」「却下されました」と出ます。',
          ],
          en: [
            'Open "Forgot or mis-pressed a punch?" at the bottom of the record screen.',
            'If you forgot to record a day, use "Enter a day you forgot to punch" and enter the date and times (up to 4 days ago). It is saved as entered later.',
            'If you tapped by mistake, use "Request a punch correction", choose the punch, choose what to fix (pressed check-in/check-out by mistake / the time is wrong / this punch should not exist) and write the reason (punches from the last 7 days).',
            'A correction is applied after it is approved. The result ("Approved" / "Rejected") appears in the same place.',
          ],
        },
      },
    ],
  },
  {
    key: 'report',
    title: { ja: '日報', en: 'Daily report' },
    summary: {
      ja: 'その日の稼働・現場・時間・経費を送る画面です。休みの日も「稼働なし」で送ります。',
      en: 'Send your work, sites, hours and expenses for the day. On days off, send it as "Not working".',
    },
    sections: [
      {
        heading: { ja: '書き方', en: 'How to write it' },
        steps: {
          ja: [
            '日付を確かめます（自動で選ばれます）。',
            '稼働（稼働あり／有給／稼働なし）を選びます。',
            '入った現場を選び、作業区分と時間を入れます。現場が複数ある日は現場を追加します。',
            '経費があれば「あり」にして入れます。領収書は写真で添付でき、読み取って自動で入力することもできます。',
            '内容を確かめて送信します。途中で閉じても下書きが残るので、続きから入れられます。',
          ],
          en: [
            'Check the date (it is selected automatically).',
            'Choose your status (Working / Paid leave / Not working).',
            'Choose the site you worked at and enter the work category and hours. If you worked at more than one site, add a site.',
            'If you have expenses, set them to "Yes" and enter them. You can attach a photo of the receipt, and it can be read to fill in the fields automatically.',
            'Check the contents and send. If you close the screen, your draft is kept and you can continue later.',
          ],
        },
      },
      {
        heading: { ja: '期限と直し方', en: 'Deadline and corrections' },
        steps: {
          ja: [
            '日報の送信と直しは、今日を含む過去3日以内です。',
            'それより前の日を直したい時は、理由を書いて申請し、承認されると直せます。',
            '定時より後の時刻を入れるには、残業申請が要ります（当日の16:00まで）。',
          ],
          en: [
            'You can send and correct a daily report within 3 days, including today.',
            'To correct an older day, write the reason and send a request. You can correct it after it is approved.',
            'To enter a time after the regular end time, you need an overtime request (by 16:00 on that day).',
          ],
        },
      },
    ],
  },
  {
    key: 'todo',
    title: { ja: 'やること（承認）', en: 'To do (approvals)' },
    summary: {
      ja: 'お知らせの「やること」に、あなたが対応するものが出ます。承認する立場の人には、承認待ちの申請が出ます。',
      en: 'The "To do" tab in Notices shows what you need to handle. If you are an approver, requests waiting for approval appear here.',
    },
    sections: [
      {
        heading: { ja: 'やることの見方', en: 'Reading the to-do list' },
        steps: {
          ja: [
            '画面右上のベルを押し、「やること」を開きます。数字は件数です。',
            '承認待ちの残業申請・日報・打刻修正・距離超過は、押すとこのアプリで承認・却下（日報は差し戻し）できます。',
            '経費精算の申請・在庫の確認待ちは、押すと管理画面が開きます（処理は管理画面で）。',
          ],
          en: [
            'Tap the bell at the top right and open "To do". The number shows how many.',
            'Overtime requests, daily reports, punch corrections and distance overages waiting for approval can be approved or rejected in this app (daily reports can be sent back).',
            'Expense applications and inventory checks open the admin screen (handle them there).',
          ],
        },
      },
      {
        heading: { ja: '打刻修正の承認の仕方', en: 'How to approve a punch correction' },
        steps: {
          ja: [
            '「やること」の「承認待ちの打刻修正」を押すと、届いている申請の一覧が出ます。',
            '申請を押すと、打刻の日・直す内容（最初の打刻 → 直した内容）・理由と、その日の打刻が出ます。',
            '内容が正しければ「承認する」を押します。承認すると打刻がその内容に書き換わります（元の打刻は記録に残ります）。',
            '直さない時は「却下する」を押します。打刻は今のままで、作業員は打刻画面で結果を見られます。',
            '自分が出した申請は自分では承認できません。別の承認者に頼んでください。',
          ],
          en: [
            'Tap "Punch corrections awaiting approval" in To do to see the list of requests.',
            'Tap a request to see the date, what will change (original record → corrected), the reason, and all records for that day.',
            'If it is correct, tap "Approve". The record is changed to the corrected content (the original record is kept in the history).',
            'If you do not change it, tap "Reject". The record stays as it is, and the worker can see the result on the check-in screen.',
            'You cannot approve your own request. Ask another approver.',
          ],
        },
      },
    ],
  },
  {
    key: 'daysOff',
    title: { ja: '休み・有給の予定', en: 'Days off and paid leave' },
    summary: {
      ja: '休みと有給を先に入れておくと、その日の日報が自動で出ます。',
      en: 'Enter your days off and paid leave in advance, and the daily report for that day is sent automatically.',
    },
    sections: [
      {
        heading: { ja: '入れ方', en: 'How to enter' },
        steps: {
          ja: [
            '毎週休む曜日があれば、「毎週の定休」でその曜日を押します（もう一度押すと外れます）。',
            '決まった日の休み・有給は、「休み・有給を入れる」で日付を選び、「休み」か「有給」を選んで「入れる」を押します。今日より前の日・日報をもう出した日は入れられません。',
            '入れた予定は「これからの休み・有給」に出ます。やめる時は「消す」を押します。予定表にも出ます。',
          ],
          en: [
            'If you are off on the same day every week, tap that day in "Weekly day off" (tap again to remove).',
            'For a specific day, choose the date in "Add a day off or paid leave", choose "Day off" or "Paid leave", and tap "Add". You cannot enter days before today or days you already sent a report for.',
            'Your entries appear in "Upcoming days off and paid leave". Tap "Remove" to cancel one. They also appear in the schedule.',
          ],
        },
      },
      {
        heading: { ja: 'その日の日報', en: 'The daily report for that day' },
        steps: {
          ja: [
            'その日の夜8時に、日報が「稼働なし」（有給は「有給」）で自動で出ます。',
            'その日に出勤の打刻をした時は出ません（いつもどおり日報を書いてください）。',
            '有給の残りが足りない日は自動では出ません。その日に日報の画面から有給で出してください（管理者の承認に回ります）。',
            '出た日報の直し方は、いつもの日報と同じです。',
          ],
          en: [
            'At 8 pm on that day, the daily report is sent automatically as "Not working" (or "Paid leave").',
            'If you checked in that day, it is not sent (write your daily report as usual).',
            'If you do not have enough paid leave left, it is not sent automatically. Send it from the daily report screen as paid leave on that day (it goes to the manager for approval).',
            'You can correct it the same way as any daily report.',
          ],
        },
      },
    ],
  },
  {
    key: 'calendar',
    title: { ja: '予定', en: 'Schedule' },
    summary: {
      ja: 'みんなの予定と自分の予定を見たり、予定を入れたりする画面です。',
      en: 'See everyone\'s schedule and your own, and add schedules.',
    },
    sections: [
      {
        heading: { ja: '見方', en: 'Viewing' },
        steps: {
          ja: [
            '「共有」はみんなの予定です。上のグループで、見る人を絞れます。',
            '「個人」は自分の予定です。「週間」「月間」で切り替えます。',
            '予定を押すと、中身（現場・時間・メモ・作成した人）が見られます。',
          ],
          en: [
            '"Shared" shows everyone\'s schedule. Use the group at the top to narrow down the people.',
            '"Personal" shows your own schedule. Switch between "Week" and "Month".',
            'Tap a schedule to see the details (site, time, note, who created it).',
          ],
        },
      },
      {
        heading: { ja: '予定を入れる', en: 'Adding a schedule' },
        steps: {
          ja: [
            '「共有」では人と日付のマスを、「個人」では時間の枠か右下の「＋」を押します。',
            '現場（または現場と紐付けずにタイトル）・作業区分・時間を入れて保存します。夜勤は「夜勤」を選びます。',
            '入れた予定は押すと直したり消したりできます。',
          ],
          en: [
            'In "Shared", tap the box for the person and date. In "Personal", tap a time slot or the "+" at the bottom right.',
            'Enter the site (or a title without a site), work category and time, then save. For night shifts, choose "Night shift".',
            'Tap a schedule you added to edit or delete it.',
          ],
        },
      },
    ],
  },
]

export function guideOf(key: string): WorkerGuide | null {
  return WORKER_GUIDES.find((g) => g.key === key) ?? null
}
