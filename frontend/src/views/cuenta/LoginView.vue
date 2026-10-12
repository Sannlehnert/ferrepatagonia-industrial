<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const enviando = ref(false)

async function enviar() {
  error.value = null
  enviando.value = true
  try {
    await auth.login(email.value, password.value)
    const r = route.query.redirect
    const destino =
      typeof r === 'string' && r.startsWith('/') && !r.startsWith('//')
        ? r
        : '/mi-cuenta'
    await router.push(destino)
  } catch {
    error.value = 'Email o contraseña incorrectos.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <section>
    <h2>Iniciar sesión</h2>
    <form @submit.prevent="enviar">
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Contraseña" required />
      <button :disabled="enviando">Ingresar</button>
    </form>
    <p v-if="error">{{ error }}</p>
  </section>
</template>