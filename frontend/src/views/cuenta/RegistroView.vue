<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { useAuthStore } from '@/stores/auth'
import { registrar } from '@/services/registroService'
import { validarRegistro, armarPayload, type CampoRegistro } from '@/utils/registro'
import type { RegistroForm } from '@/types/registro'

const auth = useAuthStore()
const router = useRouter()

const form = reactive<RegistroForm>({
  tipoCliente: 'PARTICULAR',
  nombre: '', apellido: '', razonSocial: '', cuit: '',
  email: '', telefono: '', direccion: '', password: '', confirmar: '',
})

const tocados = reactive<Partial<Record<CampoRegistro, boolean>>>({})
const intentado = ref(false)
const enviando = ref(false)
const errorEmail = ref<string | null>(null)
const errorGeneral = ref<string | null>(null)

const errores = computed(() => validarRegistro(form))
const verError = (c: CampoRegistro) =>
  intentado.value || tocados[c] ? errores.value[c] : undefined

async function enviar() {
  intentado.value = true
  errorEmail.value = errorGeneral.value = null
  if (Object.keys(errores.value).length) return

  enviando.value = true
  let registrado = false
  try {
    await registrar(armarPayload(form))
    registrado = true
    await auth.login(form.email.trim(), form.password)
    await router.push('/mi-cuenta')
  } catch (e) {
    if (registrado) {
      await router.push({ name: 'login' }) // la cuenta existe, falló solo el login
      return
    }
    const status = axios.isAxiosError(e) ? e.response?.status : undefined
    if (status === 409) errorEmail.value = 'Ese email ya está registrado.'
    else if (status === 400 && axios.isAxiosError(e))
      errorGeneral.value = e.response?.data?.message ?? 'Revisá los datos ingresados.'
    else errorGeneral.value = 'No se pudo completar el registro. Intentá de nuevo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <section class="registro">
    <h2>Crear cuenta</h2>

    <form novalidate @submit.prevent="enviar">
      <fieldset class="tipo">
        <label><input type="radio" value="PARTICULAR" v-model="form.tipoCliente" /> Particular</label>
        <label><input type="radio" value="EMPRESA" v-model="form.tipoCliente" /> Empresa</label>
      </fieldset>

      <template v-if="form.tipoCliente === 'PARTICULAR'">
        <label>Nombre
          <input v-model="form.nombre" @blur="tocados.nombre = true" autocomplete="given-name" />
          <small v-if="verError('nombre')" class="error">{{ verError('nombre') }}</small>
        </label>
        <label>Apellido
          <input v-model="form.apellido" @blur="tocados.apellido = true" autocomplete="family-name" />
          <small v-if="verError('apellido')" class="error">{{ verError('apellido') }}</small>
        </label>
      </template>

      <template v-else>
        <label>Razón social
          <input v-model="form.razonSocial" @blur="tocados.razonSocial = true" autocomplete="organization" />
          <small v-if="verError('razonSocial')" class="error">{{ verError('razonSocial') }}</small>
        </label>
        <label>CUIT
          <input v-model="form.cuit" @blur="tocados.cuit = true" inputmode="numeric" placeholder="30-12345678-9" />
          <small v-if="verError('cuit')" class="error">{{ verError('cuit') }}</small>
        </label>
        <p class="aviso">
          Registrarte como empresa no habilita cuenta corriente ni descuentos:
          tu cuenta queda pendiente de aprobación.
        </p>
      </template>

      <label>Email
        <input v-model="form.email" type="email" @blur="tocados.email = true" @input="errorEmail = null" autocomplete="email" />
        <small v-if="verError('email') || errorEmail" class="error">{{ verError('email') ?? errorEmail }}</small>
      </label>

      <label>Teléfono
        <input v-model="form.telefono" type="tel" @blur="tocados.telefono = true" autocomplete="tel" />
        <small v-if="verError('telefono')" class="error">{{ verError('telefono') }}</small>
      </label>

      <label>Dirección (opcional)
        <input v-model="form.direccion" @blur="tocados.direccion = true" autocomplete="street-address" />
        <small v-if="verError('direccion')" class="error">{{ verError('direccion') }}</small>
      </label>

      <label>Contraseña
        <input v-model="form.password" type="password" @blur="tocados.password = true" autocomplete="new-password" />
        <small v-if="verError('password')" class="error">{{ verError('password') }}</small>
      </label>

      <label>Repetir contraseña
        <input v-model="form.confirmar" type="password" @blur="tocados.confirmar = true" autocomplete="new-password" />
        <small v-if="verError('confirmar')" class="error">{{ verError('confirmar') }}</small>
      </label>

      <p v-if="errorGeneral" class="error" role="alert">{{ errorGeneral }}</p>

      <button :disabled="enviando">{{ enviando ? 'Creando cuenta...' : 'Crear cuenta' }}</button>
      <p>¿Ya tenés cuenta? <RouterLink :to="{ name: 'login' }">Iniciá sesión</RouterLink></p>
    </form>
  </section>
</template>

<style scoped>
.registro { max-width: 420px; margin: 2rem auto; padding: 0 1rem; }
form { display: flex; flex-direction: column; gap: 1rem; }
label { display: flex; flex-direction: column; gap: .25rem; font-size: .9rem; }
.tipo { display: flex; gap: 1.5rem; border: 0; padding: 0; }
.tipo label { flex-direction: row; align-items: center; gap: .4rem; }
.error { color: #842029; }
.aviso { font-size: .85rem; color: #666; margin: 0; }
</style>