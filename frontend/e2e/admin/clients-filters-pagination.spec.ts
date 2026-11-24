import { expect, test as base, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

interface Session {
  connection: {
    query<T = unknown>(statement: string, values?: unknown[]): Promise<T>
    end(): Promise<void>
  }
}

const require = createRequire(import.meta.url)
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<Session>
}

const test = base.extend<{ session: Session }>({
  session: async ({}, use) => {
    const raw = process.env.CCE2E_TEST_PROFILE
    if (!raw) throw new Error('Ejecutá las E2E con backend/test/helpers/run-e2e.cjs')
    const session = await connectOwned(JSON.parse(raw), 'E2E')
    await use(session)
    await session.connection.end()
  },
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test')
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard$/)
}

const clientsRegion = (page: Page) => page.getByRole('region', { name: /Listado de clientes/ })
const pagination = (page: Page) => page.getByRole('navigation', { name: 'Paginación de clientes' })

async function rowIds(page: Page) {
  return clientsRegion(page).locator('tbody tr').evaluateAll(rows =>
    rows.map(row => row.getAttribute('data-client-row')))
}

async function expectPageFits(page: Page) {
  const fits = await page.evaluate<boolean>(
    'document.documentElement.scrollWidth <= document.documentElement.clientWidth',
  )
  expect(fits, 'El documento no debe desbordar horizontalmente').toBe(true)
}

