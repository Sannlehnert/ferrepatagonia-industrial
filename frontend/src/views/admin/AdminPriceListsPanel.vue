<script setup lang="ts">
import { onMounted, ref } from 'vue'
import axios from 'axios'
import { getAdminPriceLists, saveAdminPriceList } from '@/services/adminClientService'
import type { AdminPriceList, AdminPriceListInput } from '@/types/adminClient'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ changed: []; busy: [value: boolean] }>()
const lists = ref<AdminPriceList[]>([])
const editor = ref<{ id?: number; values: AdminPriceListInput } | null>(null)
const loading = ref(true)
const saving = ref(false)
const reloadRequired = ref(false)
const error = ref('')
const message = ref('')

async function loadLists(refreshAssignments = false) {
    loading.value = true
    error.value = ''
    try {
        lists.value = await getAdminPriceLists()
        reloadRequired.value = false
        if (refreshAssignments) {
            editor.value = null
            emit('changed')
        }
    } catch {
        error.value = 'No pudimos cargar las listas de precios.'
        reloadRequired.value = true
    } finally {
        loading.value = false
    }
}

function editList(list?: AdminPriceList) {
    message.value = ''
    error.value = ''
    editor.value = list
        ? { id: list.id, values: { nombre: list.nombre, porcentajeDescuento: list.porcentajeDescuento, activa: list.activa } }
        : { values: { nombre: '', porcentajeDescuento: '', activa: true } }
}

async function saveList() {
    if (!editor.value || props.disabled || saving.value || reloadRequired.value) return
    const { id, values } = editor.value
    saving.value = true
    emit('busy', true)
    error.value = ''
    try {
        const saved = await saveAdminPriceList({
            ...values, porcentajeDescuento: values.porcentajeDescuento.trim().replace(',', '.'),
        }, id)
        lists.value = [...lists.value.filter(list => list.id !== saved.id), saved]
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR') || a.id - b.id)
        editor.value = null
        message.value = id === undefined ? 'Lista creada.' : 'Lista actualizada.'
        emit('changed')
    } catch (cause) {
        const response = axios.isAxiosError<{ message?: string }>(cause) ? cause.response : undefined
        reloadRequired.value = !response || response.status >= 500
        error.value = reloadRequired.value
            ? 'No pudimos confirmar el cambio. Recargá las listas para verificarlo antes de volver a guardar.'
            : response?.data?.message ?? 'No se pudo guardar la lista.'
    } finally {
        saving.value = false
        emit('busy', false)
    }
}

onMounted(() => void loadLists())
</script>

<template>
    <section aria-labelledby="price-lists-title" class="mb-6 rounded-lg border border-slate-200 p-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="price-lists-title" class="m-0 text-lg font-semibold">Listas de precios</h2>
            <button type="button" class="min-h-11 rounded-md border border-slate-300 px-3 disabled:opacity-50"
                :disabled="disabled || loading || saving || reloadRequired" @click="editList()">
                Nueva lista
            </button>
        </div>
        <p v-if="loading" role="status">Cargando listas…</p>
        <p v-if="error" role="alert">{{ error }}</p>
        <button v-if="reloadRequired" type="button" :disabled="loading || disabled"
            class="min-h-11 rounded-md border border-slate-300 px-3" @click="loadLists(true)">
            Recargar listas
        </button>
        <p v-if="message" role="status">{{ message }}</p>
        <p v-if="!loading && !reloadRequired && !lists.length">Todavía no hay listas de precios.</p>
        <ul v-if="lists.length" class="m-0 grid list-none gap-2 p-0">
            <li v-for="list in lists" :key="list.id" class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2">
                <span>{{ list.nombre }} · {{ list.porcentajeDescuento }} % · {{ list.activa ? 'Activa' : 'Inactiva' }}</span>
                <button type="button" class="min-h-11 rounded-md border border-slate-300 px-3 disabled:opacity-50"
                    :aria-label="`Editar lista ${list.nombre}`" :disabled="disabled || saving || loading || reloadRequired"
                    @click="editList(list)">Editar</button>
            </li>
        </ul>
        <form v-if="editor" class="mt-4 rounded-md bg-slate-50 p-3" @submit.prevent="saveList">
            <fieldset class="m-0 flex flex-wrap items-end gap-3 border-0 p-0" :disabled="disabled || saving || reloadRequired">
                <legend class="mb-2 font-semibold">{{ editor.id === undefined ? 'Crear lista' : 'Editar lista' }}</legend>
                <label class="flex flex-col gap-1">Nombre de la lista
                    <input v-model="editor.values.nombre" required maxlength="150" class="min-h-11 rounded-md border border-slate-300 px-2" />
                </label>
                <label class="flex flex-col gap-1">Descuento (%)
                    <input v-model="editor.values.porcentajeDescuento" required inputmode="decimal"
                        class="min-h-11 rounded-md border border-slate-300 px-2" />
                </label>
                <label class="flex min-h-11 items-center gap-2">
                    <input v-model="editor.values.activa" type="checkbox" /> Activa
                </label>
                <button type="submit" class="min-h-11 rounded-md bg-[#145a8d] px-3 font-bold text-white disabled:opacity-50">
                    {{ saving ? 'Guardando…' : 'Guardar cambios' }}
                </button>
                <button type="button" class="min-h-11 rounded-md border border-slate-300 px-3"
                    @click="editor = null; error = ''">Cancelar</button>
            </fieldset>
        </form>
    </section>
</template>
