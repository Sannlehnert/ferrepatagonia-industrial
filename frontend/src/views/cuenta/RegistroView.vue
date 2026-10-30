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
  <section class="mx-auto my-8 max-w-[420px] px-4">
    <h2 class="m-0 mb-5 text-2xl font-semibold text-[#0b2438]">Crear cuenta</h2>

    <form class="flex flex-col gap-4" novalidate @submit.prevent="enviar">
      <fieldset class="flex gap-6 border-0 p-0">
        <label class="flex items-center gap-2 text-sm"><input type="radio" value="PARTICULAR" v-model="form.tipoCliente" /> Particular</label>
        <label class="flex items-center gap-2 text-sm"><input type="radio" value="EMPRESA" v-model="form.tipoCliente" /> Empresa</label>
      </fieldset>

      <template v-if="form.tipoCliente === 'PARTICULAR'">
        <label class="flex flex-col gap-1 text-sm">Nombre
          <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.nombre" @blur="tocados.nombre = true" autocomplete="given-name" />
          <small v-if="verError('nombre')" class="text-sm text-[#842029]">{{ verError('nombre') }}</small>
        </label>
        <label class="flex flex-col gap-1 text-sm">Apellido
          <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.apellido" @blur="tocados.apellido = true" autocomplete="family-name" />
          <small v-if="verError('apellido')" class="text-sm text-[#842029]">{{ verError('apellido') }}</small>
        </label>
      </template>

      <template v-else>
        <label class="flex flex-col gap-1 text-sm">Razón social
          <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.razonSocial" @blur="tocados.razonSocial = true" autocomplete="organization" />
          <small v-if="verError('razonSocial')" class="text-sm text-[#842029]">{{ verError('razonSocial') }}</small>
        </label>
        <label class="flex flex-col gap-1 text-sm">CUIT
          <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.cuit" @blur="tocados.cuit = true" inputmode="numeric" placeholder="30-12345678-9" />
          <small v-if="verError('cuit')" class="text-sm text-[#842029]">{{ verError('cuit') }}</small>
        </label>
        <p class="m-0 text-sm text-slate-600">
          Registrarte como empresa no habilita cuenta corriente ni descuentos:
          tu cuenta queda pendiente de aprobación.
        </p>
      </template>

      <label class="flex flex-col gap-1 text-sm">Email
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.email" type="email" @blur="tocados.email = true" @input="errorEmail = null" autocomplete="email" />
        <small v-if="verError('email') || errorEmail" class="text-sm text-[#842029]">{{ verError('email') ?? errorEmail }}</small>
      </label>

      <label class="flex flex-col gap-1 text-sm">Teléfono
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.telefono" type="tel" @blur="tocados.telefono = true" autocomplete="tel" />
        <small v-if="verError('telefono')" class="text-sm text-[#842029]">{{ verError('telefono') }}</small>
      </label>

      <label class="flex flex-col gap-1 text-sm">Dirección (opcional)
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.direccion" @blur="tocados.direccion = true" autocomplete="street-address" />
        <small v-if="verError('direccion')" class="text-sm text-[#842029]">{{ verError('direccion') }}</small>
      </label>

      <label class="flex flex-col gap-1 text-sm">Contraseña
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.password" type="password" @blur="tocados.password = true" autocomplete="new-password" />
        <small v-if="verError('password')" class="text-sm text-[#842029]">{{ verError('password') }}</small>
      </label>

      <label class="flex flex-col gap-1 text-sm">Repetir contraseña
        <input class="box-border min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-[#145a8d]" v-model="form.confirmar" type="password" @blur="tocados.confirmar = true" autocomplete="new-password" />
        <small v-if="verError('confirmar')" class="text-sm text-[#842029]">{{ verError('confirmar') }}</small>
      </label>

      <p v-if="errorGeneral" class="m-0 text-sm text-[#842029]" role="alert">{{ errorGeneral }}</p>

      <button class="min-h-11 rounded-md border-0 bg-[#145a8d] px-4 py-2 font-semibold text-white hover:bg-[#103a5c] disabled:cursor-wait disabled:opacity-60" :disabled="enviando">{{ enviando ? 'Creando cuenta...' : 'Crear cuenta' }}</button>
      <p class="m-0 text-sm">¿Ya tenés cuenta? <RouterLink class="text-[#145a8d] underline" :to="{ name: 'login' }">Iniciá sesión</RouterLink></p>
    </form>
  </section>
</template>