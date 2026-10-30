<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useAuthStore } from '@/stores/auth'
import { esEmailValido } from '@/utils/registro'
import { destinoTrasLogin } from '@/utils/rutas'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const verPassword = ref(false)
const intentado = ref(false)
const enviando = ref(false)
const error = ref<string | null>(null)

const errEmail = computed(() => {
  if (!email.value.trim()) return 'Ingresá tu email.'
  if (!esEmailValido(email.value)) return 'El email no tiene un formato válido.'
  return null
})
const errPassword = computed(() => (password.value ? null : 'Ingresá tu contraseña.'))

function mensajeError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status
    if (status === 401) return 'Email o contraseña incorrectos.'
    if (status === 400) return e.response?.data?.message ?? 'Revisá los datos ingresados.'
    if (!e.response || (status && status >= 500))
      return 'No se pudo conectar con el servidor. Intentá más tarde.'
  }
  return 'No se pudo iniciar sesión. Intentá de nuevo.'
}

async function enviar() {
  intentado.value = true
  error.value = null
  if (errEmail.value || errPassword.value) return

  enviando.value = true
  try {
    await auth.login(email.value.trim(), password.value)
  } catch (e) {
    error.value = mensajeError(e)
    return
  } finally {
    enviando.value = false
  }

  const rol = auth.rol
  await router.push(rol ? destinoTrasLogin(router, route.query.redirect, rol) : '/')
}
</script>

<template>
  <section class="mx-auto my-8 max-w-[380px] px-4">
    <h2 class="m-0 mb-5 text-2xl font-semibold text-[#0b2438]">Iniciar sesión</h2>

    <form class="flex flex-col gap-4" novalidate @submit.prevent="enviar">
      <label class="flex flex-col gap-1 text-sm">Email
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="email" type="email" autocomplete="email" />
        <small v-if="intentado && errEmail" class="text-sm text-[#842029]">{{ errEmail }}</small>
      </label>

      <label class="flex flex-col gap-1 text-sm">Contraseña
        <span class="flex gap-2">
          <input
            v-model="password"
            :type="verPassword ? 'text' : 'password'"
            autocomplete="current-password"
            class="box-border min-h-11 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]"
          />
          <button class="min-h-11 rounded-md border border-slate-300 bg-white px-3 hover:bg-slate-100" type="button" @click="verPassword = !verPassword">
            {{ verPassword ? 'Ocultar' : 'Mostrar' }}
          </button>
        </span>
        <small v-if="intentado && errPassword" class="text-sm text-[#842029]">{{ errPassword }}</small>
      </label>

      <p v-if="error" class="m-0 text-sm text-[#842029]" role="alert">{{ error }}</p>

      <button class="min-h-11 rounded-md border-0 bg-[#145a8d] px-4 py-2 font-semibold text-white hover:bg-[#103a5c] disabled:cursor-wait disabled:opacity-60" :disabled="enviando">{{ enviando ? 'Ingresando...' : 'Ingresar' }}</button>
      <p class="m-0 text-sm">¿No tenés cuenta? <RouterLink class="text-[#145a8d] underline" :to="{ name: 'registro' }">Creá una</RouterLink></p>
    </form>
  </section>
</template>