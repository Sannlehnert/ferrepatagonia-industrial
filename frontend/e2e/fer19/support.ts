import { expect, type APIResponse, type Page, type Response } from '@playwright/test'
import { createRequire } from 'node:module'

type Connection = { query(sql: string, params?: unknown[]): Promise<unknown> }

type Client = {
  clientId: number
  accountId: number | null
  email: string
  movements: Array<{ id: number; amount: string; orderId?: number; paymentId?: number }>
}

export const fixture: { password: string; clients: Record<string, Client>; admin: { email: string } } =
  JSON.parse(process.env.FER19_E2E_FIXTURE ?? 'null')

export const own = '/api/cuenta-corriente'
export const clientScreen = '/mi-cuenta/cuenta-corriente'
export const adminList = '/api/admin/cuentas-corrientes'
export const adminDetail = (id: number) => '/api/admin/clientes/' + id + '/cuenta-corriente'
export const adminScreen = '/admin/cuentas-corrientes'

export async function login(page: Page, identity: { email: string }) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(identity.email)
  await page.getByLabel(/^Contraseña/).fill(fixture.password)
  const authenticated = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page.getByRole('button', { name: /Cerrar sesión/ })).toBeVisible()
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /Cerrar sesión/ }).click()
  await expect(page).toHaveURL(/\/login$/)
}

export async function clientAccount(page: Page) {
  await page.getByRole('link', { name: 'Cuenta corriente', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(clientScreen + '$'))
  await expect(page.getByRole('heading', { name: 'Cuenta corriente', exact: true })).toBeVisible()
}

export async function adminAccounts(page: Page) {
  await page.getByRole('link', { name: 'Cuentas corrientes', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(adminScreen + '$'))
  await expect(page.getByRole('heading', { name: 'Cuentas corrientes', exact: true })).toBeVisible()
}

export function privateResponse(response: APIResponse | Response, status: number) {
  expect(response.status(), response.url()).toBe(status)
  expect(response.headers()['cache-control']).toMatch(/private.*no-store/)
  expect(response.headers()['vary']).toMatch(/\bCookie\b/i)
}

export async function data<T>(response: APIResponse | Response): Promise<T> {
  privateResponse(response, 200)
  const body = await response.json()
  expect(body.data).toBeDefined()
  return body.data as T
}

export async function apiError(response: APIResponse | Response, status: number, code?: string) {
  privateResponse(response, status)
  const body = await response.json()
  expect(body.data).toBeUndefined()
  if (code) expect(body.code).toBe(code)
}

const require = createRequire(import.meta.url)
export async function withOwnedDb<T>(work: (connection: Connection) => Promise<T>) {
  expect(process.env.E2E_ISOLATED).toBe('1')
  expect(process.env.E2E_FER19).toBe('acceptance')
  const { connectOwned, assertOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs')
  const session = await connectOwned(JSON.parse(process.env.FER19_E2E_PROFILE ?? 'null'), 'E2E')
  try {
    await assertOwned(session)
    return await work(session.connection)
  } finally {
    await session.connection.end()
  }
}

export function nextPage(path: string, cursor: string, limit = 25) {
  const query = new URLSearchParams({ limite: String(limit), cursor })
  return path + '?' + query
}

export function emittedCursor(cursor: string | null): string {
  expect(cursor).toEqual(expect.any(String))
  if (!cursor) throw Error('La API debía emitir un cursor real')
  return cursor
}
