import { expect, test, type Page, type Route } from '@playwright/test'

const user = {
    id: 5,
    nombre: 'Empresa de prueba',
    email: 'empresa@example.test',
    rol: 'CLIENTE',
    tipo_cliente: 'EMPRESA',
    estadoAprobacionEmpresa: 'APROBADA',
    cuentaCorrienteHabilitada: true,
}

function summary(overrides: Record<string, unknown> = {}) {
    return {
        corte: '2026-11-20T12:00:00.000Z',
        revision: 'rev-7',
        estado: 'HABILITADA',
        cuentaId: 1,
        origen: 'REAL',
        moneda: 'USD',
        plazoDias: 30,
        saldo: '100.00',
        limite: '500.00',
        utilizado: '100.00',
        disponible: '400.00',
        deudaVencidaTotal: '0.00',
        deudaVencida30Dias: '0.00',
        deudaVencida60Dias: '0.00',
        deudaPorVencerTotal: '100.00',
        cobertura: 'COMPLETA',
        estadoCredito: 'DISPONIBLE',
        ...overrides,
    }
}

function pageData(items: unknown[] = [], overrides: Record<string, unknown> = {}) {
    return {
        corte: '2026-11-20T12:00:00.000Z',
        revision: 'rev-7',
        estado: 'HABILITADA',
        cobertura: 'COMPLETA',
        items,
        siguienteCursor: null,
        ...overrides,
    }
}

const movement = {
    id: '1',
    fechaOperacion: '2026-11-20T10:00:00.000Z',
    concepto: 'Pedido #2',
    importe: '100.00',
    saldoResultante: '100.00',
    moneda: 'USD',
    tipo: 'CARGO',
    estado: 'VIGENTE',
    venceEl: '2026-12-20',
    plazoDias: 30,
    origen: 'REAL',
    referencia: { pedidoId: 2 },
}

const receipt = {
    id: '00000000-0000-4000-8000-000000000001',
    pedidoId: null,
    cuentaCorrienteId: 1,
    tipoMime: 'image/png',
    bytes: 128,
    fecha: '2026-11-20T11:00:00.000Z',
    estadoRevision: 'PENDIENTE',
    revisadoEn: null,
}

function payment(overrides: Record<string, unknown> = {}) {
    return {
        id: 10,
        cuentaCorrienteId: 1,
        comprobanteId: receipt.id,
        comprobanteTipoMime: 'image/png',
        comprobanteBytes: 128,
        comprobanteRevisadoEn: null,
        pedidoId: null,
        monto: '50.00',
        montoUsd: null,
        moneda: 'USD',
        observaciones: null,
        estado: 'PENDIENTE',
        estadoDocumental: 'PENDIENTE',
        motivoRevision: null,
        evidenciaAcreditacion: null,
        fecha: '2026-11-20T11:30:00.000Z',
        revisadoEn: null,
        acreditadoEn: null,
        movimientoId: null,
        movimientoEstado: null,
        movimientoMonto: null,
        ...overrides,
    }
}

type Overrides = {
    summary?: Record<string, unknown>
    movements?: Record<string, unknown>
    dues?: Record<string, unknown>
    receipts?: Record<string, unknown>
    payments?: Record<string, unknown>
    detail?: Record<string, unknown>
    onDeclare?: (route: Route, body: Record<string, unknown>, key: string) => Promise<void> | void
    onPaymentsGet?: (route: Route, page: number) => Promise<void> | void
    onReceiptsGet?: (route: Route) => Promise<void> | void
}

