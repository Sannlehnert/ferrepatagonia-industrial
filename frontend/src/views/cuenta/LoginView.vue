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
  <section class="login">
    <h2>Iniciar sesión</h2>

    <form novalidate @submit.prevent="enviar">
      <label>Email
        <input v-model="email" type="email" autocomplete="email" />
        <small v-if="intentado && errEmail" class="error">{{ errEmail }}</small>
      </label>

      <label>Contraseña
        <span class="pass">
          <input
            v-model="password"
            :type="verPassword ? 'text' : 'password'"
            autocomplete="current-password"
          />
          <button type="button" @click="verPassword = !verPassword">
            {{ verPassword ? 'Ocultar' : 'Mostrar' }}
          </button>
        </span>
        <small v-if="intentado && errPassword" class="error">{{ errPassword }}</small>
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button :disabled="enviando">{{ enviando ? 'Ingresando...' : 'Ingresar' }}</button>
      <p>¿No tenés cuenta? <RouterLink :to="{ name: 'registro' }">Creá una</RouterLink></p>
    </form>
  </section>
</template>

<style scoped>
.login { max-width: 380px; margin: 2rem auto; padding: 0 1rem; }
form { display: flex; flex-direction: column; gap: 1rem; }
label { display: flex; flex-direction: column; gap: .25rem; font-size: .9rem; }
.pass { display: flex; gap: .5rem; }
.pass input { flex: 1; }
.error { color: #842029; }
</style>