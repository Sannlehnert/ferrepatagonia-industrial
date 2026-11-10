<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import AuthFrame from '@/components/AuthFrame.vue'
import AuthField from '@/components/AuthField.vue'
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
const formElement = ref<HTMLFormElement | null>(null)

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
  if (errEmail.value || errPassword.value) {
    await nextTick()
    formElement.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }

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
  <AuthFrame
    title="Iniciar sesión"
    intro="Ingresá con el email y la contraseña de tu cuenta."
    panel-title="Compras y pedidos, en un solo lugar."
    panel-copy="Consultá tus pedidos y las condiciones comerciales disponibles para tu cuenta."
  >
    <form ref="formElement" class="login-form" novalidate :aria-busy="enviando" @submit.prevent="enviar">
      <AuthField id="login-email" v-model="email" label="Email" type="email" name="email" autocomplete="username" required :error="intentado ? errEmail : null" />
      <AuthField
        id="login-password"
        v-model="password"
        label="Contraseña"
        name="password"
        :type="verPassword ? 'text' : 'password'"
        autocomplete="current-password"
        required
        :error="intentado ? errPassword : null"
      >
        <button
          type="button"
          class="fp-action fp-action--plain fp-focus password-toggle"
          aria-controls="login-password"
          :aria-label="verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'"
          @click="verPassword = !verPassword"
        >
          {{ verPassword ? 'Ocultar' : 'Mostrar' }}
        </button>
      </AuthField>

      <p v-if="error" class="fp-error fp-error-panel" role="alert">{{ error }}</p>
      <button class="fp-action fp-action--primary fp-focus" :disabled="enviando">
        {{ enviando ? 'Ingresando...' : 'Ingresar' }}
      </button>
      <p class="auth-switch">¿No tenés cuenta? <RouterLink class="fp-focus" :to="{ name: 'registro' }">Creá una</RouterLink></p>
    </form>
  </AuthFrame>
</template>

<style scoped>
.login-form { display: grid; gap: 1.1rem; }
.password-toggle { border-color: var(--fp-control-line); background: white; }
.password-toggle:hover { background: var(--fp-bg); }
.auth-switch { margin: 0; font-size: .91rem; }
.auth-switch a { color: var(--fp-blue); font-weight: 700; text-underline-offset: .2em; }
</style>
