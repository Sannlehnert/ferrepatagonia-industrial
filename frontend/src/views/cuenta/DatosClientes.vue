<script setup lang="ts">
import axios from 'axios'
import { computed, onScopeDispose, ref, watch } from 'vue'
import {
  getOwnProfile,
  updateOwnProfile,
  type AccountProfile,
  type AccountProfileChanges,
} from '@/services/profileService'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ summaryOnly?: boolean }>()
const auth = useAuthStore()
const profile = ref<AccountProfile | null>(null)
const telefono = ref('')
const direccion = ref('')
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const saveError = ref('')
const feedback = ref('')
const validation = ref<{ telefono?: string; direccion?: string }>({})
let requestSequence = 0
let activeRequest: AbortController | undefined

const sessionKey = () => auth.user && auth.rol === 'CLIENTE' && !auth.loggingIn && !auth.loggingOut
  ? `${auth.user.id}:${auth.sessionVersion}`
  : null
const editable = computed(() => profile.value !== null && !loading.value && !saving.value)
const dirty = computed(() => !!profile.value && (
  telefono.value.trim() !== (profile.value.telefono ?? '').trim() ||
  direccion.value.trim() !== (profile.value.direccion ?? '').trim()
))
const approvalLabel = computed(() => {
  switch (profile.value?.estadoAprobacionEmpresa) {
    case 'APROBADA': return 'Aprobada'
    case 'PENDIENTE': return 'Pendiente'
    case 'RECHAZADA': return 'Rechazada'
    default: return 'No determinable'
  }
})

function isCurrent(sequence: number, key: string, signal: AbortSignal) {
  return sequence === requestSequence && !signal.aborted && sessionKey() === key
}

async function loadProfile() {
  const key = sessionKey()
  const sequence = ++requestSequence
  activeRequest?.abort()
  activeRequest = undefined
  profile.value = null
  telefono.value = ''
  direccion.value = ''
  saving.value = false
  loadError.value = ''
  saveError.value = ''
  feedback.value = ''
  validation.value = {}
  if (!key) return

  const controller = activeRequest = new AbortController()
  loading.value = true
  try {
    const result = await getOwnProfile(controller.signal)
    if (!isCurrent(sequence, key, controller.signal)) return
    profile.value = result
    telefono.value = result.telefono ?? ''
    direccion.value = result.direccion ?? ''
  } catch (cause: unknown) {
    if (isCurrent(sequence, key, controller.signal)) {
      loadError.value = axios.isAxiosError<{ message?: string }>(cause)
        ? cause.response?.data?.message || 'No se pudieron cargar los datos de tu cuenta.'
        : 'No se pudieron cargar los datos de tu cuenta.'
    }
  } finally {
    if (isCurrent(sequence, key, controller.signal)) {
      loading.value = false
      activeRequest = undefined
    }
  }
}

function validate(): AccountProfileChanges | null {
  const errors: typeof validation.value = {}
  const phone = telefono.value.trim()
  const address = direccion.value.trim()
  const forbiddenControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/

  if ([...phone].length > 50) errors.telefono = 'El teléfono admite hasta 50 caracteres.'
  else if (forbiddenControls.test(phone)) errors.telefono = 'El teléfono contiene caracteres no permitidos.'

  if ([...address].length > 500) errors.direccion = 'La dirección admite hasta 500 caracteres.'
  else if (forbiddenControls.test(address)) errors.direccion = 'La dirección contiene caracteres no permitidos.'

  validation.value = errors
  if (Object.keys(errors).length) return null

  const changes: AccountProfileChanges = {}
  if (phone !== (profile.value?.telefono ?? '').trim()) changes.telefono = phone || null
  if (address !== (profile.value?.direccion ?? '').trim()) changes.direccion = address || null
  return Object.keys(changes).length ? changes : null
}

