import api from './api'
import { decodeAccountDetail, decodeAccountList, decodeAccountQuery } from './adminAccountDto'
import type { AccountFilters, Due, Movement } from '../types/adminAccount'

export const getAdminAccounts = async (params: AccountFilters, signal?: AbortSignal) =>
  decodeAccountList((await api.get('/admin/cuentas-corrientes', { params, signal })).data)
export const getAdminAccount = async (clienteId: number, signal?: AbortSignal) =>
  decodeAccountQuery((await api.get(`/admin/clientes/${clienteId}/cuenta-corriente`, { signal })).data)
export async function getAdminAccountDetail<K extends 'movimientos' | 'vencimientos'>(
  clienteId: number, kind: K, cursor?: string, signal?: AbortSignal,
) {
  return decodeAccountDetail<K extends 'movimientos' ? Movement : Due>(
    (await api.get(`/admin/clientes/${clienteId}/cuenta-corriente/${kind}`, { params: { limite: 25, cursor }, signal })).data, kind)
}
