import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Locator, type Page, type WebSocketRoute } from '@playwright/test'

const require = createRequire(import.meta.url)
const { categoriasRequeridas, csv, familias, generar } = require('../../../data/demo-catalog/generar.cjs')
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs')
const { credentials } = require('../../../backend/test/helpers/e2e-fixtures.cjs')
const { parse } = require('../../../backend/node_modules/papaparse')
const importar = '/api/admin/productos/importar'
const pedidos = '/api/pedidos/cuenta-corriente'

type Categoria = { id: number; nombre: string }
type Fila = {
  codigo: string; nombre: string; descripcion: string; imagen: string; id_categoria: number;
  precio_base_usd: string; descuento_especial_pct: string; stock: number
}
type Producto = Fila & { id: number; descuento: string | null; precio: string; activo: number; categoriaActiva: number }

async function respuesta(response: APIResponse, status = 200) {
  expect(response.status(), new URL(response.url()).pathname).toBe(status)
  return response.json()
}

function preview(admin: APIRequestContext, archivo: string) {
  return admin.post(`${importar}/previsualizar`, {
    multipart: { file: { name: 'demo-286.csv', mimeType: 'text/csv', buffer: Buffer.from(archivo) } },
  }).then(response => respuesta(response))
}

async function confirmar(admin: APIRequestContext, previewToken: string) {
  const statusPath = `${importar}/confirmaciones/${previewToken}`
  // Si se pierde la respuesta o queda incierta, solo se consulta el mismo token.
  const initial = await admin.post(`${importar}/confirmar`, { data: { previewToken } }).catch(() => undefined)
  if (initial) expect([200, 202]).toContain(initial.status())
  let report
  await expect.poll(async () => {
    report = await respuesta(await admin.get(statusPath))
    return report.estado
  }, { timeout: 30_000 }).toBe('completado')
  return report!
}

const centavos = (valor: string) => Number(valor.replace('.', ''))

async function verificarImagen(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  await expect(locator).toBeVisible()
  expect(await locator.evaluate(async element => {
    const imagen = element as unknown as { decode(): Promise<void>; naturalWidth: number }
    await imagen.decode()
    return imagen.naturalWidth
  })).toBeGreaterThan(0)
}

