<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AdminPriceList, AdminPriceListInput } from '@/types/adminClient'

const props = defineProps<{
    priceList?: AdminPriceList | null
    busy: boolean
    error?: string
    uncertain?: boolean
}>()

const emit = defineEmits<{
    save: [fields: AdminPriceListInput]
    cancel: []
    reload: []
}>()

type PriceListFieldErrors = {
    nombre?: string
    porcentajeDescuento?: string
}

const dialog = ref<HTMLDialogElement | null>(null)
const scrollArea = ref<HTMLDivElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const discountInput = ref<HTMLInputElement | null>(null)
const name = ref(props.priceList?.nombre ?? '')
const discount = ref(props.priceList?.porcentajeDescuento ?? '')
const active = ref(props.priceList?.activa ?? true)
const fieldErrors = ref<PriceListFieldErrors>({})

let previousOverflow = ''
let previousPaddingRight = ''
let lastFocused: HTMLElement | null = null
let suppressCancel = false
let restorePending = false
let closingAuthorized = false
let unmounting = false

function isDirty() {
    return name.value !== (props.priceList?.nombre ?? '')
        || discount.value !== (props.priceList?.porcentajeDescuento ?? '')
        || active.value !== (props.priceList?.activa ?? true)
}

function lockPageScroll() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return

    const body = document.body
    previousOverflow = body.style.overflow
    previousPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
        body.style.paddingRight = `${scrollbarWidth}px`
    }
}

function unlockPageScroll() {
    if (typeof document === 'undefined') return

    document.body.style.overflow = previousOverflow
    document.body.style.paddingRight = previousPaddingRight
}

async function showDialog() {
    await nextTick()

    const element = dialog.value
    if (!element) return

    if (!element.open && typeof element.showModal === 'function') {
        element.showModal()
    }

    nameInput.value?.focus({ preventScroll: true })
}

onMounted(() => {
    lockPageScroll()
    void showDialog()
})

onBeforeUnmount(() => {
    unmounting = true
    if (dialog.value?.open) dialog.value.close()
    unlockPageScroll()
})

watch(
    () => [props.error, props.uncertain] as const,
    async ([error, uncertain]) => {
        if (!error && !uncertain) return

        await nextTick()
        if (scrollArea.value) scrollArea.value.scrollTop = 0
    },
)

function restoreNativeDialog() {
    const element = dialog.value
    if (unmounting || element?.open || !element) return

    try {
        element.showModal()
    } catch {
        return
    }

    const target = lastFocused
    if (target?.isConnected && element.contains(target) && !target.matches(':disabled')) {
        target.focus({ preventScroll: true })
    } else if (!nameInput.value?.disabled) {
        nameInput.value?.focus({ preventScroll: true })
    }
}

function handleNativeClose() {
    if (unmounting || closingAuthorized) return

    if (props.busy || props.uncertain || isDirty()) {
        if (restorePending) return
        restorePending = true
        void nextTick(() => {
            restorePending = false
            restoreNativeDialog()
        })
        return
    }

    closingAuthorized = true
    emit('cancel')
}

function getFocusableElements(): HTMLElement[] {
    const element = dialog.value
    if (!element) return []

    return Array.from(element.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(item => item.getClientRects().length > 0)
}

function rememberFocus(event: FocusEvent) {
    const target = event.target
    if (target instanceof HTMLElement && dialog.value?.contains(target)) {
        lastFocused = target
    }
}

function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault()
        suppressCancel = true
        globalThis.setTimeout(() => { suppressCancel = false }, 0)
        requestClose()
        return
    }

    if (event.key !== 'Tab') return

    const focusables = getFocusableElements()
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) {
        event.preventDefault()
        return
    }

    const activeElement = dialog.value?.ownerDocument.activeElement
    const inside = Boolean(dialog.value && activeElement && dialog.value.contains(activeElement))

    if (event.shiftKey && (activeElement === first || !inside)) {
        event.preventDefault()
        last.focus()
    } else if (!event.shiftKey && (activeElement === last || !inside)) {
        event.preventDefault()
        first.focus()
    }
}

function handleCancel(event: Event) {
    event.preventDefault()
    if (suppressCancel) return
    requestClose()
}

function requestClose() {
    if (props.busy || props.uncertain) return

    if (isDirty()
        && typeof window !== 'undefined'
        && !window.confirm('Hay cambios sin guardar. ¿Descartar y cerrar el formulario?')) {
        return
    }

    closingAuthorized = true
    emit('cancel')
}

function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) requestClose()
}

function reload() {
    if (props.busy) return
    emit('reload')
}

async function focusFirstInvalidField(errors: PriceListFieldErrors) {
    await nextTick()

    if (errors.nombre) {
        nameInput.value?.focus()
    } else if (errors.porcentajeDescuento) {
        discountInput.value?.focus()
    }
}

function submit() {
    if (props.busy || props.uncertain) return

    const normalizedName = name.value.trim()
    const normalizedDiscount = discount.value.trim().replace(',', '.')
    const errors: PriceListFieldErrors = {}

    if (normalizedName.length === 0 || [...normalizedName].length > 150) {
        errors.nombre = 'Ingresá un nombre de entre 1 y 150 caracteres.'
    }
    if (!/^[0-9]{1,2}(?:\.[0-9]{1,2})?$/.test(normalizedDiscount)) {
        errors.porcentajeDescuento = 'Ingresá un porcentaje entre 0 y 99,99, con hasta dos decimales.'
    }

    fieldErrors.value = errors

    if (Object.keys(errors).length > 0) {
        void focusFirstInvalidField(errors)
        return
    }

    emit('save', {
        nombre: normalizedName,
        porcentajeDescuento: normalizedDiscount,
        activa: Boolean(active.value),
    })
}
</script>

