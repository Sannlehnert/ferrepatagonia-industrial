import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

async function registerAndLogin(page: Page, tipo: 'PARTICULAR' | 'EMPRESA') {
  const email = `layout-${randomUUID()}@e2e.test`
  const password = 'LayoutPassword123!'
  const cuit = `30-${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}-9`
  await page.goto('/')
  const data = tipo === 'EMPRESA'
    ? { tipoCliente: tipo, nombreRazonSocial: 'Empresa Layout', cuit, email, password }
    : { tipoCliente: tipo, nombreRazonSocial: 'Cliente Layout', docCliente: `${Math.floor(Math.random() * 1e8)}`.padStart(8, '2'), email, password }
  const registration = await page.request.post('/api/auth/register', {
    headers: { Origin: new URL(page.url()).origin },
    data,
  })
  expect(registration.status(), await registration.text()).toBe(201)
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL('/mi-cuenta')
}

test('empresa: login, dashboard, historial, cuenta corriente y logout con backend real', async ({ page }) => {
  await registerAndLogin(page, 'EMPRESA')
  await expect(page.locator('.store-header, footer')).toHaveCount(0)
  const menu = page.getByRole('navigation', { name: 'Menú de mi cuenta' })
  await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')

  await menu.getByRole('link', { name: 'Historial de pedidos' }).click()
  await expect(page).toHaveURL('/mi-cuenta/pedidos')
  await expect(menu.getByRole('link', { name: 'Historial de pedidos' })).toHaveAttribute('aria-current', 'page')

  await page.goto('/mi-cuenta/pedidos?filtro=desconocido')
  await expect(menu.getByRole('link', { name: 'Historial de pedidos' })).toHaveAttribute('aria-current', 'page')
  await expect(menu.locator('[aria-current="page"]')).toHaveCount(1)

  await menu.getByRole('link', { name: 'Cuenta corriente', exact: true }).click()
  await expect(page).toHaveURL('/mi-cuenta/cuenta-corriente')
  await expect(page.getByRole('main')).toContainText('No tenés una cuenta corriente asociada')

  await page.locator('aside').getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page).toHaveURL('/login')
  await page.goto('/mi-cuenta')
  await expect(page).toHaveURL(/\/login/)
})

test('particular: no ve cuenta corriente y el sidebar sigue accesible con contenido largo', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 })
  await registerAndLogin(page, 'PARTICULAR')
  const menu = page.getByRole('navigation', { name: 'Menú de mi cuenta' })
  await expect(menu.getByRole('link', { name: 'Cuenta corriente', exact: true })).toHaveCount(0)
  await page.locator('main').evaluate(el => { el.style.minHeight = '4000px' })
  await page.evaluate('window.scrollTo(0, 3000)')
  await expect(page.locator('aside').getByRole('button', { name: 'Volver a tienda' })).toBeInViewport()
  await expect(page.locator('aside').getByRole('button', { name: 'Cerrar sesión' })).toBeInViewport()
})
