<template>
  <NuxtPage />
</template>

<script setup lang="ts">
const liff = useLiff()

onMounted(async () => {
  if (!liff.initialized.value) {
    await liff.init()
  }
})
</script>