async function mockApi(page: Page, overrides: Overrides = {}) {
    let authenticated = false
    const currentSummary = summary(overrides.summary)
    const currentPayments = overrides.payments ?? { items: [], paginaSiguiente: null }
    const currentReceipts = overrides.receipts ?? { items: [receipt], paginaSiguiente: null }

    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url())
        const path = url.pathname
        const method = route.request().method()

        if (path === '/api/auth/login') {
            authenticated = true
            return route.fulfill({ json: { user } })
        }
        if (path === '/api/auth/me') {
            return authenticated
                ? route.fulfill({ json: { user } })
                : route.fulfill({ status: 401, json: { message: 'No autenticado.' } })
        }
        if (path === '/api/auth/logout') {
            authenticated = false
            return route.fulfill({ json: {} })
        }

        if (path === '/api/cuenta-corriente') {
            return route.fulfill({ json: { data: currentSummary } })
        }
        if (path === '/api/cuenta-corriente/movimientos') {
            return route.fulfill({ json: { data: overrides.movements ?? pageData([movement]) } })
        }
        if (path === '/api/cuenta-corriente/vencimientos') {
            return route.fulfill({ json: { data: overrides.dues ?? pageData([
                {
                    movimientoId: '1',
                    venceEl: '2026-12-20',
                    plazoDias: 30,
                    moneda: 'USD',
                    pendiente: '100.00',
                    estado: 'POR_VENCER',
                    origen: 'REAL',
                },
            ]) } })
        }
        if (path === '/api/cuenta-corriente/comprobantes' && method === 'GET') {
            if (overrides.onReceiptsGet) return overrides.onReceiptsGet(route)
            return route.fulfill({ json: { data: currentReceipts } })
        }
        if (path === '/api/cuenta-corriente/pagos' && method === 'GET') {
            if (overrides.onPaymentsGet) return overrides.onPaymentsGet(route, Number(url.searchParams.get('pagina') ?? 1))
            return route.fulfill({ json: { data: currentPayments } })
        }
        if (path === '/api/cuenta-corriente/pagos' && method === 'POST') {
            const body = route.request().postDataJSON() as Record<string, unknown>
            const key = route.request().headers()['idempotency-key'] ?? ''
            if (overrides.onDeclare) return overrides.onDeclare(route, body, key)
            const created = payment({
                id: 77,
                monto: body.monto,
                moneda: body.moneda,
                comprobanteId: body.comprobanteId,
                observaciones: body.observaciones ?? null,
            })
            return route.fulfill({ status: 201, json: { data: created } })
        }
        if (/^\/api\/cuenta-corriente\/pagos\/\d+$/.test(path)) {
            if (overrides.detail) return route.fulfill({ json: { data: overrides.detail } })
            return route.fulfill({ json: { data: payment() } })
        }

        if (path === '/api/pedidos') return route.fulfill({ json: { data: { items: [] } } })
        if (path === '/api/categorias') return route.fulfill({ json: { data: { categorias: [] } } })
        return route.fulfill({ json: { data: { items: [], paginaSiguiente: null } } })
    })
}

async function signIn(page: Page) {
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByLabel(/^Contraseña/).fill('clave')
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })
        .or(page.getByRole('button', { name: 'Menú de navegación de cuenta' }))).toBeVisible()
}

async function openAccount(page: Page) {
    await page.goto('/mi-cuenta/cuenta-corriente')
    await expect(page.getByRole('heading', { name: 'Cuenta corriente', exact: true })).toBeVisible()
}

function declaration(page: Page) {
    return page.getByRole('region', { name: 'Declarar un pago' })
}

