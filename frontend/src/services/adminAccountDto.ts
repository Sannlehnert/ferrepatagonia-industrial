import type { AccountDetail, AccountList, AccountQuery, Due, Movement } from '../types/adminAccount'

const invalid = (): never => { throw new Error('La respuesta de cuenta corriente no es válida.') }
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid()
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const id = (v: unknown) => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 2147483647
const decimal = (v: unknown, signed = false): boolean => typeof v === 'string' &&
  (signed ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^(?:0|[1-9]\d*)\.\d{2}$/).test(v) && v !== '-0.00'
const money = (v: unknown, signed = false) => v === null || decimal(v, signed)
const date = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const utc = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) &&
  date(v.slice(0, 10)) && !Number.isNaN(Date.parse(v))
const term = (v: unknown) => v === null || v === 30 || v === 60
const origin = (v: unknown) => v === 'REAL' || v === 'DEMO'
const coverage = (v: unknown) => ['COMPLETA', 'PARCIAL', 'NO_ACREDITADA'].includes(String(v))
const state = (v: unknown) => v === 'HABILITADA' || v === 'INHABILITADA'
const page = (v: Record<string, unknown>) => Array.isArray(v.items) && v.items.length <= 100 &&
  (v.siguienteCursor === null || text(v.siguienteCursor))

function context(raw: unknown) {
  const v = object(object(raw).data)
  if (!utc(v.corte) || !text(v.revision)) invalid()
  return v
}
function summary(raw: unknown) {
  const v = object(raw)
  if (!state(v.estado) || !id(v.cuentaId) || !origin(v.origen) || v.moneda !== 'USD' || !term(v.plazoDias) ||
    !money(v.saldo, true) || !coverage(v.cobertura) || !['BLOQUEADO', 'DISPONIBLE', 'NO_DETERMINABLE'].includes(String(v.estadoCredito)) ||
    !['limite', 'utilizado', 'disponible', 'deudaVencidaTotal', 'deudaVencida30Dias', 'deudaVencida60Dias', 'deudaPorVencerTotal'].every(k => money(v[k])) ||
    (v.cobertura === 'COMPLETA' && v.saldo === null)) invalid()
}
export function decodeAccountList(raw: unknown): AccountList {
  const v = context(raw)
  if (!page(v)) invalid()
  for (const item of v.items as unknown[]) { summary(item); if (!id(object(item).clienteId)) invalid() }
  return v as AccountList
}
export function decodeAccountQuery(raw: unknown): AccountQuery {
  const v = context(raw)
  if (v.estado !== 'SIN_CUENTA') summary(v)
  return v as AccountQuery
}
function movement(raw: unknown) {
  const v = object(raw), reference = object(v.referencia)
  if (!text(v.id) || !utc(v.fechaOperacion) || !text(v.concepto) || !decimal(v.importe) || v.importe === '0.00' ||
    !money(v.saldoResultante, true) || v.moneda !== 'USD' || !origin(v.origen) || !['VIGENTE', 'ANULADO'].includes(String(v.estado)) ||
    (v.tipo === 'CARGO' ? (!id(reference.pedidoId) || !term(v.plazoDias) || !(v.venceEl === null || date(v.venceEl))) :
      v.tipo !== 'ABONO' || !id(reference.pagoId) || v.venceEl !== null || v.plazoDias !== null)) invalid()
}
function due(raw: unknown) {
  const v = object(raw)
  if (!text(v.movimientoId) || !date(v.venceEl) || !term(v.plazoDias) || v.moneda !== 'USD' || !money(v.pendiente) || !origin(v.origen) ||
    !['POR_VENCER', 'VENCIDO', 'NO_DETERMINABLE'].includes(String(v.estado)) ||
    (v.pendiente === null && v.estado !== 'NO_DETERMINABLE')) invalid()
}
export function decodeAccountDetail<T extends Movement | Due>(raw: unknown, kind: 'movimientos' | 'vencimientos'): AccountDetail<T> {
  const v = context(raw)
  if (v.estado !== 'SIN_CUENTA') {
    if (!state(v.estado) || !coverage(v.cobertura) || !page(v)) invalid()
    for (const item of v.items as unknown[]) (kind === 'movimientos' ? movement : due)(item)
  }
  return v as AccountDetail<T>
}

// Formatting preserves arbitrary decimal precision; it never converts money to Number.
export function accountMoney(value: string | null): string {
  if (value === null) return 'No acreditado'
  const [whole, cents] = value.split('.')
  return `USD ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`
}
