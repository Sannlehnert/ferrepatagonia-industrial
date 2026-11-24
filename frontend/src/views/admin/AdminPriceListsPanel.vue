<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import axios from 'axios'
import AdminPriceListFormDialog from '@/components/AdminPriceListFormDialog.vue'
import { getAdminPriceLists, saveAdminPriceList } from '@/services/adminClientService'
import { isMutationResultUncertain } from '@/services/adminMutationError'
import type { AdminPriceList, AdminPriceListInput } from '@/types/adminClient'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ changed: []; busy: [value: boolean] }>()

const lists = ref<AdminPriceList[]>([])
const editor = ref<{ list: AdminPriceList | null } | null>(null)
const loading = ref(true)
const saving = ref(false)
const reloadRequired = ref(false)
const listError = ref('')
const formError = ref('')
const message = ref('')
const newButton = ref<HTMLButtonElement | null>(null)
let editorTrigger: HTMLElement | null = null

async function loadLists(refreshAssignments = false) {
    loading.value = true
    listError.value = ''
    try {
        lists.value = await getAdminPriceLists()
        reloadRequired.value = false
        if (refreshAssignments) emit('changed')
    } catch {
        listError.value = 'No pudimos cargar las listas de precios.'
        reloadRequired.value = true
    } finally {
        loading.value = false
    }
}

function rememberTrigger(event?: Event) {
    if (event?.currentTarget instanceof HTMLElement) {
        editorTrigger = event.currentTarget
    } else if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        editorTrigger = document.activeElement
    }
}

function openCreate(event?: Event) {
    if (props.disabled || loading.value || saving.value || reloadRequired.value || editor.value) return
    rememberTrigger(event)
    message.value = ''
    formError.value = ''
    editor.value = { list: null }
}

function openEdit(list: AdminPriceList, event?: Event) {
    if (props.disabled || loading.value || saving.value || reloadRequired.value || editor.value) return
    rememberTrigger(event)
    message.value = ''
    formError.value = ''
    editor.value = { list: { ...list } }
}

async function restoreTriggerFocus() {
    await nextTick()
    const target = editorTrigger?.isConnected ? editorTrigger : newButton.value
    editorTrigger = null
    target?.focus({ preventScroll: true })
}

function closeEditor() {
    if (saving.value) return
    editor.value = null
    formError.value = ''
    void restoreTriggerFocus()
}

async function saveList(fields: AdminPriceListInput) {
    const current = editor.value
    if (!current || props.disabled || saving.value || reloadRequired.value) return

    saving.value = true
    emit('busy', true)
    formError.value = ''
    message.value = ''
    let savedSuccessfully = false

    try {
        const saved = await saveAdminPriceList(fields, current.list?.id)
        lists.value = [...lists.value.filter(list => list.id !== saved.id), saved]
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR') || a.id - b.id)
        editor.value = null
        message.value = current.list ? 'Lista actualizada.' : 'Lista creada.'
        savedSuccessfully = true
        emit('changed')
    } catch (cause) {
        const response = axios.isAxiosError<{ message?: string }>(cause) ? cause.response : undefined
        if (isMutationResultUncertain(cause)) {
            reloadRequired.value = true
            formError.value = 'No pudimos confirmar el cambio. Recargá las listas para verificar el resultado antes de volver a guardar.'
        } else {
            formError.value = response?.data?.message ?? 'No se pudo guardar la lista.'
        }
    } finally {
        saving.value = false
        emit('busy', false)
        if (savedSuccessfully) await restoreTriggerFocus()
    }
}

async function reloadAfterUncertain() {
    if (saving.value) return
    saving.value = true
    emit('busy', true)
    formError.value = ''
    let reloaded = false
    try {
        await loadLists(true)
        if (listError.value) {
            formError.value = 'No se pudieron recargar las listas. Reintentá antes de continuar.'
            return
        }
        reloadRequired.value = false
        editor.value = null
        message.value = 'Listas actualizadas. Verificá el resultado antes de volver a editar.'
        reloaded = true
    } finally {
        saving.value = false
        emit('busy', false)
        if (reloaded) await restoreTriggerFocus()
    }
}

onMounted(() => void loadLists())
</script>

<template>
    <section aria-labelledby="price-lists-title" class="mb-6 min-w-0 rounded-lg border border-slate-200 bg-white p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="price-lists-title" class="m-0 text-lg font-semibold">Listas de precios</h2>
            <button
                ref="newButton"
                type="button"
                class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 font-[inherit] text-sm font-semibold text-[#0b2438] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="disabled || loading || saving || reloadRequired"
                @click="openCreate($event)"
            >
                Nueva lista
            </button>
        </div>

        <p v-if="loading" role="status" class="text-slate-700">Cargando listas…</p>
        <div v-if="listError" class="mb-3">
            <p role="alert" class="m-0 text-red-800">{{ listError }}</p>
            <button
                type="button"
                :disabled="loading || disabled || saving"
                class="mt-2 box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 font-[inherit] text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                @click="loadLists(true)"
            >
                Recargar listas
            </button>
        </div>
        <p v-if="message" role="status" class="mb-2 text-emerald-800">{{ message }}</p>
        <p v-if="!loading && !listError && !lists.length" class="m-0 text-slate-700">Todavía no hay listas de precios.</p>

        <ul v-if="lists.length" class="m-0 grid list-none gap-2 p-0">
            <li v-for="list in lists" :key="list.id" class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2">
                <span class="min-w-0 wrap-anywhere">{{ list.nombre }} · {{ list.porcentajeDescuento }} % · {{ list.activa ? 'Activa' : 'Inactiva' }}</span>
                <button
                    type="button"
                    class="box-border min-h-11 cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-3 font-[inherit] text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                    :aria-label="`Editar lista ${list.nombre}`"
                    :disabled="disabled || saving || loading || reloadRequired"
                    @click="openEdit(list, $event)"
                >
                    Editar
                </button>
            </li>
        </ul>

        <AdminPriceListFormDialog
            v-if="editor"
            :key="editor.list?.id ?? 'new'"
            :price-list="editor.list"
            :busy="saving"
            :error="formError"
            :uncertain="reloadRequired"
            @save="saveList"
            @cancel="closeEditor"
            @reload="reloadAfterUncertain"
        />
    </section>
</template>
