import { expect, test, type Page } from '@playwright/test'

const ids: Record<string, number> = JSON.parse(process.env.E2E_ADMIN_ACCOUNTS ?? '{}')
const password = 'E2eLocal-214!'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel(/^Contraseña/).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
}

for (const width of [1280, 360]) {
  test.describe(`ADMIN con ledger real a ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } })

    test('lista, filtra, pagina, consulta el ledger, recupera errores y cambia de sesión', async ({ page }) => {
      test.setTimeout(50_000)
      expect(ids.debt, 'El runner debe cargar las cuentas en MariaDB').toBeGreaterThan(0)
      await login(page, 'admin@e2e.test')
      await expect(page).toHaveURL(/\/admin\/dashboard$/)
      const sidebar = page.getByRole('button', { name: 'Menú de administración' })
      if (width === 360) {
        await sidebar.click()
        await expect(sidebar).toHaveAttribute('aria-expanded', 'true')
      }
      await page.getByRole('link', { name: 'Cuentas corrientes', exact: true }).click()
      const table = page.getByRole('table').first()
      await expect(table.getByRole('row')).toHaveCount(26)
      await expect(table).toContainText('DEMO')
      await page.getByRole('button', { name: 'Siguiente página de cuentas' }).click()
      await expect(table.getByRole('row')).toHaveCount(3)
      await expect(page.getByRole('button', { name: 'Siguiente página de cuentas' })).toHaveCount(0)

      const clientId = page.getByLabel('ID de cliente', { exact: true })
      const enabled = page.getByRole('combobox', { name: 'Habilitación' })
      const apply = page.getByRole('button', { name: 'Aplicar filtros' })
      await clientId.fill(String(ids.disabled))
      await enabled.selectOption('true')
      await apply.click()
      await expect(page.getByText('No hay cuentas para estos filtros.')).toBeVisible()
      await enabled.selectOption('false')
      await apply.click()
      await expect(table.getByRole('row')).toHaveCount(2)
      await expect(table).toContainText('INHABILITADA')
      await page.getByRole('button', { name: `Consultar cliente ${ids.disabled}`, exact: true }).click()
      await expect(page.getByText('Cuenta inhabilitada. El historial sigue disponible para consulta.')).toBeVisible()
      await expect(page.getByRole('region', { name: 'Movimientos', exact: true })).toContainText('USD 70,00')

      await clientId.fill(String(ids.debt))
      await enabled.selectOption('true')
      await apply.click()
      await expect(table.getByRole('row')).toHaveCount(2)
      await page.getByRole('button', { name: `Consultar cliente ${ids.debt}`, exact: true }).click()
      const detail = page.getByRole('region', { name: `Cliente ${ids.debt}`, exact: true })
      await expect(detail.getByText('USD 225,00', { exact: true }).first()).toBeVisible()
      await expect(detail.getByText('USD 1.000,00', { exact: true })).toBeVisible()
      await expect(detail.getByText('USD 775,00', { exact: true })).toBeVisible()
      const movements = page.getByRole('region', { name: 'Movimientos', exact: true })
      await expect(movements.getByRole('row')).toHaveCount(26)
      await expect(movements).toContainText('ABONO / ANULADO')
      const due = page.getByRole('region', { name: 'Vencimientos', exact: true })
      await expect(due.getByRole('row').filter({ hasText: '2026-03-03' })).toContainText('USD 175,00')
      await expect(due).toContainText('2026-04-01')
      await page.screenshot({ path: test.info().outputPath('admin-ledger-real.png'), fullPage: true })
      await page.getByRole('button', { name: 'Siguiente página de movimientos' }).click()
      await expect(movements.getByRole('row')).toHaveCount(8)
      await expect(movements).toContainText('2025-12-01')
      await expect(page.getByRole('button', { name: 'Siguiente página de movimientos' })).toHaveCount(0)

      async function lookup(id: number) {
        await clientId.fill(String(id))
        await page.getByRole('button', { name: 'Consultar cliente por ID' }).click()
      }
      await lookup(ids.empty)
      await expect(page.getByText('Sin movimientos.', { exact: true })).toBeVisible()
      await expect(page.getByText('Sin vencimientos abiertos.')).toBeVisible()
      await lookup(ids.favor)
      await expect(page.getByRole('region', { name: `Cliente ${ids.favor}` }).getByText('USD -150,00').first()).toBeVisible()
      await lookup(ids.unknown)
      const unknown = page.getByRole('region', { name: `Cliente ${ids.unknown}` })
      await expect(unknown).toContainText('NO_ACREDITADA')
      await expect(unknown.getByText('No acreditado', { exact: true }).first()).toBeVisible()
      await lookup(ids.partial)
      await expect(page.getByRole('region', { name: `Cliente ${ids.partial}` })).toContainText('PARCIAL')
      await lookup(1)
      await expect(page.getByText('El cliente no tiene cuenta corriente asignada.')).toBeVisible()
      await lookup(2147483647)
      await expect(page.getByText('El cliente no existe.', { exact: true })).toBeVisible()
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

      // Disconnection is real at the browser transport. Every successful financial response comes from MariaDB.
      await clientId.fill(String(ids.debt))
      await page.context().setOffline(true)
      try {
        await apply.click()
        await expect(page.getByRole('alert')).toContainText('No pudimos consultar las cuentas')
      } finally {
        await page.context().setOffline(false)
      }
      await page.getByRole('button', { name: 'Reintentar desde la primera página' }).click()
      await expect(table).toContainText('USD 225,00')
      if (width === 360) {
        await expect(sidebar).toHaveAttribute('aria-expanded', 'false')
        await sidebar.click()
      }
      await page.getByRole('button', { name: /Cerrar sesión/ }).click()
      await expect(page).toHaveURL(/\/login$/)
      await login(page, 'cc258-long@example.test')
      await expect(page).not.toHaveURL(/\/login/)
      await page.goto('/admin/cuentas-corrientes')
      await expect(page).toHaveURL(/\/acceso-denegado$/)
      await expect(page.getByRole('table')).toHaveCount(0)
      for (const path of ['/admin/cuentas-corrientes', ...['', '/movimientos', '/vencimientos'].map(
        segment => `/admin/clientes/${ids.debt}/cuenta-corriente${segment}`,
      )]) {
        expect((await page.request.get('/api' + path)).status()).toBe(403)
      }
      const own = await page.request.get('/api/cuenta-corriente')
      expect(own.status()).toBe(200)
      expect((await own.json()).data.saldo).toBe('500.00')
    })
  })
}
