<template>
  <div class="ai-help">
    <div class="page-header">
      <h1 class="page-title">AIヘルプ
        <HelpButton title="AIヘルプの使い方" :items="[
          'アプリの操作や仕様について質問すると、仕様を理解したAIが回答します。',
          '不具合かもと思ったら「バグとして報告」でバックログに起票できます。',
          '回答はAIによる参考情報です。重要な操作は実際の画面でご確認ください。',
          '右下のフローティングボタンからは、どのページにいてもこのヘルプを開けます。',
        ]" />
      </h1>
    </div>
    <AiHelpChat />
  </div>
</template>

<script setup lang="ts">
import HelpButton from '../components/HelpButton.vue'
import AiHelpChat from '../components/AiHelpChat.vue'
</script>

<style scoped>
.ai-help { display: flex; flex-direction: column; height: calc(100vh - 90px); }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
</style>
