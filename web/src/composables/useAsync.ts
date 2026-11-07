import { ref, shallowRef } from 'vue'

/** loading / error / data 三態，配合 <StateView> 使用，避免白屏 */
export function useAsync<T, A extends unknown[] = []>(fn: (...args: A) => Promise<T>) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function run(...args: A) {
    loading.value = true
    error.value = null
    try {
      data.value = await fn(...args)
    } catch (e) {
      error.value = (e as Error).message || '發生錯誤'
    } finally {
      loading.value = false
    }
    return data.value
  }

  return { data, loading, error, run }
}
