<script setup lang="ts">
import { reactive, ref, computed, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import AuthFrame from '@/components/AuthFrame.vue'
import AuthField from '@/components/AuthField.vue'
import { useAuthStore } from '@/stores/auth'
import { registrar } from '@/services/registroService'
import { validarRegistro, armarPayload, type CampoRegistro } from '@/utils/registro'
import type { RegistroForm } from '@/types/registro'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const formElement = ref<HTMLFormElement | null>(null)

const form = reactive<RegistroForm>({
  tipoCliente: route.query.tipo === 'empresa' ? 'EMPRESA' : 'PARTICULAR',
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

async function focusFirstError() {
  await nextTick()
  formElement.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

async function enviar() {
  intentado.value = true
  errorEmail.value = errorGeneral.value = null
  if (Object.keys(errores.value).length) {
    await focusFirstError()
    return
  }

  enviando.value = true
  let registrado = false
  try {
    await registrar(armarPayload(form))
    registrado = true
    await auth.login(form.email.trim(), form.password)
    await router.push({ name: 'cuenta-datos' })
  } catch (e) {
    if (registrado) {
      await router.push({ name: 'login' }) // la cuenta existe, falló solo el login
      return
    }
    const status = axios.isAxiosError(e) ? e.response?.status : undefined
    if (status === 409) {
      errorEmail.value = 'Ese email ya está registrado.'
      await focusFirstError()
    }
    else if (status === 400 && axios.isAxiosError(e))
      errorGeneral.value = e.response?.data?.message ?? 'Revisá los datos ingresados.'
    else errorGeneral.value = 'No se pudo completar el registro. Intentá de nuevo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <AuthFrame
    registration
    title="Crear cuenta"
    intro="Elegí cómo querés comprar y completá tus datos."
    panel-title="Tu cuenta industrial."
    panel-copy="Registrate a título personal o a nombre de una empresa. Desde tu cuenta vas a poder consultar tus pedidos."
  >
    <form ref="formElement" class="register-form" novalidate :aria-busy="enviando" @submit.prevent="enviar">
      <fieldset class="register-group customer-group">
        <legend>Tipo de cuenta</legend>
        <div class="customer-options">
          <label class="customer-option">
            <input v-model="form.tipoCliente" type="radio" name="tipoCliente" value="PARTICULAR" class="fp-focus" />
            <span>Particular</span>
          </label>
          <label class="customer-option">
            <input v-model="form.tipoCliente" type="radio" name="tipoCliente" value="EMPRESA" class="fp-focus" />
            <span>Empresa</span>
          </label>
        </div>
        <p v-if="form.tipoCliente === 'EMPRESA'" class="company-note">
          <strong>Aprobación empresarial</strong>
          Tu cuenta queda pendiente de evaluación. Las condiciones comerciales y la cuenta corriente requieren habilitación.
        </p>
      </fieldset>

      <fieldset class="register-group">
        <legend>{{ form.tipoCliente === 'PARTICULAR' ? 'Datos personales' : 'Datos de la empresa' }}</legend>
        <div v-if="form.tipoCliente === 'PARTICULAR'" class="field-grid">
          <AuthField id="register-name" v-model="form.nombre" label="Nombre" name="nombre" autocomplete="given-name" required :error="verError('nombre')" @blur="tocados.nombre = true" />
          <AuthField id="register-surname" v-model="form.apellido" label="Apellido" name="apellido" autocomplete="family-name" required :error="verError('apellido')" @blur="tocados.apellido = true" />
        </div>
        <div v-else class="field-grid">
          <AuthField id="register-company" v-model="form.razonSocial" label="Razón social" name="razonSocial" autocomplete="organization" required :error="verError('razonSocial')" @blur="tocados.razonSocial = true" />
          <AuthField id="register-tax" v-model="form.cuit" label="CUIT" name="cuit" inputmode="numeric" placeholder="30-12345678-9" required :error="verError('cuit')" @blur="tocados.cuit = true" />
        </div>
      </fieldset>

      <fieldset class="register-group">
        <legend>Contacto</legend>
        <div class="field-grid">
          <AuthField
            id="register-email"
            v-model="form.email"
            label="Email"
            name="email"
            type="email"
            autocomplete="email"
            required
            :error="verError('email') ?? errorEmail"
            @blur="tocados.email = true"
            @input="errorEmail = null"
          />
          <AuthField id="register-phone" v-model="form.telefono" label="Teléfono" name="telefono" type="tel" autocomplete="tel" required :error="verError('telefono')" @blur="tocados.telefono = true" />
          <div class="field-span">
            <AuthField id="register-address" v-model="form.direccion" label="Dirección (opcional)" name="direccion" autocomplete="street-address" :error="verError('direccion')" @blur="tocados.direccion = true" />
          </div>
        </div>
      </fieldset>

      <fieldset class="register-group">
        <legend>Contraseña de acceso</legend>
        <div class="field-grid">
          <AuthField id="register-password" v-model="form.password" label="Contraseña" name="password" type="password" autocomplete="new-password" required :error="verError('password')" @blur="tocados.password = true" />
          <AuthField id="register-confirm" v-model="form.confirmar" label="Repetir contraseña" name="confirmar" type="password" autocomplete="new-password" required :error="verError('confirmar')" @blur="tocados.confirmar = true" />
        </div>
      </fieldset>

      <p v-if="errorGeneral" class="fp-error fp-error-panel" role="alert">{{ errorGeneral }}</p>
      <div class="register-actions">
        <button class="fp-action fp-action--primary fp-focus" :disabled="enviando">
          {{ enviando ? 'Creando cuenta...' : 'Crear cuenta' }}
        </button>
        <p>¿Ya tenés cuenta? <RouterLink class="fp-focus" :to="{ name: 'login' }">Iniciá sesión</RouterLink></p>
      </div>
    </form>
  </AuthFrame>
</template>

<style scoped>
.register-form { display: grid; gap: 1.25rem; }
.register-group { min-inline-size: 0; margin: 0; padding: 0; border: 0; }
.register-group legend {
  box-sizing: border-box;
  width: 100%;
  margin-bottom: .7rem;
  padding: 0 0 .45rem;
  border-bottom: 1px solid var(--fp-line);
  color: var(--fp-navy);
  font-size: 1rem;
  font-weight: 800;
}
.customer-group legend { padding: 0; border: 0; }
.customer-options, .field-grid { display: grid; gap: .75rem; }
.customer-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.customer-option {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: .55rem;
  min-height: 48px;
  padding: .55rem .65rem;
  border: 1px solid var(--fp-control-line);
  border-radius: var(--fp-radius);
  font-size: .9rem;
  font-weight: 700;
  cursor: pointer;
}
.customer-option:has(:checked) { border-color: var(--fp-blue); background: #eaf3fa; box-shadow: inset 0 0 0 1px var(--fp-blue); }
.customer-option input { margin: 0; accent-color: var(--fp-blue); }
.company-note { margin: .7rem 0 0; border-inline-start: 3px solid var(--fp-amber); padding: .6rem .75rem; background: #fbf3e6; font-size: .88rem; }
.company-note strong { display: block; margin-bottom: .15rem; }
.register-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem 1rem; }
.register-actions p { margin: 0; font-size: .91rem; }
.register-actions a { color: var(--fp-blue); font-weight: 700; text-underline-offset: .2em; }
@media (max-width: 739px) {
  .register-actions .fp-action { width: 100%; }
}
@media (min-width: 740px) {
  .register-form { gap: 1rem; }
  .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field-span { grid-column: 1 / -1; }
}
</style>
