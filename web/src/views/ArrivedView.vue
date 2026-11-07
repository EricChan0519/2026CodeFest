<script setup lang="ts">
/** P7 抵達：大字確認要等哪一班車，並可把問句拿給司機或旁人看。 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { askCard, buildArrival, tripFromQuery } from '@/arrival/arrival'
import { speakText } from '@/arrival/speech'

const route = useRoute()
const router = useRouter()

const parsed = computed(() => tripFromQuery(route.query))
const arrival = computed(() => buildArrival(parsed.value.trip, parsed.value.lang, parsed.value.audience))
const card = computed(() => askCard(parsed.value.trip, parsed.value.lang))
const showingCard = ref(false)

const hearAgain = () => speakText(arrival.value.spoken, arrival.value.speechLang, arrival.value.rate)
const readCard = () => card.value && speakText(card.value.zh, card.value.lang, 'slow')

onMounted(hearAgain)
</script>

<template>
  <main
    class="flex min-h-full flex-col bg-arrived px-4 pb-6 pt-8 text-white"
    :lang="parsed.lang"
    aria-live="polite"
  >
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
      </template>
      <p v-if="arrival.station" class="mt-5 text-xl">{{ arrival.station }}</p>
    </div>

    <div class="mt-6 flex flex-col gap-3">
      <button
        v-if="card"
        class="min-h-16 rounded-xl bg-white px-4 text-xl font-bold text-arrived"
        @click="showingCard = true"
      >
        {{ arrival.labels.showOthers }}
      </button>
      <div class="flex gap-3">
        <button class="min-h-16 flex-1 rounded-xl border-2 border-white px-3 text-xl font-bold" @click="hearAgain">
          {{ arrival.labels.hearAgain }}
        </button>
        <button class="min-h-16 flex-1 rounded-xl border-2 border-white px-3 text-xl font-bold" @click="router.push('/')">
          {{ arrival.labels.done }}
        </button>
      </div>
    </div>

    <!-- 給別人看：白底大字，旁人一眼能讀；問句一律是中文 -->
    <div
      v-if="showingCard && card"
      class="fixed inset-0 z-10 flex flex-col overflow-y-auto bg-white px-4 pb-6 pt-6 text-gray-900"
      role="dialog"
      aria-modal="true"
    >
      <p class="text-lg text-gray-700">{{ arrival.labels.askHint }}</p>
      <div class="flex flex-1 flex-col justify-center py-6" lang="zh-TW">
        <p class="text-[clamp(2.25rem,10vw,3.5rem)] font-bold leading-snug">{{ card.zh }}</p>
        <p v-if="card.station" class="mt-5 text-2xl text-gray-700">{{ card.station }}</p>
      </div>
      <p v-if="card.own" class="mb-4 border-t border-gray-200 pt-4 text-xl text-gray-700">{{ card.own }}</p>
      <div class="flex gap-3">
        <button class="min-h-16 flex-1 rounded-xl border-2 border-gray-800 px-3 text-xl font-bold" @click="showingCard = false">
          {{ arrival.labels.back }}
        </button>
        <button class="min-h-16 flex-1 rounded-xl bg-arrived px-3 text-xl font-bold text-white" @click="readCard">
          {{ arrival.labels.readAloud }}
        </button>
      </div>
    </div>
  </main>
</template>
