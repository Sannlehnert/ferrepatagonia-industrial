import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const captures = process.env.SPRINT6_CAPTURES === '1'

async function capture(page: Page, name: string, fullPage = true) {
  if (!captures) return
  const output = path.resolve('../docs/269/after', name + '.png')
  await page.screenshot({ path: output, fullPage, animations: 'disabled' })
}

const banner = (page: Page) => page.getByRole('banner')

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const url = new URL(message.location().url || page.url())
    const anonymousSession = url.pathname === '/api/auth/me' && message.text().includes('401')
    const devInspector = url.pathname === '/@id/virtual:vue-inspector-path:load.js' && message.text().includes('404')
    if (!anonymousSession && !devInspector) errors.push(message.text() + ' (' + url.pathname + ')')
  })
  return errors
}

for (const width of [360, 390, 768, 1024, 1280, 1440]) {
  test('Home, cuenta y panel sin desborde a ' + width + ' px', async ({ page }) => {
    const errors = collectErrors(page)
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const samples = width === 1440 || width === 390
    const isMobile = width < 800

    async function fits() {
      expect(await page.locator('html').evaluate(html => html.scrollWidth)).toBe(width)
    }

    await page.goto('/')
    await expect(page.getByRole('link', { name: /^Ver producto:/ })).toHaveCount(4)
    await expect(page.getByText('Consultando precios…')).toHaveCount(0)
    await fits()
    if (samples) await capture(page, 'home-' + width)

    const menu = banner(page).getByRole('button', { name: 'Menú principal' })
    const nav = banner(page).getByRole('navigation', { name: 'Menú principal' })
    if (width < 900) {
      await expect(nav).toBeHidden()
      await menu.focus()
      await page.keyboard.press('Enter')
      await expect(menu).toHaveAttribute('aria-expanded', 'true')
      await expect(nav.getByRole('link', { name: 'Catálogo' })).toBeFocused()
      if (width === 390) await capture(page, 'navbar-390', false)
      await fits()
      await page.keyboard.press('Escape')
      await expect(menu).toBeFocused()
      await expect(nav).toBeHidden()
      await menu.click()
      await nav.getByRole('link', { name: 'Empresas' }).click()
      await expect(page).toHaveURL(/#empresas$/)
      await expect(page.getByRole('region', { name: 'Ferrepatagonia para empresas' })).toBeFocused()
      await expect(nav).toBeHidden()
    } else {
      await expect(nav.getByRole('link', { name: 'Catálogo' })).toBeVisible()
    }

    await page.goto('/registro')
    await expect(page.getByRole('radio', { name: 'Particular' })).toBeChecked()
    await fits()
    if (samples) await capture(page, 'registro-particular-' + width)
    await page.getByRole('radio', { name: 'Empresa' }).check()
    await expect(page.getByLabel('Razón social')).toBeVisible()
    await expect(page.getByText('Tu cuenta queda pendiente de evaluación.', { exact: false })).toBeVisible()
    await fits()
    if (samples) await capture(page, 'registro-empresa-' + width)

    await page.getByRole('link', { name: 'Iniciá sesión' }).click()
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()
    await fits()
    if (samples) await capture(page, 'login-' + width)
    await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
    await page.getByLabel('Contraseña', { exact: true }).fill('E2eLocal-214!')
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/dashboard$/)
    await fits()
    if (samples) await capture(page, 'dashboard-' + width)

    const adminToggle = page.getByRole('button', { name: 'Menú de administración' })
    const adminNav = page.getByRole('navigation', { name: 'Menú de administración' })
    if (isMobile) {
      await expect(adminNav).toBeHidden()
      await adminToggle.focus()
      await page.keyboard.press('Enter')
      await expect(adminNav.getByRole('link').first()).toBeFocused()
    }
    await expect(adminNav.getByRole('link')).toHaveText([
      'Dashboard', 'Pedidos', 'Productos', 'Categorías', 'Clientes', 'Cuentas corrientes', 'Importar productos',
    ])
    await expect(adminNav.getByRole('link').first()).toHaveAttribute('aria-current', 'page')
    if (width === 390) await capture(page, 'sidebar-390', false)
    if (isMobile) {
      await page.keyboard.press('Escape')
      await expect(adminToggle).toBeFocused()
      await adminToggle.click()
    }
    await adminNav.getByRole('link', { name: 'Cuentas corrientes' }).click()
    await expect(page).toHaveURL(/\/admin\/cuentas-corrientes$/)
    if (isMobile) {
      await expect(adminNav).toBeHidden()
      await expect(page.getByRole('main')).toBeFocused()
      await adminToggle.click()
    }
    await expect(adminNav.getByRole('link', { name: 'Cuentas corrientes' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('link', { name: 'Volver a la tienda' }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(errors).toEqual([])
  })
}

test('login conserva sus errores, permite revelar la contraseña y volver a la tienda', async ({ page }) => {
  await page.goto('/login')
  const email = page.getByLabel('Email', { exact: true })
  const password = page.getByLabel('Contraseña', { exact: true })
  const submit = page.getByRole('button', { name: 'Ingresar', exact: true })
  await submit.click()
  await expect(email).toBeFocused()
  await expect(email).toHaveAccessibleDescription('Ingresá tu email.')
  await expect(password).toHaveAccessibleDescription('Ingresá tu contraseña.')
  await email.fill('admin@e2e.test')
  await password.fill('clave-invalida')
  await page.getByRole('button', { name: 'Mostrar contraseña' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Ocultar contraseña' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST')
  await submit.click()
  expect((await response).status()).toBe(401)
  await expect(page.getByRole('alert')).toHaveText('Email o contraseña incorrectos.')
  await page.getByRole('link', { name: 'Volver a la tienda' }).click()
  await expect(page).toHaveURL(/\/$/)
})

for (const type of ['PARTICULAR', 'EMPRESA'] as const) {
  test('alta real de ' + type.toLowerCase(), async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/registro')
    await page.getByRole('link', { name: 'Volver a la tienda' }).click()
    await expect(page).toHaveURL(/\/$/)

    if (type === 'EMPRESA') {
      await page.getByRole('link', { name: 'Registrá tu empresa' }).click()
      await expect(page.getByRole('radio', { name: 'Empresa' })).toBeChecked()
    } else {
      await banner(page).getByRole('button', { name: 'Menú principal' }).click()
      await banner(page).getByRole('link', { name: 'Crear cuenta' }).click()
      await expect(page.getByRole('radio', { name: 'Particular' })).toBeChecked()
    }

    const submit = page.getByRole('button', { name: 'Crear cuenta' })
    const identity = page.getByLabel(type === 'EMPRESA' ? 'Razón social' : 'Nombre', { exact: true })
    await submit.click()
    await expect(identity).toBeFocused()
    await expect(identity).toHaveAttribute('aria-invalid', 'true')
    await identity.fill(type === 'EMPRESA' ? 'Ferretería de prueba' : 'Sofía')
    if (type === 'EMPRESA') await page.getByLabel('CUIT', { exact: true }).fill('30-71234567-1')
    else await page.getByLabel('Apellido', { exact: true }).fill('Prueba')
    await page.getByLabel('Email', { exact: true }).fill('sprint6-' + randomUUID() + '@e2e.test')
    await page.getByLabel('Teléfono', { exact: true }).fill('299 5550100')
    await page.getByLabel('Dirección (opcional)', { exact: true }).fill('Calle de prueba 100')
    await page.getByLabel('Contraseña', { exact: true }).fill('Registro-214!')
    await page.getByLabel('Repetir contraseña', { exact: true }).fill('Registro-214!')
    const response = page.waitForResponse(r => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST')
    await submit.click()
    const registration = await response
    expect(registration.ok()).toBe(true)
    expect(registration.request().postDataJSON()).toMatchObject({
      tipoCliente: type,
      nombreRazonSocial: type === 'EMPRESA' ? 'Ferretería de prueba' : 'Sofía Prueba',
      telefono: '299 5550100',
      direccion: 'Calle de prueba 100',
      ...(type === 'EMPRESA' ? { cuit: '30-71234567-1' } : {}),
    })
    await expect(page).toHaveURL(/\/mi-cuenta\/datos$/)
  })
}
