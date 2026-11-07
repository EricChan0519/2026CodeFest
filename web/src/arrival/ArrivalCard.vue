<script setup lang="ts">
/**
 * 到站確認：大字顯示要等哪一班車、在哪下車，並可把問句拿給司機或旁人看。
 * /arrived 頁面和導航頁（行程中到了上車站、到了目的地）共用。
 * 主按鈕的文字由呼叫端決定：行程中是「上車了」，最後一段是「完成」。
 */
import { computed, onMounted, ref } from 'vue'
import type { Audience, Lang } from '@/lib/contract'
import { askCard, buildArrival, type ArrivalTrip } from './arrival'
import { speakText } from './speech'

const props = withDefaults(
  defineProps<{ trip: ArrivalTrip; lang: Lang; audience: Audience; primaryLabel?: string | null; speakOnMount?: boolean }>(),
  { primaryLabel: null, speakOnMount: true },
)
const emit = defineEmits<{ primary: [] }>()

const arrival = computed(() => buildArrival(props.trip, props.lang, props.audience))
const card = computed(() => askCard(props.trip, props.lang))
const showingCard = ref(false)

const hearAgain = () => speakText(arrival.value.spoken, arrival.value.speechLang, arrival.value.rate)
const readCard = () =>
  card.value && speakText([card.value.zh, card.value.getOff].filter(Boolean).join(''), card.value.lang, 'slow')

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
        <span v-if="arrival.lineColor" class="mt-6 block h-3 w-24 rounded-full ring-2 ring-white" :style="{ backgroundColor: arrival.lineColor }" aria-hidden="true" />
        <!-- 捷運路線名比公車號碼長（淡水信義線），字級縮小才不會斷成好幾行 -->
        <p
          class="mt-6 break-all font-bold leading-none"
          :class="trip.mode === 'metro' ? 'text-[clamp(2.75rem,14vw,4.5rem)]' : 'text-[clamp(5rem,30vw,9rem)]'"
        >{{ arrival.routeBig }}</p>
        <p v-if="arrival.routeSub" class="mt-2 text-4xl font-bold">{{ arrival.routeSub }}</p>
        <p v-if="arrival.direction" class="mt-4 text-3xl font-bold">{{ arrival.direction }}</p>
        <p v-if="arrival.getOff" class="mt-3 text-2xl font-bold">{{ arrival.getOff }}</p>
      </template>
      <p v-if="arrival.station" class="mt-5 text-xl">{{ arrival.station }}</p>
    </div>

    <div class="mt-6 flex flex-col gap-3">
      <button
        v-if="card"
        class="min-h-16 rounded-[20px] bg-gray-50 px-4 text-xl font-bold text-arrived active:scale-[0.98]"
        @click="showingCard = true"
      >
        {{ arrival.labels.showOthers }}
      </button>
      <div class="flex gap-3">
        <button class="min-h-16 flex-1 rounded-[20px] border border-white/15 border-t-white/30 bg-white/10 px-3 text-xl font-bold active:scale-[0.98]" @click="hearAgain">
          {{ arrival.labels.hearAgain }}
        </button>
        <button class="min-h-16 flex-1 rounded-[20px] border border-white/15 border-t-white/30 bg-white/10 px-3 text-xl font-bold active:scale-[0.98]" @click="emit('primary')">
          {{ primaryLabel ?? arrival.labels.done }}
        </button>
      </div>
    </div>

    <!-- 給別人看：白底大字，旁人一眼能讀；問句一律是中文 -->
    <div
      v-if="showingCard && card"
      class="fixed inset-0 z-30 flex flex-col overflow-y-auto bg-white px-4 pb-6 pt-6 text-gray-900"
      role="dialog"
      aria-modal="true"
    >
      <p class="text-lg text-gray-700">{{ arrival.labels.askHint }}</p>
      <div class="flex flex-1 flex-col justify-center py-6" lang="zh-TW">
        <p class="text-[clamp(2.25rem,10vw,3.5rem)] font-bold leading-snug">{{ card.zh }}</p>
        <p v-if="card.getOff" class="mt-4 text-[clamp(1.75rem,8vw,2.5rem)] font-bold leading-snug">{{ card.getOff }}</p>
        <p v-if="card.station" class="mt-5 text-2xl text-gray-700">{{ card.station }}</p>
      </div>
      <p v-if="card.own" class="mb-4 border-t border-gray-200 pt-4 text-xl text-gray-700">{{ card.own }}</p>
      <div class="flex gap-3">
        <button class="min-h-16 flex-1 rounded-[20px] border-2 border-gray-800 px-3 text-xl font-bold" @click="showingCard = false">
          {{ arrival.labels.back }}
        </button>
        <button class="min-h-16 flex-1 rounded-[20px] bg-arrived px-3 text-xl font-bold text-white" @click="readCard">
          {{ arrival.labels.readAloud }}
        </button>
      </div>
    </div>
  </main>
</template>
