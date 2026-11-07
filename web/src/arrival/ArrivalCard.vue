<script setup lang="ts">
/**
 * 到站確認：大字顯示要等哪一班車、在哪下車，並可把問句拿給司機或旁人看。
 * /arrived 頁面和導航頁（行程中到了上車站、到了目的地）共用。
 * 主按鈕的文字由呼叫端決定：行程中是「上車了」，最後一段是「完成」。
 */
import { computed, onMounted, ref } from 'vue'
import type { Audience, Lang } from '@/lib/contract'
import AskCardsDialog from './AskCardsDialog.vue'
import { askCards, buildArrival, type ArrivalTrip, type Name } from './arrival'
import { speakText } from './speech'

const props = withDefaults(
  defineProps<{
    trip: ArrivalTrip
    lang: Lang
    audience: Audience
    primaryLabel?: string | null
    speakOnMount?: boolean
    /** 最終目的地：有的話多一張「我迷路了」的卡 */
    place?: Name | null
  }>(),
  { primaryLabel: null, speakOnMount: true, place: null },
)
const emit = defineEmits<{ primary: [] }>()

const arrival = computed(() => buildArrival(props.trip, props.lang, props.audience))
const cards = computed(() => askCards(props.trip, props.lang, props.place ?? undefined))
const showingCard = ref(false)

const hearAgain = () => speakText(arrival.value.spoken, arrival.value.speechLang, arrival.value.rate)

onMounted(() => {
  if (props.speakOnMount) hearAgain()
})
</script>

<template>
  <main class="flex min-h-full flex-col bg-arrived px-4 pb-6 pt-8 text-white" :lang="lang" aria-live="polite">
    <div class="flex flex-1 flex-col items-center justify-center text-center">
      <svg class="size-16" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="4" />
        <path d="M14 25l7 7 14-15" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <h1 class="mt-3 text-3xl font-bold">{{ arrival.headline }}</h1>

      <template v-if="arrival.routeBig">
        <p class="mt-6 break-all text-[clamp(5rem,30vw,9rem)] font-bold leading-none">{{ arrival.routeBig }}</p>
        <p v-if="arrival.routeSub" class="mt-2 text-4xl font-bold">{{ arrival.routeSub }}</p>
        <p v-if="arrival.direction" class="mt-4 text-3xl font-bold">{{ arrival.direction }}</p>
        <p v-if="arrival.getOff" class="mt-3 text-2xl font-bold">{{ arrival.getOff }}</p>
      </template>
      <p v-if="arrival.station" class="mt-5 text-xl">{{ arrival.station }}</p>
    </div>

    <div class="mt-6 flex flex-col gap-3">
      <button
        v-if="cards.length"
        class="min-h-16 rounded-xl bg-white px-4 text-xl font-bold text-arrived"
        @click="showingCard = true"
      >
        {{ arrival.labels.showOthers }}
      </button>
      <div class="flex gap-3">
        <button class="min-h-16 flex-1 rounded-xl border-2 border-white px-3 text-xl font-bold" @click="hearAgain">
          {{ arrival.labels.hearAgain }}
        </button>
        <button class="min-h-16 flex-1 rounded-xl border-2 border-white px-3 text-xl font-bold" @click="emit('primary')">
          {{ primaryLabel ?? arrival.labels.done }}
        </button>
      </div>
    </div>

    <AskCardsDialog v-if="showingCard && cards.length" :cards="cards" :lang="lang" @close="showingCard = false" />
  </main>
</template>
