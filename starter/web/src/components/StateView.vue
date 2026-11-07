<script setup lang="ts">
/** 統一的 loading / 錯誤 / 空資料畫面（評分：不能白屏） */
defineProps<{
  loading?: boolean
  error?: string | null
  empty?: boolean
  emptyText?: string
}>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="loading" class="flex flex-col items-center justify-center gap-3 py-12 text-gray-500">
    <span class="size-8 animate-spin rounded-full border-4 border-primary-100 border-t-primary-500" />
    <span class="text-sm">載入中…</span>
  </div>
  <div v-else-if="error" class="flex flex-col items-center justify-center gap-3 py-12 text-center">
    <p class="text-sm text-red-600">{{ error }}</p>
    <button
      class="min-h-12 rounded-full border border-primary-500 px-6 text-primary-600 active:bg-primary-50"
      @click="$emit('retry')"
    >
      重試
    </button>
  </div>
  <div v-else-if="empty" class="py-12 text-center text-sm text-gray-500">
    {{ emptyText ?? '目前沒有資料' }}
  </div>
  <slot v-else />
</template>