async function compraEnNavegador(page: Page, browser: Browser, origen: string, producto: Producto,
  actualizar: (stock: number) => Promise<unknown>) {
  const otro = await browser.browserType().launch()
  const detalle = `/api/catalogo/${producto.id}`
  let disponible = true
  let conexiones = 0
  let socket: WebSocketRoute | undefined
  let eventosStock = 0
  let eventosPedido = 0
  const rutaSocket = '**/socket.io/**'
  try {
    const otraSesion = await otro.newContext({ baseURL: origen, extraHTTPHeaders: { Origin: origen } })
    await respuesta(await otraSesion.request.post('/api/auth/login', { data: credentials.account }))
    const observador = await otraSesion.newPage()
    await respuesta(await page.request.post('/api/auth/login', { data: credentials.account, headers: { Origin: origen } }))
    await observador.route(rutaSocket, route => disponible ? route.continue() : route.abort())
    await observador.routeWebSocket(rutaSocket, ws => {
      if (!disponible) return ws.close()
      const server = ws.connectToServer()
      ws.onMessage(message => {
        if (message === '5') {
          socket = ws
          conexiones++
        }
        server.send(message)
      })
      server.onMessage(message => {
        if (typeof message === 'string' && message.startsWith('42')) {
          const [evento, payload] = JSON.parse(message.slice(2))
          if (evento === 'stock.actualizado.v1' && payload.productosIds.includes(producto.id)) eventosStock++
          if (evento === 'pedido.confirmado.v1') eventosPedido++
        }
        ws.send(message)
      })
    })
    await observador.goto(`/producto/${producto.id}`)
    const mostrar = (stock: number) => expect(observador.getByText(`${stock} unidades disponibles`)).toBeVisible()
    const refresco = () => observador.waitForResponse(response =>
      new URL(response.url()).pathname === detalle && response.status() === 200)
    await mostrar(producto.stock)
    await expect.poll(() => conexiones).toBe(1)
    await page.goto(`/producto/${producto.id}`)
    await expect(page.getByText(/Precio simulado académico/)).toBeVisible()
    const agregado = page.waitForResponse(response => new URL(response.url()).pathname === '/api/carrito/items' &&
      response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Agregar', exact: true }).click()
    expect((await agregado).status()).toBe(204)
    await page.goto('/carrito')
    await expect(page.getByText(/Pedido simulado académico/)).toBeVisible()
    await page.getByRole('radio', { name: 'Cuenta corriente' }).check()
    const cambio = refresco()
    const confirmada = page.waitForResponse(response => new URL(response.url()).pathname === pedidos &&
      response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Confirmar pedido a cuenta corriente' }).click()
    const response = await confirmada
    expect(response.status()).toBe(201)
    const compra = await response.json()
    const clave = (await response.request().allHeaders())['idempotency-key']!
    const solicitud = response.request().postDataJSON()
    await expect(page.getByRole('list', { name: 'Comprobantes de pedidos confirmados' })).toContainText('Pedido simulado')
    expect((await (await cambio).json()).data.producto.stock).toBe(producto.stock - 1)
    await mostrar(producto.stock - 1)
    expect(eventosStock).toBeGreaterThan(0)
    await expect.poll(() => eventosPedido).toBe(1)

    disponible = false
    await socket!.close({ code: 1011 })
    await actualizar(producto.stock - 2)
    await mostrar(producto.stock - 1)
    const recuperacion = refresco()
    disponible = true
    await expect.poll(() => conexiones, { timeout: 15_000 }).toBeGreaterThan(1)
    expect((await (await recuperacion).json()).data.producto.stock).toBe(producto.stock - 2)
    await mostrar(producto.stock - 2)
    await actualizar(producto.stock - 1)
    await mostrar(producto.stock - 1)
    return { compra, clave, solicitud, socket: { sku: producto.codigo, navegadores: 2, origenCambio: 'compra confirmada',
      eventos: ['stock.actualizado.v1', 'pedido.confirmado.v1'], refrescoRest: true, reconexion: true,
      stockInicial: producto.stock, stockPostCompra: producto.stock - 1, pruebaReconectarConCambioAdmin: true } }
  } finally {
    await otro.close()
  }
}

async function auditarPrecios(api: APIRequestContext, path: string, filas: Producto[], lista: number, sintetico: boolean) {
  let cotizables = 0
  let lotes = 0
  let comprablesAcademico = 0
  for (let i = 0; i < filas.length; i += 100) {
    const lote = filas.slice(i, i + 100)
    const { data } = await respuesta(await api.post(path, {
      data: { moneda: 'USD', productos: lote.map(({ id }) => ({ productoId: id, cantidad: 2 })) },
    }))
    lotes++
    expect(data.productos).toHaveLength(lote.length)
    expect(data.datosSinteticos).toBe(sintetico)
    let total = 0
    for (const [index, producto] of lote.entries()) {
      const line = data.productos[index]
      expect(line.productoId).toBe(producto.id)
      if (!sintetico) {
        expect(line).toMatchObject({ estadoPrecio: 'BASE_NO_VERIFICADA', precioComprable: false })
        continue
      }
      const especial = Number(producto.descuento ?? 0)
      const descuento = Math.max(especial, lista)
      const unitario = Math.round(centavos(producto.precio) * (100 - descuento) / 100)
      expect(line).toMatchObject({
        estadoPrecio: 'DEFINIDO', precioComprable: true, precioBaseUSD: producto.precio,
        evidenciaBaseUSD: { synthetic: true }, descuentoAplicado: descuento.toFixed(2),
        precioUnitarioUSD: (unitario / 100).toFixed(2), subtotalUSD: (unitario * 2 / 100).toFixed(2),
      })
      if (path.endsWith('/mios')) {
        expect(line.compraAcademica).toBe(true)
        comprablesAcademico++
      } else expect(line.compraAcademica).toBeUndefined()
      total += unitario * 2
      cotizables++
    }
    expect(data.totalUSD).toBe(sintetico ? (total / 100).toFixed(2) : null)
  }
  return { lotes, verificados: filas.length, cotizables, comprablesAcademico }
}

test('FER-16 carga el catálogo académico y FER-17 conserva sus límites comerciales', async ({ page, baseURL, browser, playwright }, testInfo) => {
  test.setTimeout(120_000)
  expect(process.env.E2E_DEMO_CATALOG).toBe('1')
  const session = await connectOwned(JSON.parse(process.env.CCE2E_TEST_PROFILE!), 'E2E')
  const db = session.connection
  const config = { baseURL, extraHTTPHeaders: { Origin: baseURL! } }
  const publico = await playwright.request.newContext(config)
  const admin = await playwright.request.newContext(config)
  const empresa = await playwright.request.newContext(config)

  const reporte = (nombre: string, value: unknown) => writeFile(testInfo.outputPath(nombre), JSON.stringify(value, null, 2) + '\n')
  try {
    const [inicial] = await db.query('SELECT COUNT(*) AS total FROM PRODUCTO')
    expect(Number(inicial.total)).toBe(0)
    expect((await respuesta(await publico.get('/api/catalogo'))).data.pagination.total).toBe(0)
    await respuesta(await admin.post('/api/auth/login', { data: credentials.admin }))
    await respuesta(await empresa.post('/api/auth/login', { data: credentials.account }))
    const categorias = async (): Promise<Categoria[]> =>
      (await respuesta(await publico.get('/api/categorias'))).data.categorias
    const previas = await categorias()
    for (const nombre of categoriasRequeridas.filter((nombre: string) => !previas.some(c => c.nombre === nombre))) {
      await respuesta(await admin.post('/api/admin/categorias', { data: { nombre } }), 201)
    }
    const activas = await categorias()
    const usadas = activas.filter(c => categoriasRequeridas.includes(c.nombre))
    const filas: Fila[] = generar(activas)
    const archivo = csv(filas)
    const plantilla = csv(generar(activas))
    const hash = createHash('sha256').update(plantilla).digest('hex')
    await reporte('categorias-e2e.json', { data: { categorias: activas } })
    await writeFile(testInfo.outputPath('productos-ferrepatagonia-demo.csv'), plantilla)
    const lote = await preview(admin, archivo)
    expect(lote).toMatchObject({ version: 'FER16-v2', totalRows: filas.length,
      validRowsCount: filas.length, invalidRowsCount: 0, existingInDbCount: 0, duplicateInFileCount: 0, errors: [] })
    expect(Number((await db.query('SELECT COUNT(*) AS total FROM PRODUCTO'))[0].total)).toBe(0)
    const resultado = await confirmar(admin, lote.previewToken)
    expect(resultado).toMatchObject({ importados: filas.length, totalProcesados: filas.length,
      rechazados: 0, omitidos: 0, pendientes: 0 })
    const repetido = await respuesta(await admin.post(`${importar}/confirmar`, { data: { previewToken: lote.previewToken } }))
    expect(repetido).toEqual(resultado)
    const segundoLote = await preview(admin, archivo)
    expect(segundoLote).toMatchObject({ existingInDbCount: filas.length, validRowsCount: 0 })
    const segundaConfirmacion = await admin.post(`${importar}/confirmar`, { data: { previewToken: segundoLote.previewToken } })
    expect(await respuesta(segundaConfirmacion, 400)).toMatchObject({ message: expect.stringContaining('no contiene filas elegibles') })
    await reporte('import-report.json', {
      entorno: 'MariaDB 11.4 descartable E2E', fer: lote.version, iniciales: 0, previsualizados: lote.totalRows,
      validos: lote.validRowsCount, errores: lote.errors, importados: resultado.importados,
      rechazados: resultado.rechazados, omitidos: resultado.omitidos, pendientes: resultado.pendientes,
      mismoTokenMismoReporte: true,
      reimportacion: { importados: 0, yaExistentesEnPreview: segundoLote.existingInDbCount, confirmacionHttp: 400 },
      sha256CsvSinOrigen: hash,
    })

    const dbFilas: Producto[] = await db.query(`
      SELECT p.id_producto AS id, p.codigo, p.nombre, p.id_categoria, p.descripcion,
             p.imagen, p.precio, p.stock, p.descuento_especial_pct AS descuento,
             p.activo, c.activo AS categoriaActiva
      FROM PRODUCTO p JOIN CATEGORIA c USING (id_categoria) ORDER BY p.id_producto
    `)
    expect(dbFilas).toHaveLength(filas.length)
    const bySku = new Map(filas.map(fila => [fila.codigo, fila]))
    for (const { codigo, ...producto } of dbFilas) {
      const fila = bySku.get(codigo)!
      expect(producto).toMatchObject({ nombre: fila.nombre, id_categoria: fila.id_categoria,
        descripcion: fila.descripcion, imagen: fila.imagen || null, precio: fila.precio_base_usd,
        stock: fila.stock, activo: 1, categoriaActiva: 1, descuento: fila.descuento_especial_pct || null })
    }
    const fotos = parse(await readFile(new URL('../../../data/demo-catalog/image-sources.csv', import.meta.url), 'utf8'),
      { header: true, skipEmptyLines: true })
    expect(fotos.errors).toEqual([])
    const fuentes = new Map<string, string>(fotos.data.map((fila: { sku: string; ruta_final: string }) => [fila.sku, fila.ruta_final]))
    expect(fuentes.size).toBe(fotos.data.length)
    for (const [sku, ruta] of fuentes) {
      const producto = dbFilas.find(p => p.codigo === sku)!
      expect(producto).toBeDefined()
      expect(ruta).toMatch(/^\/demo-catalog\/[a-z0-9-]+\.webp$/)
      const bytes = await readFile(new URL(`../../public${ruta}`, import.meta.url))
      const actual = await respuesta(await admin.put(`/api/admin/productos/${producto.id}/con-imagen`, {
        multipart: { producto: '{}', imagen: { name: ruta.split('/').at(-1)!, mimeType: 'image/webp', buffer: bytes } },
      }))
      expect(actual.imagen).toMatch(/^\/api\/product-images\/[a-f0-9-]+\.webp$/)
      expect(actual).toMatchObject({ codigo: sku, stock: producto.stock })
      producto.imagen = actual.imagen
    }

    const catalogo = async (params: Record<string, string>) =>
      (await respuesta(await publico.get('/api/catalogo', { params }))).data
    const ids: number[] = []
    const paginas = Math.ceil(filas.length / 100)
    for (let n = 1; n <= paginas; n++) {
      const data = await catalogo({ page: String(n), limit: '100' })
      expect(data.pagination).toMatchObject({ total: filas.length, totalPages: paginas, hasNext: n < paginas })
      ids.push(...data.productos.map(({ id, disponible, imagen }: { id: number; disponible: boolean; imagen: string | null }) => {
        expect(disponible).toBe(true)
        expect(imagen ?? null).toBe(dbFilas.find(p => p.id === id)!.imagen)
        return id
      }))
    }
    expect(ids).toEqual(dbFilas.map(({ id }) => id))
    expect((await catalogo({ page: String(paginas + 1), limit: '100' })).productos).toEqual([])
    for (const { id } of usadas) {
      const data = await catalogo({ categoria: String(id), limit: '100' })
      expect(data.pagination.total).toBe(dbFilas.filter(p => p.id_categoria === id).length)
      expect(data.productos.every((p: { categoria: Categoria }) => p.categoria.id === id)).toBe(true)
    }
    for (const [familia] of familias) {
      const producto = dbFilas.find(p => p.codigo.startsWith(`FP-DEMO-${familia}-`))!
      for (const busqueda of [producto.codigo, producto.nombre]) {
        expect((await catalogo({ busqueda })).productos.map((p: { id: number }) => p.id)).toContain(producto.id)
      }
      const { data } = await respuesta(await publico.get(`/api/catalogo/${producto.id}`))
      expect(data.producto).toMatchObject({ codigo: producto.codigo, descripcion: producto.descripcion, stock: producto.stock })
    }

    const sinEvidencia = await auditarPrecios(publico, '/api/precios', dbFilas, 0, false)
    // Evidencia de prueba únicamente en la MariaDB descartable que acredita connectOwned.
    // El cotejo previo garantiza que el importe persistido coincide con el CSV revisado.
    const evidencia = await db.query(`
      INSERT INTO PRECIO_USD_EVIDENCIA
        (id_producto, precio_verificado, evidencia, id_admin, verificado_utc, valida, sintetica)
      SELECT id_producto, precio, ?, 1, UTC_TIMESTAMP(3), 1, 1 FROM PRODUCTO WHERE codigo LIKE 'FP-DEMO-%'
    `, [`SINTETICO ACADEMICO #286 SHA256:${hash}`])
    expect(evidencia.affectedRows).toBe(filas.length)
    const publicoUSD = await auditarPrecios(publico, '/api/precios', dbFilas, 0, true)
    const empresaUSD = await auditarPrecios(empresa, '/api/precios/mios', dbFilas, 10, true)
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')
    const imagenes = []
    for (const producto of dbFilas.filter(p => p.imagen)) {
      const recurso = await publico.get(producto.imagen)
      expect(recurso.status()).toBe(200)
      expect(recurso.headers()['content-type']).toBe('image/webp')
      if (dbFilas.slice(0, 4).includes(producto)) await verificarImagen(page.getByRole('img', { name: producto.nombre, exact: true }))
      imagenes.push({ sku: producto.codigo, ruta: producto.imagen, archivo: fuentes.get(producto.codigo),
        http: 200, mime: 'image/webp' })
    }
    for (const producto of dbFilas.filter(p => p.imagen)) {
      await page.goto(`/catalogo?busqueda=${encodeURIComponent(producto.codigo)}&categoria=${producto.id_categoria}`)
      await expect(page.getByRole('form', { name: 'Buscar y filtrar productos' })).toBeVisible()
      const enlace = page.getByRole('link', { name: producto.nombre, exact: true })
      await expect(enlace).toBeVisible()
      await verificarImagen(page.getByRole('img', { name: producto.nombre, exact: true }))
      await enlace.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: producto.nombre, level: 1, exact: true })).toBeVisible()
      await verificarImagen(page.getByRole('img', { name: producto.nombre, exact: true }))
      expect(await page.locator('html').evaluate(element =>
        (element as unknown as { scrollWidth: number }).scrollWidth)).toBeLessThanOrEqual(360)
    }
    const principal = dbFilas[0]!
    const seleccion = [principal, ...usadas.filter(c => c.id !== principal.id_categoria).slice(0, 4)
      .map(c => dbFilas.find(p => p.id_categoria === c.id)!)]
    const stock = async (producto: Producto) => Number((await db.query('SELECT stock FROM PRODUCTO WHERE id_producto = ?', [producto.id]))[0].stock)
    const setStock = (producto: Producto, cantidad: number) => admin.patch(`/api/admin/productos/${producto.id}/stock`,
      { data: { stock: cantidad } }).then(response => respuesta(response))
    const agregar = (producto: Producto, cantidad: number) => empresa.post('/api/carrito/items', { data: { productoId: producto.id, cantidad } })
    const elegibilidad = async () => (await respuesta(await empresa.get(`${pedidos}/eligibilidad`))).data
    const confirmarPedido = (clave: string, data: { cotizacion: string }) =>
      empresa.post(pedidos, { headers: { 'Idempotency-Key': clave }, data })

    // Cae el stock después de emitir una cotización auténtica. La confirmación tampoco puede sobrevender.
    expect((await agregar(principal, 2)).status()).toBe(204)
    const [cuenta] = await db.query(`SELECT cc.id_cuenta_corriente AS id, cc.limite_credito AS limite
      FROM CUENTA_CORRIENTE cc JOIN CLIENTE c USING (id_cliente) WHERE c.email = ?`, [credentials.account.email])
    expect(cuenta).toBeDefined()
    await db.query('UPDATE CUENTA_CORRIENTE SET origen_datos = ? WHERE id_cuenta_corriente = ?', ['REAL', cuenta.id])
    expect(await elegibilidad()).toMatchObject({ elegible: false, codigo: 'CUENTA_ACADEMICA_REQUERIDA', cotizacion: null })
    await db.query('UPDATE CUENTA_CORRIENTE SET origen_datos = ?, limite_credito = ? WHERE id_cuenta_corriente = ?', ['DEMO', '1.00', cuenta.id])
    expect(await elegibilidad()).toMatchObject({ elegible: false, codigo: 'CREDITO_INSUFICIENTE', simulado: true })
    await db.query('UPDATE CUENTA_CORRIENTE SET limite_credito = ? WHERE id_cuenta_corriente = ?', [cuenta.limite, cuenta.id])
    const antes = await elegibilidad()
    expect(antes).toMatchObject({ elegible: true, simulado: true })
    await setStock(principal, 1)
    const claveSobreventa = randomUUID()
    const sobreventa = await confirmarPedido(claveSobreventa, { cotizacion: antes.cotizacion })
    expect(await respuesta(sobreventa, 409)).toMatchObject({ code: 'STOCK_INSUFICIENTE' })
    expect(await stock(principal)).toBe(1)
    expect((await db.query('SELECT COUNT(*) AS total FROM PEDIDO'))[0].total.toString()).toBe('0')
    await setStock(principal, principal.stock)
    expect((await empresa.delete(`/api/carrito/items/${principal.id}`)).status()).toBe(204)

    const primera = await compraEnNavegador(page, browser, baseURL!, principal, cantidad => setStock(principal, cantidad))
    const compras = []
    for (const [indice, producto] of seleccion.entries()) {
      const cantidad = indice === 0 ? 1 : 2
      const unitario = Math.round(centavos(producto.precio) * (100 - Math.max(10, Number(producto.descuento ?? 0))) / 100)
      const totalUSD = (unitario * cantidad / 100).toFixed(2)
      const exceso = await agregar(producto, producto.stock + 1)
      expect(await respuesta(exceso, 422)).toMatchObject({ code: 'STOCK_INSUFICIENTE' })
      let clave = primera.clave
      let solicitud = primera.solicitud
      let compra = primera.compra
      if (indice > 0) {
        expect((await agregar(producto, cantidad)).status()).toBe(204)
        const carrito = await respuesta(await empresa.get('/api/carrito'))
        expect(carrito.items).toEqual([expect.objectContaining({ id_producto: producto.id, cantidad,
          precio: expect.objectContaining({ datosSinteticos: true, compraAcademica: true }) })])
        const elegible = await elegibilidad()
        expect(elegible).toMatchObject({ elegible: true, simulado: true, totalUSD })
        clave = randomUUID()
        solicitud = { cotizacion: elegible.cotizacion }
        compra = await respuesta(await confirmarPedido(clave, solicitud), 201)
      }
      expect(compra.data).toMatchObject({ estado: 'CONFIRMADO', modalidadPago: 'CUENTA_CORRIENTE', simulado: true, totalUSD })
      expect(await respuesta(await confirmarPedido(clave, solicitud))).toEqual(compra)
      expect(await respuesta(await empresa.get(`${pedidos}/${clave}`))).toEqual(compra)
      expect((await respuesta(await empresa.get('/api/carrito'))).items).toEqual([])
      expect(await stock(producto)).toBe(producto.stock - cantidad)
      const { pedidoId, cargoId } = compra.data
      const [ledger] = await db.query(`SELECT p.total, p.evidencia_total_usd AS evidencia, p.observaciones AS pedidoNota,
        m.id_movimiento_cuenta AS cargo, m.observaciones AS cargoNota, m.monto, c.origen_datos AS origen,
        d.cantidad, j.snapshot_json AS snapshot
        FROM PEDIDO p JOIN MOVIMIENTO_CUENTA_CORRIENTE m ON m.id_pedido = p.id_pedido AND m.tipo_movimiento = 'CARGO'
        JOIN CUENTA_CORRIENTE c USING (id_cuenta_corriente)
        JOIN DETALLE_PEDIDO d ON d.id_pedido = p.id_pedido
        JOIN DETALLE_PEDIDO_CC_PRECIO j USING (id_detalle_pedido) WHERE p.id_pedido = ?`, [pedidoId])
      expect(ledger).toMatchObject({ total: totalUSD, monto: totalUSD, origen: 'DEMO', cantidad,
        pedidoNota: 'Pedido simulado académico #286', cargoNota: 'Pedido simulado académico #286' })
      expect(ledger.evidencia).toMatch(/^FER17-v1:ACADEMICO:SHA256:[a-f0-9]{64}$/)
      expect(String(ledger.cargo)).toBe(cargoId)
      expect(JSON.parse(ledger.snapshot)).toMatchObject({ simulado: true,
        producto: { productoId: producto.id, evidenciaBaseUSD: { synthetic: true } } })
      expect((await respuesta(await empresa.get(`/api/pedidos/${pedidoId}`))).data).toMatchObject({ pedidoId, totalUSD, simulado: true })
      expect((await respuesta(await admin.get(`/api/admin/pedidos/${pedidoId}`))).data).toMatchObject({ idPedido: pedidoId, origen: 'DEMO', estadosPermitidos: [] })
      compras.push({ sku: producto.codigo, categoria: usadas.find(c => c.id === producto.id_categoria)!.nombre,
        pedidoId, cargoId, cantidad, stockInicial: producto.stock, stockFinal: producto.stock - cantidad,
        totalUSD, confirmacion: indice === 0 ? 'interfaz' : 'API', idempotencia: true })
    }
    expect((await respuesta(await empresa.get('/api/pedidos'))).data.items).toHaveLength(5)
    expect((await respuesta(await admin.get('/api/admin/pedidos'))).data.items).toHaveLength(5)
    const [efectos] = await db.query(`SELECT (SELECT COUNT(*) FROM PEDIDO) AS pedidos,
      (SELECT COUNT(*) FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE tipo_movimiento = 'CARGO') AS cargos,
      (SELECT COUNT(*) FROM PAGO) AS pagos`)
    expect([Number(efectos.pedidos), Number(efectos.cargos), Number(efectos.pagos)]).toEqual([5, 5, 0])
    const [final] = await db.query('SELECT SUM(stock) AS unidades FROM PRODUCTO')
    const unidadesDescontadas = dbFilas.reduce((total, p) => total + p.stock, 0) - Number(final.unidades)
    expect(unidadesDescontadas).toBe(9)
    await reporte('pricing-report.json', { moneda: 'USD', sinEvidencia, publicoUSD, empresaUSD,
      descuentoListaEmpresaPct: 10, evidenciaSintetica: true, compras, pedidosSimulados: 5, cargosSimulados: 5,
      pagos: 0, cuentaRealRechazada: true, creditoInsuficienteRechazado: true,
      sobreventa: { carrito: 422, confirmacion: 409 }, unidadesDescontadas })
    await reporte('catalog-validation.json', {
      generados: filas.length, validados: dbFilas.length, activosYVisibles: ids.length, paginas,
      categorias: usadas, familias: familias.length, detalleBusquedaVerificadosPorFamilia: familias.length,
      imagenes, conImagenVerificada: imagenes.length, pendientesDeImagen: filas.length - imagenes.length,
      vistasConFotoVerificada: ['Home', 'catálogo', 'detalle'], fotosVerificadasEnHome: 4,
      anchoMovilPx: 360, socket: primera.socket,
    })
  } finally {
    await Promise.all([publico.dispose(), admin.dispose(), empresa.dispose(), db.end()])
  }
})
