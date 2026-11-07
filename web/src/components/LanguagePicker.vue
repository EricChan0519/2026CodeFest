<script setup lang="ts">
/**
 * 選語言：第一次打開時整頁顯示，之後從右上角的 🌐 再打開。
 * 每個語言用它自己的文字寫，看不懂中文的人也找得到自己的語言。
 */
import type { Lang } from '@/lib/contract'
import { LANG_CHOICES } from '@/i18n/lang'

defineProps<{ current?: Lang | null }>()
const emit = defineEmits<{ pick: [lang: Lang] }>()
</script>

<template>
  <main class="flex min-h-dvh flex-col bg-[#30383D] px-4 pb-6 pt-10 text-white">
    <div class="mb-6 text-center" aria-hidden="true">
      <svg class="mx-auto size-14" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="3" />
        <path d="M4 24h40M24 4c6 6 8 13 8 20s-2 14-8 20c-6-6-8-13-8-20s2-14 8-20Z" fill="none" stroke="currentColor" stroke-width="3" />
      </svg>
    </div>
    <h1 class="sr-only">選擇語言 Choose your language</h1>
    <div class="grid flex-1 content-start gap-3">
      <button
        v-for="c in LANG_CHOICES"
        :key="c.lang"
        type="button"
        :lang="c.lang"
        class="min-h-16 rounded-xl px-4 text-left text-2xl font-bold"
        :class="current === c.lang ? 'bg-white text-[#30383D]' : 'bg-white/15'"
        :aria-pressed="current === c.lang"
        @click="emit('pick', c.lang)"
      >
        {{ c.name }}
      </button>
    </div>
  </main>
</template>