test('filtros, paginación real, aprobación y contexto de listas en clientes', async ({
  page,
  session,
}) => {
  const prefix = `filtro346-${randomUUID().slice(0, 8)}`
  const { connection } = session
  const approvalName = `${prefix} Empresa Aprobación 346`

  try {
    for (let i = 1; i <= 45; i++) {
      const numero = String(i).padStart(2, '0')
      const empresa = i > 25
      const estado = empresa
        ? (i % 3 === 0 ? 'APROBADA' : i % 3 === 1 ? 'PENDIENTE' : 'RECHAZADA')
        : null
      const email = `${prefix}-${numero}@example.test`
      const result = await connection.query<{ insertId: bigint }>(`INSERT INTO CLIENTE
        (tipo_cliente, nombre_razon_social, doc_cliente, cuit, email,
         estado_aprobacion_empresa, es_fiel, activo)
        VALUES (?, ?, ?, ?, ?, ?, 0, 1)`, [
        empresa ? 'EMPRESA' : 'PARTICULAR',
        `${prefix} ${empresa ? 'Empresa' : 'Particular'} ${numero}`,
        `DOC-${numero}`,
        empresa ? `30-${numero}-9` : null,
        email,
        estado,
      ])
      const id = Number(result.insertId)
      await connection.query(`INSERT INTO USUARIO
        (id_cliente, email, password_hash, rol, activo, fecha_creacion)
        VALUES (?, ?, 'fixture-no-login', 'CLIENTE', 1, ?)`, [
        id,
        email,
        `2035-02-01 00:${String(i).padStart(2, '0')}:00`,
      ])
    }

    const approval = await connection.query<{ insertId: bigint }>(`INSERT INTO CLIENTE
      (tipo_cliente, nombre_razon_social, cuit, email, estado_aprobacion_empresa, es_fiel, activo)
      VALUES ('EMPRESA', ?, '30-34634634-6', ?, 'PENDIENTE', 0, 1)`, [
      approvalName,
      `${prefix}-aprobacion@example.test`,
    ])
    const approvalId = Number(approval.insertId)
    await connection.query(`INSERT INTO USUARIO
      (id_cliente, email, password_hash, rol, activo, fecha_creacion)
      VALUES (?, ?, 'fixture-no-login', 'CLIENTE', 1, '2035-02-02 00:00:00')`, [
      approvalId,
      `${prefix}-aprobacion@example.test`,
    ])

    await signIn(page)
    await page.goto('/admin/clientes')

    const search = page.getByRole('searchbox', { name: 'Buscar clientes' })
    const type = page.getByLabel('Tipo', { exact: true })
    const status = page.getByLabel('Estado de empresa', { exact: true })
    const summary = page.locator('#clients-summary')

    await expect(search).toBeVisible()
    await expect(type).toHaveValue('')
    await expect(status).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(0)

    await search.fill(prefix)
    await expect(summary).toContainText('de 46 clientes')
    await expect(summary).toContainText('Página 1 de 3')
    expect(new URL(page.url()).searchParams.get('busqueda')).toBe(prefix)
    expect(await rowIds(page)).toHaveLength(20)

    const firstPageIds = await rowIds(page)
    await pagination(page).getByRole('button', { name: 'Siguiente' }).click()
    await expect(summary).toContainText('Página 2 de 3')
    await expect(pagination(page).getByRole('button', { name: 'Anterior' })).toBeEnabled()
    const secondPageIds = await rowIds(page)
    expect(secondPageIds).toHaveLength(20)
    expect(secondPageIds.filter(id => firstPageIds.includes(id))).toEqual([])

    await pagination(page).getByRole('button', { name: 'Siguiente' }).click()
    await expect(summary).toContainText('Página 3 de 3')
    await expect(pagination(page).getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    expect(await rowIds(page)).toHaveLength(6)

    await page.goBack()
    await expect(summary).toContainText('Página 2 de 3')
    await expect(search).toHaveValue(prefix)
    await page.goForward()
    await expect(summary).toContainText('Página 3 de 3')

    await type.selectOption('PARTICULAR')
    await expect(summary).toContainText('de 25 clientes')
    await expect(summary).toContainText('Página 1 de 2')
    await expect(status).toBeDisabled()
    await expect(status).toHaveValue('')

    await type.selectOption('EMPRESA')
    await expect(status).toBeEnabled()
    await expect(summary).toContainText('de 21 clientes')
    await status.selectOption('PENDIENTE')
    await expect(summary).toContainText('de 7 clientes')
    await expect(summary).toContainText('Página 1 de 1')

    await page.getByRole('button', { name: 'Limpiar filtros' }).click()
    await expect(search).toHaveValue('')
    await expect(type).toHaveValue('')
    await expect(status).toHaveValue('')
    await expect(summary).toContainText('Página 1 de')

    // Aprobación desde una página filtrada: conserva filtros y hace visible el
    // resultado sobre la fila correcta.
    await search.fill(approvalName)
    await type.selectOption('EMPRESA')
    await status.selectOption('PENDIENTE')
    const approvalRow = clientsRegion(page).getByRole('row').filter({ hasText: approvalName })
    await expect(approvalRow.getByText('Pendiente', { exact: true })).toBeVisible()
    await approvalRow.getByRole('button', { name: `Aprobar cuenta empresa de ${approvalName}` }).click()
    const approveDialog = page.getByRole('dialog', { name: 'Aprobar empresa' })
    await approveDialog.getByRole('button', { name: 'Confirmar aprobación' }).click()
    await expect(approveDialog.getByRole('status').filter({ hasText: 'Empresa aprobada.' })).toBeVisible()
    await approveDialog.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    await expect(approvalRow.getByText('Aprobada', { exact: true })).toBeVisible()
    let url = new URL(page.url())
    expect(url.searchParams.get('busqueda')).toBe(approvalName)
    expect(url.searchParams.get('tipo')).toBe('EMPRESA')
    expect(url.searchParams.get('estadoEmpresa')).toBe('PENDIENTE')

    await approvalRow.getByRole('button', { name: `Rechazar cuenta empresa de ${approvalName}` }).click()
    const rejectDialog = page.getByRole('dialog', { name: 'Rechazar empresa' })
    await rejectDialog.getByRole('button', { name: 'Confirmar rechazo' }).click()
    await expect(rejectDialog.getByRole('status').filter({ hasText: 'Empresa rechazada.' })).toBeVisible()
    await rejectDialog.getByRole('button', { name: 'Cerrar detalle del cliente' }).click()
    await expect(approvalRow.getByText('Rechazada', { exact: true })).toBeVisible()

    // Asignación de lista sobre una búsqueda filtrada y restauración del fixture.
    await page.getByRole('button', { name: 'Limpiar filtros' }).click()
    await search.fill('Cliente E2E')
    const priceRow = clientsRegion(page).getByRole('row').filter({
      has: page.getByText('Cliente E2E', { exact: true }),
    })
    await expect(priceRow).toBeVisible()
    const select = priceRow.getByRole('combobox')
    const originalList = await select.inputValue()
    await select.selectOption('2')
    await priceRow.getByRole('button', { name: 'Guardar lista' }).click()
    await expect(priceRow.getByRole('status')).toHaveText('Lista asignada.')
    url = new URL(page.url())
    expect(url.searchParams.get('busqueda')).toBe('Cliente E2E')
    expect(url.searchParams.get('page')).toBeNull()

    await select.selectOption(originalList)
    await priceRow.getByRole('button', { name: 'Guardar lista' }).click()
    await expect(priceRow.getByRole('status')).toHaveText('Lista asignada.')

    // Formulario de lista: foco inicial, foco devuelto y confirmación de borrador.
    const newList = page.getByRole('button', { name: 'Nueva lista' })
    await newList.click()
    const dialog = page.getByRole('dialog', { name: 'Nueva lista de precios' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Nombre de la lista')).toBeFocused()
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press(i < 5 ? 'Tab' : 'Shift+Tab')
      expect(await page.evaluate<boolean>(
        "document.activeElement?.closest('dialog') !== null",
      )).toBe(true)
    }
    await dialog.getByLabel('Nombre de la lista').fill('Borrador 346')

    page.once('dialog', nativeDialog => nativeDialog.dismiss())
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    page.once('dialog', nativeDialog => nativeDialog.accept())
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(newList).toBeFocused()

    await search.fill(prefix)
    await expect(summary).toContainText('Página 1 de 3')

    // Responsive: sin desborde del documento, controles visibles y tabla
    // desplazable por teclado en pantallas angostas.
    for (const width of [320, 360, 390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      await expectPageFits(page)
      await expect(search).toBeVisible()
      await expect(type).toBeVisible()
      await expect(status).toBeVisible()
      await expect(clientsRegion(page)).toBeVisible()
      await expect(pagination(page)).toBeVisible()
      const next = pagination(page).getByRole('button', { name: 'Siguiente' })
      const box = await next.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }

    await page.setViewportSize({ width: 320, height: 844 })
    const region = clientsRegion(page)
    await expect(region).toHaveAccessibleDescription(/usá las flechas/)
    await region.focus()
    await expect(region).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    const helpBox = await page.locator('#clients-table-help').boundingBox()
    expect(helpBox).toBeTruthy()
    expect(helpBox!.x).toBeGreaterThanOrEqual(0)
    expect(helpBox!.x + helpBox!.width).toBeLessThanOrEqual(320)

    const evidence = resolve(process.cwd(), '../docs/346/evidence')
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 360, height: 844 })
    await expect.poll(() => region.evaluate(element => {
      element.blur()
      element.scrollTo({ left: 0, behavior: 'instant' })
      return element.scrollLeft
    })).toBe(0)
    await page.waitForTimeout(350)
    await region.evaluate(element => { element.scrollTo({ left: 0, behavior: 'instant' }) })
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBe(0)
    await page.screenshot({ path: resolve(evidence, 'clientes-360.png'), fullPage: true })
    await page.getByRole('button', { name: 'Nueva lista' }).click()
    await expect(page.getByRole('dialog', { name: 'Nueva lista de precios' })).toBeVisible()
    await page.screenshot({ path: resolve(evidence, 'clientes-formulario-360.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Nueva lista de precios' })).toHaveCount(0)

    await page.setViewportSize({ width: 1280, height: 900 })
    await region.evaluate(element => { element.scrollTo({ left: 0, behavior: 'instant' }) })
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBe(0)
    await page.screenshot({ path: resolve(evidence, 'clientes-1280.png'), fullPage: true })
    await page.getByRole('button', { name: 'Nueva lista' }).click()
    await expect(page.getByRole('dialog', { name: 'Nueva lista de precios' })).toBeVisible()
    await page.screenshot({ path: resolve(evidence, 'clientes-formulario-1280.png') })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Nueva lista de precios' })).toHaveCount(0)
  } finally {
    await connection.query('DELETE FROM USUARIO WHERE email LIKE ?', [`${prefix}-%`])
    await connection.query('DELETE FROM CLIENTE WHERE nombre_razon_social LIKE ?', [`${prefix}%`])
  }
})

test('S7-346-R01: una respuesta de escritura perdida conserva el borrador de otro cliente', async ({
  page,
  session,
}) => {
  const prefix = `r01-${randomUUID().slice(0, 8)}`
  const { connection } = session
  const clientA = `${prefix} Cliente A`
  const clientB = `${prefix} Cliente B`
  const listName = `${prefix} Lista Y`
  let clientAId = 0
  let clientBId = 0

  try {
    const list = await connection.query<{ insertId: bigint }>(`INSERT INTO LISTA_PRECIO
      (nombre, porcentaje_descuento, activa)
      VALUES (?, 15.00, 1)`, [listName])
    const targetListId = Number(list.insertId)

    const insertClient = async (name: string) => {
      const email = `${name.replaceAll(' ', '-')}@example.test`
      const result = await connection.query<{ insertId: bigint }>(`INSERT INTO CLIENTE
        (tipo_cliente, nombre_razon_social, email, es_fiel, activo, id_lista_precio)
        VALUES ('PARTICULAR', ?, ?, 0, 1, 1)`, [name, email])
      const id = Number(result.insertId)
      await connection.query(`INSERT INTO USUARIO
        (id_cliente, email, password_hash, rol, activo, fecha_creacion)
        VALUES (?, ?, 'fixture-no-login', 'CLIENTE', 1, '2035-03-01 00:00:00')`, [id, email])
      return id
    }
    clientAId = await insertClient(clientA)
    clientBId = await insertClient(clientB)

    await signIn(page)

    for (const width of [1280, 360]) {
      await page.setViewportSize({ width, height: 844 })
      await connection.query('UPDATE CLIENTE SET id_lista_precio = 1 WHERE id_cliente IN (?, ?)', [
        clientAId,
        clientBId,
      ])
      await page.goto(`/admin/clientes?busqueda=${encodeURIComponent(prefix)}&tipo=PARTICULAR`)

      const region = clientsRegion(page)
      await expect(region.locator('tbody tr')).toHaveCount(2)
      const rowA = region.getByRole('row').filter({ hasText: clientA })
      const rowB = region.getByRole('row').filter({ hasText: clientB })
      const selectA = rowA.getByRole('combobox')
      const selectB = rowB.getByRole('combobox')
      const targetOption = selectA.locator('option').filter({ hasText: listName })
      await expect(targetOption).toHaveCount(1)
      const targetValue = await targetOption.getAttribute('value')
      expect(targetValue).not.toBeNull()

      // A deja un borrador sin guardar y B guarda el suyo.
      await selectA.selectOption(targetValue!)
      await selectB.selectOption(targetValue!)

      const saveBPattern = new RegExp(`/api/admin/clientes/${clientBId}/lista-precio$`)
      await page.route(saveBPattern, async route => {
        if (route.request().method() !== 'PUT') return route.continue()
        await route.fetch()
        // El servidor confirmó la escritura, pero el navegador pierde la respuesta.
        await route.abort('failed')
      })

      try {
        await rowB.getByRole('button', { name: 'Guardar lista' }).click()
        await expect(rowB.getByRole('status')).toHaveText('Cambio confirmado con el servidor.')
      } finally {
        await page.unroute(saveBPattern)
      }

      await expect(selectB).toHaveValue(targetValue!)
      await expect(selectA).toHaveValue(targetValue!)
      await expect(rowA.getByRole('button', { name: 'Guardar lista' })).toBeEnabled()

      const url = new URL(page.url())
      expect(url.searchParams.get('busqueda')).toBe(prefix)
      expect(url.searchParams.get('tipo')).toBe('PARTICULAR')

      const assignments = await connection.query<Array<{ id_cliente: number; id_lista_precio: number }>>(
        'SELECT id_cliente, id_lista_precio FROM CLIENTE WHERE id_cliente IN (?, ?) ORDER BY id_cliente',
        [clientAId, clientBId],
      )
      expect(assignments).toEqual([
        { id_cliente: clientAId, id_lista_precio: 1 },
        { id_cliente: clientBId, id_lista_precio: targetListId },
      ])
    }
  } finally {
    await connection.query('DELETE FROM USUARIO WHERE email LIKE ?', [`${prefix}%`])
    await connection.query('DELETE FROM CLIENTE WHERE nombre_razon_social LIKE ?', [`${prefix}%`])
    await connection.query('DELETE FROM LISTA_PRECIO WHERE nombre = ?', [listName])
  }
})

test('una respuesta tardía no reemplaza la búsqueda vigente y los errores se reintentan', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/admin/clientes')

  const search = page.getByRole('searchbox', { name: 'Buscar clientes' })
  const summary = page.locator('#clients-summary')
  const region = clientsRegion(page)
  const release = Promise.withResolvers<void>()

  await page.route(/\/api\/admin\/clientes\?/, async route => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('busqueda') === 'Cliente E2E') {
      await release.promise
    }
    try {
      await route.continue()
    } catch {
      // La búsqueda anterior puede haber sido cancelada por la nueva.
    }
  })

  const firstRequest = page.waitForRequest(request => {
    const url = new URL(request.url())
    return url.pathname === '/api/admin/clientes'
      && url.searchParams.get('busqueda') === 'Cliente E2E'
  })
  await search.fill('Cliente E2E')
  await firstRequest
  await search.fill('Empresa E2E aprobada')
  await expect(region.getByRole('row', { name: /Empresa E2E aprobada/ })).toBeVisible()
  await expect(summary).toContainText('de 1 clientes')

  release.resolve()
  await page.waitForTimeout(150)
  await expect(region.getByRole('row', { name: /Empresa E2E aprobada/ })).toBeVisible()

  await page.unroute(/\/api\/admin\/clientes\?/)
  await page.route(/\/api\/admin\/clientes\?/, route =>
    route.fulfill({ status: 500, json: { message: 'Listado temporalmente inaccesible.' } }), { times: 1 })
  await search.fill('Filtro con error 346')
  await expect(page.getByRole('alert')).toContainText('Listado temporalmente inaccesible.')
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No se encontraron clientes' })).toBeVisible()
  await expect(region).toHaveCount(0)
})