<template>
    <dialog
        ref="dialog"
        aria-labelledby="price-list-form-title"
        class="box-border m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-lg border-0 bg-transparent p-0 text-left text-[#0b2438] backdrop:bg-[#0b2438]/70 sm:w-[calc(100%-2rem)]"
        @cancel="handleCancel"
        @close="handleNativeClose"
        @click="handleBackdropClick"
        @focusin="rememberFocus"
        @keydown="handleKeydown"
    >
        <div class="box-border flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#f8fafc] shadow-2xl">
            <header class="box-border flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
                <h3 id="price-list-form-title" class="m-0 min-w-0 text-lg font-bold text-[#0b2438] wrap-anywhere">
                    {{ priceList ? 'Editar lista de precios' : 'Nueva lista de precios' }}
                </h3>
                <button
                    type="button"
                    class="box-border flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent font-[inherit] text-2xl leading-none text-slate-600 hover:bg-slate-100 hover:text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Cerrar formulario de lista de precios"
                    :disabled="busy || uncertain"
                    @click="requestClose"
                >
                    &times;
                </button>
            </header>

            <form class="box-border flex min-h-0 flex-1 flex-col" novalidate @submit.prevent="submit">
                <div ref="scrollArea" class="box-border min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-6">
                    <div v-if="uncertain || error" class="box-border space-y-2">
                        <div
                            v-if="uncertain"
                            role="alert"
                            class="box-border rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                        >
                            <p class="m-0 wrap-anywhere">{{ error || 'No se pudo confirmar el resultado. Recargá las listas antes de continuar.' }}</p>
                            <button
                                type="button"
                                class="mt-2 min-h-11 cursor-pointer border-0 bg-transparent font-[inherit] font-semibold text-red-900 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60"
                                :disabled="busy"
                                @click="reload"
                            >
                                {{ busy ? 'Recargando…' : 'Recargar listas' }}
                            </button>
                        </div>
                        <p
                            v-else
                            role="alert"
                            class="m-0 box-border rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 wrap-anywhere"
                        >
                            {{ error }}
                        </p>
                    </div>

                    <div>
                        <label for="price-list-name" class="block text-sm font-medium">Nombre de la lista</label>
                        <input
                            id="price-list-name"
                            ref="nameInput"
                            v-model="name"
                            type="text"
                            required
                            maxlength="150"
                            autocomplete="off"
                            :disabled="busy || uncertain"
                            :aria-invalid="fieldErrors.nombre ? 'true' : 'false'"
                            :aria-describedby="fieldErrors.nombre ? 'price-list-name-error' : undefined"
                            class="box-border mt-1 block min-h-11 w-full rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                        <p v-if="fieldErrors.nombre" id="price-list-name-error" role="alert" class="mt-1 text-sm text-red-800">
                            {{ fieldErrors.nombre }}
                        </p>
                    </div>

                    <div>
                        <label for="price-list-discount" class="block text-sm font-medium">Descuento (%)</label>
                        <input
                            id="price-list-discount"
                            ref="discountInput"
                            v-model="discount"
                            type="text"
                            required
                            inputmode="decimal"
                            maxlength="5"
                            :disabled="busy || uncertain"
                            :aria-invalid="fieldErrors.porcentajeDescuento ? 'true' : 'false'"
                            :aria-describedby="fieldErrors.porcentajeDescuento ? 'price-list-discount-hint price-list-discount-error' : 'price-list-discount-hint'"
                            class="box-border mt-1 block min-h-11 w-full rounded-md border border-solid border-slate-300 bg-white px-3 py-2 font-[inherit] text-sm text-[#0b2438] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                        <p id="price-list-discount-hint" class="mt-1 text-xs text-slate-600">
                            Usá coma o punto. Ejemplo: 12,5.
                        </p>
                        <p v-if="fieldErrors.porcentajeDescuento" id="price-list-discount-error" role="alert" class="mt-1 text-sm text-red-800">
                            {{ fieldErrors.porcentajeDescuento }}
                        </p>
                    </div>

                    <label class="box-border flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                        <input
                            v-model="active"
                            type="checkbox"
                            :disabled="busy || uncertain"
                            class="h-5 w-5 cursor-pointer accent-[#145a8d] disabled:cursor-not-allowed"
                        >
                        Activa
                    </label>
                </div>

                <footer class="box-border flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:gap-3 sm:px-6 sm:py-4">
                    <button
                        type="button"
                        class="box-border min-h-11 w-full cursor-pointer rounded-md border border-solid border-slate-300 bg-white px-4 font-[inherit] text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        :disabled="busy || uncertain"
                        @click="requestClose"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        class="box-border min-h-11 w-full cursor-pointer rounded-md border-0 bg-[#145a8d] px-5 font-[inherit] text-sm font-semibold text-white hover:bg-[#103a5c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145a8d] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        :disabled="busy || uncertain"
                    >
                        {{ busy ? 'Guardando…' : 'Guardar cambios' }}
                    </button>
                </footer>
            </form>
        </div>
    </dialog>
</template>
