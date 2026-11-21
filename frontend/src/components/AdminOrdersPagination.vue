<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AdminOrderPagination } from '@/types/adminOrder'

const props = defineProps<{ pagination: AdminOrderPagination; loading: boolean; summary: string }>()
const emit = defineEmits<{ navigate: [page: number] }>()
const inputPage = ref(String(props.pagination.page))
const error = ref('')
const notice = ref('')
const inputId = 'admin-orders-page'
const errorId = `${inputId}-error`
// El DTO de pedidos admite páginas de 1 a 10000.
const lastPage = computed(() => Math.min(props.pagination.totalPages, 10000))
const buttons = computed(() => {
  const current = props.pagination.page
  const selected = new Set([1, lastPage.value])
  for (let page = current - 2; page <= current + 2; page++) {
    if (page >= 1 && page <= lastPage.value) selected.add(page)
  }
  const result: (number | null)[] = []
  for (const page of [...selected].sort((a, b) => a - b)) {
    const previous = result.at(-1)
    if (previous !== undefined && previous !== null && page > previous + 1) {
      result.push(page === previous + 2 ? previous + 1 : null)
    }
    result.push(page)
  }
  return result
})

watch(() => props.pagination.page, page => {
  inputPage.value = String(page)
  error.value = ''
})
function navigate(page: number) {
  if (!props.loading && page !== props.pagination.page && page >= 1 && page <= lastPage.value) {
    error.value = ''
    emit('navigate', page)
  }
}
function jump() {
  const value = inputPage.value.trim()
  const page = Number(value)
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(page)) {
    error.value = 'Ingresá un número de página entero.'
    notice.value = ''
    return
  }
  error.value = ''
  const target = Math.max(1, Math.min(page, lastPage.value))
  inputPage.value = String(target)
  notice.value = page > lastPage.value ? 'Mostrando la última página disponible.' : page < 1 ? 'Mostrando la primera página disponible.' : ''
  navigate(target)
}
</script>

<template>
  <nav aria-label="Paginación de pedidos" class="orders-pagination">
    <p role="status" class="page-summary">{{ summary }}<span v-if="loading"> · Actualizando…</span></p>
    <template v-if="pagination.totalPages > 1">
    <div class="page-selector">
      <div class="page-numbers">
        <template v-for="(page, index) in buttons" :key="page ?? `gap-${index}`">
          <span v-if="page === null" class="px-1" aria-hidden="true">…</span>
          <button v-else type="button" class="page-button" :class="{ 'page-current': page === pagination.page }" :aria-current="page === pagination.page ? 'page' : undefined" :aria-label="`Ir a página ${page}`" :disabled="loading" @click="navigate(page)">{{ page }}</button>
        </template>
      </div>
      <form class="page-form" novalidate @submit.prevent="jump">
        <label :for="inputId" class="page-label">Ir a página</label>
        <input :id="inputId" v-model="inputPage" type="text" inputmode="numeric" maxlength="5" :disabled="loading" :aria-invalid="Boolean(error)" :aria-describedby="error ? errorId : undefined" class="page-input" />
        <button type="submit" class="page-button" :disabled="loading">Ir</button>
      </form>
    </div>
    <button type="button" class="page-button page-previous" :disabled="loading || pagination.page <= 1" @click="navigate(pagination.page - 1)">Anterior</button>
    <button type="button" class="page-button page-next" :disabled="loading || pagination.page >= lastPage" @click="navigate(pagination.page + 1)">Siguiente</button>
    <p v-if="error" :id="errorId" role="alert" class="page-feedback text-red-700">{{ error }}</p>
    <p v-else-if="notice" role="status" class="page-feedback">{{ notice }}</p>
    </template>
  </nav>
</template>

<style scoped>
.orders-pagination { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; flex-shrink: 0; padding-top: 16px; color: #475569; font-size: 14px; }
.page-summary { grid-column: 1 / -1; margin: 0 0 4px; }
.page-selector { grid-column: 2; grid-row: 2; min-width: 0; }
.page-numbers { display: none; }
.page-form { display: flex; justify-content: center; align-items: center; gap: 4px; }
.page-label { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.page-previous { grid-column: 1; grid-row: 2; }
.page-next { grid-column: 3; grid-row: 2; }
.page-feedback { grid-column: 1 / -1; margin: 0; text-align: center; font-size: 12px; }
@media (min-width: 800px) {
  .orders-pagination { grid-template-columns: minmax(0, 1fr) auto auto auto; }
  .page-summary { grid-column: 1; grid-row: 1; margin: 0; }
  .page-selector { grid-row: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; }
  .page-previous { grid-column: 3; grid-row: 1; }
  .page-next { grid-column: 4; grid-row: 1; }
  .page-label { position: static; width: auto; height: auto; overflow: visible; clip-path: none; }
}
@media (min-width: 1280px) { .page-numbers { display: flex; align-items: center; gap: 4px; } }
.page-button, .page-input { box-sizing: border-box; min-height: 44px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; padding: 8px 12px; color: #103a5c; font: inherit; }
.page-button { min-width: 44px; cursor: pointer; }
.page-button:hover:not(:disabled) { background: #f1f5f9; }
.page-button.page-current { border-color: #145a8d; background: #145a8d; color: white; }
.page-button:disabled, .page-input:disabled { opacity: .5; cursor: not-allowed; }
.page-input { width: 48px; padding-inline: 6px; text-align: center; }
.page-button:focus-visible, .page-input:focus-visible { outline: 2px solid #145a8d; outline-offset: 3px; }
</style>