async function save() {
  if (!profile.value || saving.value) return
  feedback.value = ''
  saveError.value = ''
  const changes = validate()
  if (!changes) return

  const key = sessionKey()
  if (!key) return
  activeRequest?.abort()
  const sequence = ++requestSequence
  const controller = activeRequest = new AbortController()
  saving.value = true
  try {
    const result = await updateOwnProfile(changes, controller.signal)
    if (!isCurrent(sequence, key, controller.signal)) return
    profile.value = result
    telefono.value = result.telefono ?? ''
    direccion.value = result.direccion ?? ''
    feedback.value = 'Tus datos se guardaron correctamente.'
  } catch (cause: unknown) {
    if (isCurrent(sequence, key, controller.signal)) {
      saveError.value = axios.isAxiosError<{ message?: string }>(cause)
        ? cause.response?.data?.message || 'No se pudieron guardar los cambios. Tus datos siguen en el formulario.'
        : 'No se pudieron guardar los cambios. Tus datos siguen en el formulario.'
    }
  } finally {
    if (isCurrent(sequence, key, controller.signal)) {
      saving.value = false
      activeRequest = undefined
    }
  }
}

watch(
  () => props.summaryOnly ? null : sessionKey(),
  () => {
    if (!props.summaryOnly) void loadProfile()
  },
  { immediate: true, flush: 'sync' },
)
onScopeDispose(() => {
  requestSequence++
  activeRequest?.abort()
})
</script>