async function fillDeclaration(page: Page, amount = '50.00', currency: 'USD' | 'ARS' = 'USD') {
    const form = declaration(page)
    await expect(form).toBeVisible()
    await form.getByRole('radio').first().check()
    await form.getByLabel('Importe declarado').fill(amount)
    await form.getByLabel('Moneda').selectOption(currency)
    await form.getByRole('button', { name: 'Revisar declaración' }).click()
    const dialog = page.getByRole('dialog', { name: 'Revisar declaración de pago' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox').check()
    return dialog
}

test('cuenta sin movimientos ni vencimientos muestra vacíos reales y totales en cero', async ({ page }) => {
    await mockApi(page, {
        movements: pageData([]),
        dues: pageData([], { cobertura: 'COMPLETA' }),
    })
    await signIn(page)
    await openAccount(page)

    await expect(page.getByText('No hay movimientos registrados en esta cuenta.')).toBeVisible()
    await expect(page.getByText('No hay vencimientos pendientes.')).toBeVisible()
    await expect(page.getByText('Total de cargos (USD)').locator('..')).toContainText('US$ 0,00')
    await expect(page.getByText('Total de abonos (USD)').locator('..')).toContainText('US$ 0,00')
})

test('cuenta inhabilitada se distingue de una cuenta habilitada', async ({ page }) => {
    await mockApi(page, {
        summary: {
            estado: 'INHABILITADA',
            estadoCredito: 'BLOQUEADO',
            disponible: '0.00',
        },
    })
    await signIn(page)
    await openAccount(page)

    await expect(page.getByRole('status').filter({
        hasText: 'La cuenta está inhabilitada.',
    })).toBeVisible()
    const accountStatus = page.getByRole('region', { name: 'Estado de la cuenta' })
    await expect(accountStatus.getByText('Habilitación').locator('..')).toContainText('Inhabilitada')
    await expect(page.getByText('Crédito disponible (USD)').locator('..')).toContainText('US$ 0,00')
})

test('cobertura parcial y crédito no determinable no se representan como cero', async ({ page }) => {
    await mockApi(page, {
        summary: {
            cobertura: 'PARCIAL',
            disponible: null,
            utilizado: null,
            estadoCredito: 'NO_DETERMINABLE',
        },
        movements: pageData([movement], { cobertura: 'PARCIAL' }),
        dues: pageData([], { cobertura: 'PARCIAL' }),
    })
    await signIn(page)
    await openAccount(page)

    await expect(page.getByText('Crédito disponible (USD)').locator('..')).toContainText('No determinable')
    await expect(page.getByText('Crédito utilizado (USD)').locator('..')).toContainText('No determinable')
    const accountStatus = page.getByRole('region', { name: 'Estado de la cuenta' })
    await expect(accountStatus.getByText(/La información es parcial/)).toBeVisible()
    await expect(accountStatus.getByText('Cobertura financiera').locator('..')).toContainText('Parcial')
    await expect(page.getByText('Los totales no se muestran')).toBeVisible()
})

test('SIN_CUENTA no muestra resumen ni acciones de pago', async ({ page }) => {
    await mockApi(page, {
        summary: { corte: '2026-11-20T12:00:00.000Z', revision: 'rev-0', estado: 'SIN_CUENTA' },
    })
    await signIn(page)
    await page.goto('/mi-cuenta/cuenta-corriente')

    await expect(page.getByRole('status').filter({
        hasText: 'No tenés una cuenta corriente asociada.',
    })).toBeVisible()
    await expect(declaration(page)).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Historial de pagos' })).toHaveCount(0)
})

test('historial muestra carga, error de red y reintento manual', async ({ page }) => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let attempts = 0
    await mockApi(page, {
        onPaymentsGet: async route => {
            attempts++
            if (attempts === 1) {
                await gate
                return route.fulfill({ status: 503, json: { message: 'Servicio no disponible.' } })
            }
            return route.fulfill({ json: { data: { items: [payment()], paginaSiguiente: null } } })
        },
    })
    await signIn(page)
    await openAccount(page)

    const history = page.getByRole('region', { name: 'Historial de pagos' })
    await expect(history.getByRole('status')).toContainText('Consultando tus pagos…')
    release()
    await expect(history.getByRole('alert')).toContainText('El servidor no pudo confirmar la operación')
    await history.getByRole('button', { name: 'Reintentar historial' }).click()
    await expect(history.getByText('Pago #10')).toBeVisible()
})

test('declaración USD: revisión explícita, contrato mínimo y bloqueo de doble envío', async ({ page }) => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    let submissions = 0
    let capturedBody: Record<string, unknown> | null = null
    let capturedKey = ''

    await mockApi(page, {
        onDeclare: async (route, body, key) => {
            submissions++
            capturedBody = body
            capturedKey = key
            await gate
            return route.fulfill({
                status: 201,
                json: { data: payment({ id: 77, monto: body.monto, moneda: body.moneda }) },
            })
        },
    })
    await signIn(page)
    await openAccount(page)
    const dialog = await fillDeclaration(page, '50.00', 'USD')

    const confirm = dialog.getByRole('button', { name: 'Confirmar declaración' })
    await confirm.evaluate(element => {
        element.click()
        element.click()
    })
    await expect(dialog.getByRole('button', { name: 'Declarando…' })).toBeDisabled()
    release()

    await expect(page.getByRole('status').filter({ hasText: 'Declaración registrada' })).toBeVisible()
    expect(submissions).toBe(1)
    expect(capturedKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(capturedBody).toEqual({
        monto: '50.00',
        moneda: 'USD',
        comprobanteId: receipt.id,
    })
    expect(capturedBody).not.toHaveProperty('clienteId')
    expect(capturedBody).not.toHaveProperty('cuentaCorrienteId')
    expect(capturedBody).not.toHaveProperty('montoUsd')
})

test('declaración ARS conserva moneda sin calcular un equivalente local', async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null
    await mockApi(page, {
        onDeclare: async (route, body) => {
            capturedBody = body
            const created = payment({ id: 88, monto: body.monto, moneda: 'ARS' })
            return route.fulfill({
                status: 201,
                json: { data: created },
            })
        },
        payments: { items: [payment({ id: 88, monto: '1000.00', moneda: 'ARS' })], paginaSiguiente: null },
    })
    await signIn(page)
    await openAccount(page)
    const dialog = await fillDeclaration(page, '1000.00', 'ARS')
    await dialog.getByRole('button', { name: 'Confirmar declaración' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Declaración registrada' })).toBeVisible()
    expect(capturedBody).toMatchObject({ monto: '1000.00', moneda: 'ARS' })
    const row = page.getByRole('region', { name: 'Historial de pagos' })
        .getByRole('listitem').filter({ hasText: 'Pago #88' })
    await expect(row).toContainText('ARS 1.000,00')
    await expect(row).toContainText('Se determina al acreditar con cotización verificada.')
})

test('comprobante inexistente o ajeno muestra error sin declaración exitosa', async ({ page }) => {
    await mockApi(page, {
        onDeclare: async route => route.fulfill({
            status: 404,
            json: { code: 'COMPROBANTE_NO_ENCONTRADO', message: 'No se encontró el comprobante indicado para esta cuenta.' },
        }),
    })
    await signIn(page)
    await openAccount(page)
    const dialog = await fillDeclaration(page)
    await dialog.getByRole('button', { name: 'Confirmar declaración' }).click()

    await expect(page.getByRole('alert').filter({ hasText: 'No encontramos ese comprobante entre los de tu cuenta.' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Declaración registrada' })).toHaveCount(0)
})

test('resultado incierto: consulta el estado y reintenta con la misma clave', async ({ page }) => {
    const keys: string[] = []
    let attempts = 0
    await mockApi(page, {
        onDeclare: async (route, body, key) => {
            keys.push(key)
            attempts++
            if (attempts === 1) {
                return route.fulfill({
                    status: 503,
                    json: { code: 'RESULTADO_DESCONOCIDO', message: 'No se pudo confirmar el resultado.' },
                })
            }
            return route.fulfill({
                status: 201,
                json: { data: payment({ id: 99, monto: body.monto }) },
            })
        },
        payments: { items: [], paginaSiguiente: null },
    })
    await signIn(page)
    await openAccount(page)
    const dialog = await fillDeclaration(page)
    await dialog.getByRole('button', { name: 'Confirmar declaración' }).click()

    await expect(dialog.getByRole('status').filter({ hasText: 'resultado de la declaración no está confirmado' })).toBeVisible()
    expect(keys).toHaveLength(1)

    await dialog.getByRole('button', { name: 'Consultar estado' }).click()
    await expect(page.getByText('No encontramos una declaración para ese comprobante.')).toBeVisible()

    await dialog.getByRole('button', { name: 'Reintentar con la misma clave' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Declaración registrada' })).toBeVisible()
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
})

test('revisión aprobada no equivale a acreditación y el pago acreditado muestra USD confirmado', async ({ page }) => {
    const approved = payment({
        id: 20,
        estadoDocumental: 'APROBADO',
        estado: 'PENDIENTE',
        revisadoEn: '2026-11-20T12:00:00.000Z',
    })
    const credited = payment({
        id: 21,
        estadoDocumental: 'APROBADO',
        estado: 'ACREDITADO',
        monto: '1000.00',
        moneda: 'ARS',
        montoUsd: '1.00',
        revisadoEn: '2026-11-20T12:00:00.000Z',
        acreditadoEn: '2026-11-20T12:30:00.000Z',
        evidenciaAcreditacion: 'Acreditación E2E',
    })
    const rejected = payment({
        id: 22,
        estado: 'RECHAZADO',
        estadoDocumental: 'RECHAZADO',
        motivoRevision: 'Comprobante ilegible.',
    })
    await mockApi(page, {
        payments: { items: [approved, credited, rejected], paginaSiguiente: null },
        detail: credited,
    })
    await signIn(page)
    await openAccount(page)
    const history = page.getByRole('region', { name: 'Historial de pagos' })

    const approvedRow = history.getByRole('listitem').filter({ hasText: 'Pago #20' })
    await expect(approvedRow.getByText('Documento aprobado', { exact: true })).toBeVisible()
    await expect(approvedRow.getByText('Pago pendiente de acreditación', { exact: true })).toBeVisible()
    await expect(approvedRow).toContainText('no acredita dinero')

    const creditedRow = history.getByRole('listitem').filter({ hasText: 'Pago #21' })
    await expect(creditedRow.getByText('Pago acreditado', { exact: true })).toBeVisible()
    await expect(creditedRow).toContainText('Importe USD acreditado')
    await expect(creditedRow).toContainText('US$ 1,00')

    const rejectedRow = history.getByRole('listitem').filter({ hasText: 'Pago #22' })
    await expect(rejectedRow.getByText('Pago rechazado', { exact: true })).toBeVisible()
    await expect(rejectedRow).toContainText('Comprobante ilegible.')

    await creditedRow.getByRole('button', { name: 'Ver detalle del pago 21' }).click()
    const detail = page.getByRole('dialog', { name: 'Detalle del pago #21' })
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('ARS 1.000,00')
    await expect(detail).toContainText('US$ 1,00')
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
})

test('logout durante una consulta no deja datos privados ni respuestas tardías', async ({ page }) => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    await mockApi(page, {
        onPaymentsGet: async route => {
            await gate
            return route.fulfill({ json: { data: { items: [payment()], paginaSiguiente: null } } })
        },
    })
    await signIn(page)
    await openAccount(page)
    await expect(page.getByRole('region', { name: 'Historial de pagos' })
        .getByRole('status')).toContainText('Consultando tus pagos…')

    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    release()
    await page.waitForTimeout(150)
    await expect(page.getByText('Pago #10')).toHaveCount(0)
    await expect(page.getByText('US$ 50,00')).toHaveCount(0)
})

for (const width of [320, 360, 390, 768, 1280]) {
    test(`declaración responsive y por teclado a ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 850 })
        await mockApi(page, {
            payments: { items: [payment()], paginaSiguiente: null },
        })
        await signIn(page)
        await openAccount(page)

        const form = declaration(page)
        await expect(form).toBeVisible()
        await form.getByRole('radio').first().check()
        await form.getByLabel('Importe declarado').fill('50.00')
        const opener = form.getByRole('button', { name: 'Revisar declaración' })
        await opener.focus()
        await page.keyboard.press('Enter')

        const dialog = page.getByRole('dialog', { name: 'Revisar declaración de pago' })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Cancelar revisión' })).toBeFocused()
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)

        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
        await expect(opener).toBeFocused()
        expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    })
}

test('historial paginado usa la página informada por el backend', async ({ page }) => {
    const requested: number[] = []
    await mockApi(page, {
        onPaymentsGet: async (route, current) => {
            requested.push(current)
            if (current === 1) {
                return route.fulfill({ json: { data: {
                    items: [payment({ id: 61 })], paginaSiguiente: 2,
                } } })
            }
            return route.fulfill({ json: { data: {
                items: [payment({ id: 62 })], paginaSiguiente: null,
            } } })
        },
    })
    await signIn(page)
    await openAccount(page)
    const history = page.getByRole('region', { name: 'Historial de pagos' })

    await expect(history.getByText('Pago #61')).toBeVisible()
    await history.getByRole('button', { name: 'Más pagos' }).click()
    await expect(history.getByText('Pago #62')).toBeVisible()
    await expect(history.getByText('Pago #61')).toHaveCount(0)
    await expect(history.getByText('Página 2')).toBeVisible()

    await history.getByRole('button', { name: 'Pagos anteriores' }).click()
    await expect(history.getByText('Pago #61')).toBeVisible()
    await expect(history.getByText('Pago #62')).toHaveCount(0)
    expect(requested).toEqual([1, 2, 1])
})
