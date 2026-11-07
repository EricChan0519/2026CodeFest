<script setup lang="ts">
/**
 * 給別人看：白底中文大字，司機或旁人一眼能讀。上方分頁切換問句（使用者的語言），
 * 下方小字是使用者語言的翻譯，讓手機主人知道自己拿給別人看的是什麼。「念出來」用中文念。
 */
import { computed, ref } from 'vue'
import type { Lang } from '@/lib/contract'
import { ARRIVAL_STRINGS } from '@/i18n/arrival'
import type { AskCardView } from './arrival'
import { speakText } from './speech'

const props = defineProps<{ cards: AskCardView[]; lang: Lang; initial?: AskCardView['id'] }>()
const emit = defineEmits<{ close: [] }>()

const s = computed(() => ARRIVAL_STRINGS[props.lang])
const picked = ref<AskCardView['id'] | undefined>(props.initial)
const card = computed(() => props.cards.find((c) => c.id === picked.value) ?? props.cards[0])

const readAloud = () => card.value && speakText([card.value.zh, ...card.value.details].join('。'), 'zh-TW', 'slow')
</script>

<template>
  <div
    v-if="card"
    class="fixed inset-0 z-30 flex flex-col overflow-y-auto bg-white px-4 pb-6 pt-4 text-gray-900"
    role="dialog"
    aria-modal="true"
  >
    <div v-if="cards.length > 1" class="mb-3 flex gap-2" role="tablist" :lang="lang">
      <button
        v-for="c in cards"
        :key="c.id"
        type="button"
        role="tab"
        class="min-h-12 flex-1 rounded-lg px-2 text-base font-bold"
        :class="c.id === card.id ? 'bg-arrived text-white' : 'bg-gray-100 text-gray-800'"
        :aria-selected="c.id === card.id"
        @click="picked = c.id"
      >
        {{ c.tab }}
      </button>
    </div>
    <p class="text-lg text-gray-700" :lang="lang">{{ s.askHint }}</p>
    <div class="flex flex-1 flex-col justify-center py-6" lang="zh-TW">
      <p class="text-[clamp(2.25rem,10vw,3.5rem)] font-bold leading-snug">{{ card.zh }}</p>
      <p v-for="d in card.details" :key="d" class="mt-4 text-[clamp(1.5rem,7vw,2.25rem)] font-bold leading-snug">{{ d }}</p>
    </div>
    <p v-if="card.own" class="mb-4 border-t border-gray-200 pt-4 text-xl text-gray-700" :lang="lang">{{ card.own }}</p>
    <div class="flex gap-3" :lang="lang">
      <button class="min-h-16 flex-1 rounded-xl border-2 border-gray-800 px-3 text-xl font-bold" @click="emit('close')">
        {{ s.back }}
      </button>
      <button class="min-h-16 flex-1 rounded-xl bg-arrived px-3 text-xl font-bold text-white" @click="readAloud">
        {{ s.readAloud }}
      </button>
    </div>
  </div>
</template>