<template>
  <div class="w-full max-w-full min-w-0 box-border rounded-[10px] border border-[#E2E8F0] bg-white p-4 sm:p-6 shadow-sm">
    <template v-if="summaryOnly">
      <h3 class="m-0 mb-4 sm:mb-6 text-xl font-bold text-[#0B2438]">Mis datos</h3>
      <dl
        v-if="auth.user"
        class="grid grid-cols-1 w-full max-w-full min-w-0 gap-y-3 text-base box-border sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-x-4 sm:text-sm"
      >
        <dt class="w-full max-w-full min-w-0 box-border font-semibold text-slate-700">{{ auth.user.tipo_cliente === 'EMPRESA' ? 'Razón social' : 'Nombre' }}</dt>
        <dd class="m-0 w-full max-w-full min-w-0 box-border break-words font-medium text-[#0B2438]">{{ auth.user.nombre }}</dd>
        <dt class="w-full max-w-full min-w-0 box-border font-semibold text-slate-700">Email</dt>
        <dd class="m-0 w-full max-w-full min-w-0 box-border break-words font-medium text-[#0B2438]">{{ auth.user.email }}</dd>
      </dl>
    </template>
    <template v-else>
      <h1 class="m-0 mb-2 text-xl font-bold text-[#0B2438] sm:text-2xl">Mis datos</h1>
      <p class="mb-5 mt-0 text-sm text-slate-600">
        Consultá tus datos registrados. Podés actualizar tu teléfono y dirección.
      </p>

      <p v-if="loading" role="status" class="wrap-anywhere text-sm text-slate-600">Cargando tus datos…</p>
      <div v-else-if="loadError" class="space-y-3">
        <p role="alert" class="m-0 wrap-anywhere text-sm text-red-800">{{ loadError }}</p>
        <button
          type="button"
          class="box-border min-h-[44px] cursor-pointer rounded-md border border-[#103A5C] bg-white px-4 font-[inherit] text-sm font-semibold text-[#103A5C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
          @click="loadProfile"
        >
          Reintentar carga
        </button>
      </div>
      <template v-else-if="profile">
        <dl class="mb-6 grid min-w-0 grid-cols-1 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)] sm:gap-x-4">
          <dt class="font-semibold text-slate-700">Tipo de cuenta</dt>
          <dd class="m-0 break-words text-[#0B2438]">{{ profile.tipoCliente === 'EMPRESA' ? 'Empresa' : 'Particular' }}</dd>
          <dt class="font-semibold text-slate-700">{{ profile.tipoCliente === 'EMPRESA' ? 'Razón social' : 'Nombre' }}</dt>
          <dd class="m-0 break-words text-[#0B2438]">{{ profile.nombreRazonSocial }}</dd>
          <dt class="font-semibold text-slate-700">Email</dt>
          <dd class="m-0 break-words text-[#0B2438]">{{ profile.email }}</dd>
          <dt v-if="profile.tipoCliente === 'PARTICULAR'" class="font-semibold text-slate-700">Documento</dt>
          <dd v-if="profile.tipoCliente === 'PARTICULAR'" class="m-0 break-words text-[#0B2438]">{{ profile.docCliente || 'No informado' }}</dd>
          <dt v-if="profile.tipoCliente === 'EMPRESA'" class="font-semibold text-slate-700">CUIT</dt>
          <dd v-if="profile.tipoCliente === 'EMPRESA'" class="m-0 break-words text-[#0B2438]">{{ profile.cuit || 'No informado' }}</dd>
          <template v-if="profile.tipoCliente === 'EMPRESA'">
            <dt class="font-semibold text-slate-700">Aprobación de empresa</dt>
            <dd class="m-0 break-words text-[#0B2438]">{{ approvalLabel }}</dd>
            <dt class="font-semibold text-slate-700">Cuenta corriente</dt>
            <dd class="m-0 break-words text-[#0B2438]">
              {{ profile.cuentaCorrienteHabilitada === null
                ? 'Sin cuenta asociada'
                : profile.cuentaCorrienteHabilitada ? 'Habilitada' : 'Inhabilitada' }}
            </dd>
          </template>
        </dl>

        <form class="space-y-4 border-t border-slate-200 pt-5" novalidate @submit.prevent="save">
          <div>
            <label for="profile-phone" class="mb-1 block text-sm font-semibold text-slate-700">Teléfono</label>
            <input
              id="profile-phone"
              v-model="telefono"
              type="tel"
              autocomplete="tel"
              :disabled="!editable"
              :aria-invalid="!!validation.telefono"
              :aria-describedby="validation.telefono ? 'profile-phone-error' : undefined"
              class="box-border min-h-[44px] w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 font-[inherit] text-base text-[#0B2438] disabled:bg-slate-50 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
            />
            <p v-if="validation.telefono" id="profile-phone-error" role="alert" class="mb-0 mt-1 wrap-anywhere text-sm text-red-800">
              {{ validation.telefono }}
            </p>
          </div>
          <div>
            <label for="profile-address" class="mb-1 block text-sm font-semibold text-slate-700">Dirección</label>
            <textarea
              id="profile-address"
              v-model="direccion"
              rows="3"
              :disabled="!editable"
              :aria-invalid="!!validation.direccion"
              :aria-describedby="validation.direccion ? 'profile-address-error' : undefined"
              class="box-border min-h-24 w-full min-w-0 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-[inherit] text-base text-[#0B2438] disabled:bg-slate-50 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
            />
            <p v-if="validation.direccion" id="profile-address-error" role="alert" class="mb-0 mt-1 wrap-anywhere text-sm text-red-800">
              {{ validation.direccion }}
            </p>
          </div>

          <p v-if="feedback" role="status" aria-live="polite" class="m-0 wrap-anywhere text-sm font-semibold text-emerald-800">
            {{ feedback }}
          </p>
          <p v-if="saveError" role="alert" class="m-0 wrap-anywhere text-sm text-red-800">{{ saveError }}</p>

          <button
            type="submit"
            :disabled="!editable || !dirty"
            class="box-border min-h-[44px] cursor-pointer rounded-md border-0 bg-[#103A5C] px-5 font-[inherit] text-sm font-semibold text-white hover:bg-[#145A8D] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#145A8D]"
          >
            {{ saving ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </form>
      </template>
    </template>
  </div>
</template>
