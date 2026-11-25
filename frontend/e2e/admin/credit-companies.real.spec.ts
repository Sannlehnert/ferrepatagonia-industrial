import { randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'
import { removeCreditCompanies } from '../helpers/credit-fixture-cleanup'

type Company = {
  id: number
  email: string
  name: string
  cuit: string
  requestId?: number
}

type Setup = {
  token: string
  companies: Record<string, Company>
}

const password = 'E2eLocal-214!'
let setup: Setup
let admin: APIRequestContext
const createdIds: number[] = []

function origin(baseURL: string | undefined): string {
  return new URL(baseURL ?? process.env.E2E_BASE_URL!).origin
}

async function registerCompany(ctx: APIRequestContext, baseURL: string, token: string, suffix: string, index: number): Promise<Company> {
  const name = `Empresa ${token} ${suffix}`
  const email = `credit-354-${token}-${index}@e2e.test`
  const cuit = `30-${token.slice(0, 8)}-${index}`
  const response = await ctx.post('/api/auth/register', {
    headers: { Origin: origin(baseURL) },
    data: {
      tipoCliente: 'EMPRESA',
      nombreRazonSocial: name,
      cuit,
      email,
      password,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return { id: 0, email, name, cuit }
}

async function findClientId(ctx: APIRequestContext, email: string): Promise<number> {
  const response = await ctx.get('/api/admin/clientes', { params: { busqueda: email, limit: 10 } })
  expect(response.ok(), await response.text()).toBe(true)
  const clients = (await response.json()).data.clientes as Array<{ id: number; email: string }>
  const found = clients.find(client => client.email === email)
  if (!found) throw new Error(`No se encontró la empresa ${email}.`)
  return found.id
}

test.beforeAll(async () => {
  const baseURL = process.env.E2E_BASE_URL!
  const headers = { Origin: origin(baseURL) }
  const token = randomUUID().replaceAll('-', '').slice(0, 8)
  const companies: Record<string, Company> = {}
  const anonymous = await playwrightRequest.newContext({ baseURL })
  admin = await playwrightRequest.newContext({ baseURL })
  const companySession = await playwrightRequest.newContext({ baseURL })
  try {
    const login = await admin.post('/api/auth/login', {
      headers,
      data: { email: 'admin@e2e.test', password },
    })
    expect(login.ok(), await login.text()).toBe(true)

    // Seis empresas simples permiten comprobar la paginación real del listado.
    for (let index = 0; index < 6; index += 1) {
      const simple = await registerCompany(anonymous, baseURL, token, `Simple ${index + 1}`, index + 1)
      simple.id = await findClientId(admin, simple.email)
      createdIds.push(simple.id)
      companies[`simple${index}`] = simple
    }

    const keys = ['noAccount', 'pending', 'rejected', 'approved', 'enabled'] as const
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!
      const company = await registerCompany(
        anonymous, baseURL, token, key, index + 10,
      )
      company.id = await findClientId(admin, company.email)
      createdIds.push(company.id)
      companies[key] = company
      const approval = await admin.patch(`/api/admin/clientes/${company.id}/estado-empresa`, {
        headers,
        data: { estado: 'APROBADA' },
      })
      expect(approval.status(), await approval.text()).toBe(200)
    }

    for (const key of ['pending', 'rejected', 'approved', 'enabled'] as const) {
      const company = companies[key]!
      const loginCompany = await companySession.post('/api/auth/login', {
        headers,
        data: { email: company.email, password },
      })
      expect(loginCompany.ok(), await loginCompany.text()).toBe(true)
      const created = await companySession.post('/api/cuenta-corriente/solicitudes', {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: { montoSolicitado: '500.00', plazoDias: 30, observaciones: 'Solicitud E2E #354' },
      })
      expect(created.status(), await created.text()).toBe(201)
      company.requestId = (await created.json()).data.solicitud.id
    }

    const reject = await admin.post(`/api/admin/solicitudes-credito/${companies.rejected!.requestId}/rechazar`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: { motivo: 'Antecedentes insuficientes #354' },
    })
    expect(reject.status(), await reject.text()).toBe(200)

    for (const key of ['approved', 'enabled'] as const) {
      const approve = await admin.post(`/api/admin/solicitudes-credito/${companies[key]!.requestId}/aprobar`, {
        headers: { ...headers, 'Idempotency-Key': randomUUID() },
        data: {
          limiteAutorizado: key === 'enabled' ? '900.00' : '700.00',
          plazoDias: 30,
          evidencia: `TEST-ONLY #354 ${key}`,
          motivo: 'Aprobación E2E #354',
        },
      })
      expect(approve.status(), await approve.text()).toBe(200)
    }
    const enable = await admin.post(`/api/admin/clientes/${companies.enabled!.id}/cuenta-corriente/habilitar`, {
      headers: { ...headers, 'Idempotency-Key': randomUUID() },
      data: { evidencia: 'TEST-ONLY habilitación #354' },
    })
    expect(enable.status(), await enable.text()).toBe(200)

    setup = { token, companies }
  } finally {
    await companySession.dispose()
    await anonymous.dispose()
  }
})

test.afterAll(async () => {
  try {
    await removeCreditCompanies(createdIds)
  } catch (error) {
    console.error('No se pudo limpiar el fixture de crédito ADMIN.', error)
  } finally {
    await admin?.dispose()
  }
})

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill(password)
  const authenticated = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/login')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  expect((await authenticated).status()).toBe(200)
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}

async function openCompanies(page: Page) {
  await page.goto('/admin/cuentas-corrientes')
  await expect(page.getByRole('tab', { name: 'Empresas y crédito', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('Buscar empresa', { exact: true }).fill(setup.token)
  await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
}

for (const width of [320, 360, 390, 768, 1024, 1280] as const) {
  test.describe(`gestión administrativa de empresas a ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('busca, filtra, pagina y expone la situación comercial completa', async ({ page }) => {
      test.setTimeout(90_000)
      await loginAdmin(page)
      await openCompanies(page)

      const companyList = page.getByRole('list').filter({
        has: page.getByRole('button', { name: /Ver detalle de Empresa / }),
      }).first()
      await expect(companyList.getByRole('listitem')).toHaveCount(10)
      await expect(page.getByRole('status').filter({ hasText: 'Mostrando 1–10 de 11 empresas' }))
        .toBeVisible()

      await page.getByRole('button', { name: 'Página siguiente de empresas', exact: true }).click()
      await expect(companyList.getByRole('listitem')).toHaveCount(1)
      await expect(page.getByRole('status').filter({ hasText: 'Página 2 de 2' })).toBeVisible()
      await page.getByRole('button', { name: 'Página anterior de empresas', exact: true }).click()
      await expect(companyList.getByRole('listitem')).toHaveCount(10)

      await page.getByLabel('Estado comercial', { exact: true }).selectOption('APROBADA')
      await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
      await expect(companyList.getByRole('listitem')).toHaveCount(5)
      await expect(page.getByRole('status').filter({ hasText: 'Mostrando 1–5 de 5 empresas' }))
        .toBeVisible()

      await page.getByLabel('Cuenta corriente', { exact: true }).selectOption('HABILITADA')
      await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
      await expect(companyList.getByRole('listitem')).toHaveCount(1)
      await expect(companyList).toContainText(setup.companies.enabled!.name)
      await expect(companyList).toContainText('Habilitada')

      await page.getByLabel('Cuenta corriente', { exact: true }).selectOption('')
      await page.getByLabel('Estado de solicitud', { exact: true }).selectOption('PENDIENTE')
      await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
      await expect(companyList.getByRole('listitem')).toHaveCount(1)
      await expect(companyList).toContainText(setup.companies.pending!.name)
      await expect(companyList).toContainText('Pendiente de resolución')

      await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click()
      await page.getByLabel('Buscar empresa', { exact: true }).fill(setup.companies.approved!.cuit)
      await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
      await expect(companyList.getByRole('listitem')).toHaveCount(1)
      await expect(companyList).toContainText(setup.companies.approved!.name)

      await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click()
      await page.getByLabel('Buscar empresa', { exact: true }).fill(setup.companies.enabled!.email)
      await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
      await companyList.getByRole('button', {
        name: `Ver detalle de ${setup.companies.enabled!.name}`,
      }).click()

      const detail = page.getByRole('region', { name: `Cliente ${setup.companies.enabled!.id}`, exact: true })
      await expect(detail).toContainText(setup.companies.enabled!.name)
      await expect(detail).toContainText(setup.companies.enabled!.cuit!)
      for (const heading of [
        'Aprobación empresarial',
        'Solicitud de crédito',
        'Habilitación de la cuenta',
        'Elegibilidad de compra',
      ]) {
        await expect(detail.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      }
      await expect(detail.getByText('Habilitada. Participa en la validación de compras a crédito.'))
        .toBeVisible()
      await expect(detail.getByText('Crédito disponible según la cuenta. Cada compra se revalida.'))
        .toBeVisible()
      await expect(detail.getByText('Límite', { exact: true }).locator('..').locator('dd'))
        .toHaveText('USD 900,00')
      const controls = detail.locator('section').filter({
        has: page.getByRole('heading', { name: 'Gestión de crédito', exact: true }),
      })
      await expect(controls.getByRole('button', { name: 'Deshabilitar cuenta', exact: true }))
        .toBeVisible()

      const history = detail.getByRole('region', { name: 'Historial de solicitudes y decisiones' })
      await expect(history).toContainText(`Solicitud #${setup.companies.enabled!.requestId}`)
      await expect(history).toContainText('APROBADA')
      await expect(history.getByText('SOLICITUD_APROBADA', { exact: true })).toBeVisible()
      await expect(history.getByText('CUENTA_HABILITADA', { exact: true })).toBeVisible()

      await page.getByLabel('Buscar empresa', { exact: true }).fill(setup.companies.pending!.email)
      await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
      await companyList.getByRole('button', {
        name: `Ver detalle de ${setup.companies.pending!.name}`,
      }).click()
      const pendingDetail = page.getByRole('region', {
        name: `Cliente ${setup.companies.pending!.id}`,
        exact: true,
      })
      await expect(pendingDetail.getByText('Sin cuenta corriente asignada.')).toBeVisible()
      await expect(pendingDetail.getByText('Pendiente de resolución. Todavía no autoriza límite ni habilitación.'))
        .toBeVisible()
      await expect(pendingDetail.getByRole('button', {
        name: `Aprobar solicitud ${setup.companies.pending!.requestId}`,
        exact: true,
      })).toBeVisible()

      await page.getByLabel('Buscar empresa', { exact: true }).fill(setup.companies.noAccount!.email)
      await page.getByRole('button', { name: 'Buscar empresas', exact: true }).click()
      await companyList.getByRole('button', {
        name: `Ver detalle de ${setup.companies.noAccount!.name}`,
      }).click()
      const emptyDetail = page.getByRole('region', {
        name: `Cliente ${setup.companies.noAccount!.id}`,
        exact: true,
      })
      await expect(emptyDetail.getByText('Sin solicitudes de crédito registradas.')).toBeVisible()
      await expect(emptyDetail.getByText('Sin cuenta corriente asignada.')).toBeVisible()

      if (width === 390 || width === 1280) {
        await page.screenshot({
          path: `../docs/354/evidence/admin-credit-companies-${width}.png`,
          fullPage: true,
        })
      }
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
      const bounds = await page.getByLabel('Buscar empresa', { exact: true }).evaluate(element => {
        const box = element.getBoundingClientRect()
        const width = element.ownerDocument.defaultView!.innerWidth
        return box.left >= 0 && box.right <= width
      })
      expect(bounds).toBe(true)
    })
  })
}
