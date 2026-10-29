import type { RegistroForm, RegistroPayload } from '@/types/registro'

export type CampoRegistro = Exclude<keyof RegistroForm, 'tipoCliente'>
export type ErroresRegistro = Partial<Record<CampoRegistro, string>>

// Límites de database/schema.sql y password.service.ts
const MAX = { nombreRazonSocial: 200, email: 254, cuit: 20, telefono: 50, direccion: 500 }
const MIN_PASSWORD = 8 // puntos de código Unicode, igual que el DTO de registro backend
const MAX_PASSWORD_BYTES = 72

export const esEmailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

export function cuitValido(v: string): boolean {
  const d = v.replace(/\D/g, '')
  if (d.length !== 11) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0)
  let dv = 11 - (suma % 11)
  if (dv === 11) dv = 0
  return dv !== 10 && dv === Number(d[10])
}

export function validarRegistro(f: RegistroForm): ErroresRegistro {
  const e: ErroresRegistro = {}
  const largo = (s: string) => Array.from(s.trim()).length

  if (f.tipoCliente === 'PARTICULAR') {
    if (!f.nombre.trim()) e.nombre = 'Ingresá tu nombre.'
    if (!f.apellido.trim()) e.apellido = 'Ingresá tu apellido.'
    if (largo(`${f.nombre} ${f.apellido}`) > MAX.nombreRazonSocial)
      e.nombre = `Nombre y apellido admiten hasta ${MAX.nombreRazonSocial} caracteres.`
  } else {
    if (!f.razonSocial.trim()) e.razonSocial = 'Ingresá la razón social.'
    else if (largo(f.razonSocial) > MAX.nombreRazonSocial)
      e.razonSocial = `Admite hasta ${MAX.nombreRazonSocial} caracteres.`
    if (!f.cuit.trim()) e.cuit = 'Ingresá el CUIT.'
    else if (!cuitValido(f.cuit)) e.cuit = 'El CUIT no es válido (11 dígitos).'
  }

  if (!f.email.trim()) e.email = 'Ingresá tu email.'
  else if (!esEmailValido(f.email)) e.email = 'El email no tiene un formato válido.'
  else if (largo(f.email) > MAX.email) e.email = 'El email es demasiado largo.'

  // La matriz de permisos lista el teléfono como dato de registro
  const digitos = f.telefono.replace(/\D/g, '').length
  if (!f.telefono.trim()) e.telefono = 'Ingresá un teléfono.'
  else if (!/^[\d\s()+-]+$/.test(f.telefono.trim()) || digitos < 6)
    e.telefono = 'El teléfono no es válido.'
  else if (largo(f.telefono) > MAX.telefono) e.telefono = 'El teléfono es demasiado largo.'

  if (f.direccion.trim() && largo(f.direccion) > MAX.direccion)
    e.direccion = `Admite hasta ${MAX.direccion} caracteres.`

  // Unicode regex supports existing ES2015+ browsers without isWellFormed().
  // Valid pairs (emoji) do not match; unpaired UTF-16 surrogates do.
  if (/[\uD800-\uDFFF]/u.test(f.password))
    e.password = 'La contraseña contiene Unicode inválido.'
  else if (Array.from(f.password).length < MIN_PASSWORD)
    e.password = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`
  else if (new TextEncoder().encode(f.password).length > MAX_PASSWORD_BYTES)
    e.password = 'La contraseña es demasiado larga (máximo 72 bytes).'

  if (f.confirmar !== f.password) e.confirmar = 'Las contraseñas no coinciden.'

  return e
}

// Solo los campos que el backend acepta; los vacíos se omiten.
export function armarPayload(f: RegistroForm): RegistroPayload {
  const esEmpresa = f.tipoCliente === 'EMPRESA'
  const payload: RegistroPayload = {
    tipoCliente: f.tipoCliente,
    nombreRazonSocial: esEmpresa
      ? f.razonSocial.trim()
      : `${f.nombre.trim()} ${f.apellido.trim()}`,
    email: f.email.trim(),
    password: f.password, // sin trim: el backend tampoco la recorta
  }
  if (esEmpresa) payload.cuit = f.cuit.trim()
  if (f.telefono.trim()) payload.telefono = f.telefono.trim()
  if (f.direccion.trim()) payload.direccion = f.direccion.trim()
  return payload
}
