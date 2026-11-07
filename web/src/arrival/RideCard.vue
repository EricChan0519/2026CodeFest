<script setup lang="ts">
/**
 * 坐車中：大字顯示坐哪一班、在哪下車、還有幾站。
 * 下一站要下車、到了下車站時震動並念出來；下車由使用者按「下車了」確認（定位在車上不一定準）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { Audience, Lang } from '@/lib/contract'
import type { RideStatus } from '@/nav/journey'
import { ARRIVAL_STRINGS } from '@/i18n/arrival'
import AskCardsDialog from './AskCardsDialog.vue'
import { askCards, type ArrivalTrip, type Name } from './arrival'
import { buildRide } from './ride'
import { speakText } from './speech'

const props = defineProps<{ trip: ArrivalTrip; lang: Lang; audience: Audience; status: RideStatus; simulate?: boolean; place?: Name | null }>()
const emit = defineEmits<{ gotOff: []; simNext: [] }>()

const ride = computed(() => buildRide(props.trip, props.lang, props.audience, props.status))
/** 坐車時給司機看「到 ○○ 請提醒我下車」 */
const cards = computed(() => askCards(props.trip, props.lang, props.place ?? undefined))
const showingCard = ref(false)
const showOthers = computed(() => ARRIVAL_STRINGS[props.lang].showOthers)
const say = (text: string | null) => text && speakText(text, ride.value.speechLang, ride.value.rate)
const hearAgain = () => say([ride.value.cueText ?? ride.value.getOff, ride.value.stopsLeft].filter(Boolean).join(' '))

watch(
  () => props.status.cue,
  (cue) => {
    if (cue === 'none') return
    if ('vibrate' in navigator) navigator.vibrate(cue === 'get_off' ? [200, 80, 200, 80, 400] : [150, 80, 150])
    say(ride.value.cueText)
  },
)
onMounted(() => say(ride.value.getOff))
</script>

<template>
  <main class="flex min-h-full flex-col bg-[#356C77] px-4 pb-6 pt-8 text-white" :lang="lang" aria-live="polite">
    <div class="flex flex-1 flex-col items-center justify-center text-center">
      <p v-if="ride.routeBig" class="break-all text-[clamp(4.5rem,26vw,8rem)] font-bold leading-none">{{ ride.routeBig }}</p>
      <p v-if="ride.routeSub" class="mt-2 text-3xl font-bold">{{ ride.routeSub }}</p>
      <p v-if="ride.direction" class="mt-3 text-2xl font-bold">{{ ride.direction }}</p>
      <p v-if="ride.getOff" class="mt-6 text-3xl font-bold">{{ ride.getOff }}</p>
      <p class="mt-4 text-2xl">{{ ride.stopsLeft }}</p>
      <p v-if="ride.cueText" class="mt-6 rounded-xl bg-white px-4 py-3 text-2xl font-bold text-[#356C77]" role="alert">
        {{ ride.cueText }}
      </p>
    </div>

    <div class="mt-6 flex flex-col gap-3">
      <button class="min-h-16 rounded-xl bg-white px-4 text-xl font-bold text-[#356C77]" @click="emit('gotOff')">
        {{ ride.labels.gotOff }}
      </button>
      <button v-if="cards.length" class="min-h-16 rounded-xl border-2 border-white px-3 text-xl font-bold" @click="showingCard = true">
        {{ showOthers }}
      </button>
      <button class="min-h-16 rounded-xl border-2 border-white px-3 text-xl font-bold" @click="hearAgain">
        {{ ride.labels.hearAgain }}
      </button>
      <button v-if="simulate" class="min-h-12 rounded-xl bg-white/20 px-3 text-base" @click="emit('simNext')">
        模擬：公車往前開一站
      </button>
    </div>
    <AskCardsDialog v-if="showingCard" :cards="cards" :lang="lang" initial="remind" @close="showingCard = false" />
  </main>
</template>
