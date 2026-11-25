import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)

type Connection = {
    query(sql: string, params?: unknown[]): Promise<unknown>
}

async function withDb<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
    expect(process.env.E2E_ISOLATED).toBe('1')
    expect(process.env.E2E_PAYMENTS).toBe('1')
    const { connectOwned, assertOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs')
    const session = await connectOwned(JSON.parse(process.env.CCE2E_TEST_PROFILE ?? 'null'), 'E2E')
    try {
        await assertOwned(session)
        return await work(session.connection)
    } finally {
        await session.connection.end()
    }
}

async function signIn(page: Page, email: string) {
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(email)
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!')
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
    const logout = page.getByRole('button', { name: 'Cerrar sesión', exact: true })
    const menu = page.getByRole('button', { name: 'Menú de navegación de cuenta' })
    await expect(logout.or(menu)).toBeVisible()
}

async function uniquePng(seed: number): Promise<Buffer> {
    const sharp = require('../../../backend/node_modules/sharp')
    return sharp({
        create: {
            width: 2,
            height: 2,
            channels: 3,
            background: { r: seed % 255, g: (seed * 37) % 255, b: (seed * 73) % 255 },
        },
    }).png().toBuffer()
}

async function uploadAccountReceipt(page: Page, seed: number): Promise<string> {
    const region = page.getByRole('region', { name: 'Comprobantes de pago' })
    await expect(region).toBeVisible()
    const image = await uniquePng(seed)
    await region.getByLabel(/Archivo \(PDF/).setInputFiles({
        name: `declaracion-${seed}.png`,
        mimeType: 'image/png',
        buffer: image,
    })
    const saved = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/cuenta-corriente/comprobantes' &&
        response.request().method() === 'POST',
    )
    await region.getByRole('button', { name: 'Adjuntar comprobante' }).click()
    const response = await saved
    expect(response.status()).toBe(201)
    const receiptId = (await response.json()).data.id
    await expect(region.getByText('Comprobante recibido. La acreditación del pago se gestiona por separado.')).toBeVisible()
    return receiptId
}

async function declarePayment(
    page: Page,
    receiptId: string,
    amount: string,
    currency: 'USD' | 'ARS',
): Promise<{ id: number; status: number; body: Record<string, unknown> }> {
    const declaration = page.getByRole('region', { name: 'Declarar un pago' })
    await expect(declaration).toBeVisible()
    const radio = declaration.locator(`input[name="payment-receipt"][value="${receiptId}"]`)
    await expect(radio).toBeVisible()
    await radio.check()
    await declaration.getByLabel('Importe declarado').fill(amount)
    await declaration.getByLabel('Moneda').selectOption(currency)
    await declaration.getByRole('button', { name: 'Revisar declaración' }).click()

    const dialog = page.getByRole('dialog', { name: 'Revisar declaración de pago' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(currency === 'USD' ? 'US$' : 'ARS')
    await dialog.getByRole('checkbox').check()
    const submitted = page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/cuenta-corriente/pagos' &&
        response.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'Confirmar declaración' }).click()
    const response = await submitted
    const body = await response.json()
    return { id: body.data.id, status: response.status(), body }
}

test('declarar no crea ABONO y el historial no confunde revisión con acreditación', async ({ page, browser }) => {
    test.setTimeout(60_000)
    await page.route('**/socket.io/**', route => route.abort())
    await signIn(page, 'empresa-cuenta@e2e.test')
    await page.goto('/mi-cuenta/cuenta-corriente')
    await expect(page.getByRole('heading', { name: 'Mi cuenta corriente', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Resumen financiero' })).toBeVisible()

    const before = (await (await page.request.get('/api/cuenta-corriente')).json()).data
    expect(before.origen).toBe('REAL')
    expect(before.saldo).toBe('84.00')

    const receiptId = await uploadAccountReceipt(page, 334)
    const declared = await declarePayment(page, receiptId, '10.00', 'USD')
    expect(declared.status).toBe(201)

    await expect(page.getByRole('status').filter({
        hasText: 'Declaración registrada. Queda pendiente de revisión y todavía no acredita dinero.',
    })).toBeVisible()

    const history = page.getByRole('region', { name: 'Historial de pagos' })
    const row = history.getByRole('listitem').filter({ hasText: `Pago #${declared.id}` })
    await expect(row).toBeVisible()
    await expect(row.getByText('Revisión documental pendiente', { exact: true })).toBeVisible()
    await expect(row.getByText('Pago pendiente de acreditación', { exact: true })).toBeVisible()
    await expect(row.getByText('Pago acreditado', { exact: true })).toHaveCount(0)

    const afterDeclaration = (await (await page.request.get('/api/cuenta-corriente')).json()).data
    expect({ saldo: afterDeclaration.saldo, revision: afterDeclaration.revision })
        .toEqual({ saldo: before.saldo, revision: before.revision })

    await withDb(async connection => {
        const [payment] = await connection.query(
            'SELECT estado, estado_documental, monto_usd FROM PAGO WHERE id_pago = ?',
            [declared.id],
        ) as Array<{ estado: string; estado_documental: string; monto_usd: string | null }>
        expect(payment).toMatchObject({ estado: 'PENDIENTE', estado_documental: 'PENDIENTE', monto_usd: null })
        const [movements] = await connection.query(
            'SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?',
            [declared.id],
        ) as Array<{ total: number }>
        expect(Number(movements.total)).toBe(0)
    })

    const admin = await browser.newPage()
    try {
        await signIn(admin, 'admin@e2e.test')
        const origin = new URL(admin.url()).origin
        const review = await admin.request.patch(`/api/admin/pagos/${declared.id}/revision`, {
            headers: { Origin: origin },
            data: { decision: 'APROBADO' },
        })
        expect(review.status()).toBe(200)

        await page.getByRole('button', { name: 'Actualizar historial' }).click()
        await expect(row.getByText('Documento aprobado', { exact: true })).toBeVisible()
        await expect(row.getByText('Pago pendiente de acreditación', { exact: true })).toBeVisible()
        await expect(row.getByText('Pago acreditado', { exact: true })).toHaveCount(0)
        await expect(row).toContainText('no acredita dinero')

        await withDb(async connection => {
            const [movements] = await connection.query(
                'SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?',
                [declared.id],
            ) as Array<{ total: number }>
            expect(Number(movements.total)).toBe(0)
        })

        const accreditation = await admin.request.post(`/api/admin/pagos/${declared.id}/acreditar`, {
            headers: { 'Idempotency-Key': randomUUID(), Origin: origin },
            data: { evidencia: 'E2E de acreditación #334' },
        })
        expect(accreditation.status()).toBe(200)
    } finally {
        await admin.close()
    }

    await page.getByRole('button', { name: 'Actualizar historial' }).click()
    await expect(row.getByText('Pago acreditado', { exact: true })).toBeVisible()
    await expect(row).toContainText('Importe USD acreditado')
    await expect(row).toContainText('US$ 10,00')

    await withDb(async connection => {
        const [payment] = await connection.query(
            'SELECT estado, monto_usd FROM PAGO WHERE id_pago = ?',
            [declared.id],
        ) as Array<{ estado: string; monto_usd: string }>
        expect(payment.estado).toBe('ACREDITADO')
        expect(payment.monto_usd).toBe('10.00')
        const [movement] = await connection.query(
            'SELECT tipo_movimiento, monto FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?',
            [declared.id],
        ) as Array<{ tipo_movimiento: string; monto: string }>
        expect(movement).toEqual({ tipo_movimiento: 'ABONO', monto: '10.00' })
    })
})

test('declaración ARS conserva la moneda y no inventa equivalente USD', async ({ page }) => {
    test.setTimeout(45_000)
    await page.route('**/socket.io/**', route => route.abort())
    await signIn(page, 'empresa-cuenta@e2e.test')
    await page.goto('/mi-cuenta/cuenta-corriente')

    const receiptId = await uploadAccountReceipt(page, 335)
    const declared = await declarePayment(page, receiptId, '1000.00', 'ARS')
    expect(declared.status).toBe(201)

    const row = page.getByRole('region', { name: 'Historial de pagos' })
        .getByRole('listitem').filter({ hasText: `Pago #${declared.id}` })
    await expect(row).toBeVisible()
    await expect(row).toContainText('ARS 1.000,00')
    await expect(row).toContainText('Se determina al acreditar con cotización verificada.')
    await expect(row.getByText('Pago pendiente de acreditación', { exact: true })).toBeVisible()

    await withDb(async connection => {
        const [payment] = await connection.query(
            'SELECT moneda, monto, monto_usd, estado FROM PAGO WHERE id_pago = ?',
            [declared.id],
        ) as Array<{ moneda: string; monto: string; monto_usd: string | null; estado: string }>
        expect(payment).toEqual({ moneda: 'ARS', monto: '1000.00', monto_usd: null, estado: 'PENDIENTE' })
        const [movements] = await connection.query(
            'SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?',
            [declared.id],
        ) as Array<{ total: number }>
        expect(Number(movements.total)).toBe(0)
    })
})

test('respuesta perdida y reintento idempotente no duplica el pago ni crea un ABONO', async ({ page }) => {
    test.setTimeout(60_000)
    await page.route('**/socket.io/**', route => route.abort())
    await signIn(page, 'empresa-cuenta@e2e.test')
    await page.goto('/mi-cuenta/cuenta-corriente')
    await expect(page.getByRole('region', { name: 'Resumen financiero' })).toBeVisible()

    const before = (await (await page.request.get('/api/cuenta-corriente')).json()).data
    expect(before.origen).toBe('REAL')
    const receiptId = await uploadAccountReceipt(page, 336)

    const keys: string[] = []
    let posts = 0
    await page.route('**/api/cuenta-corriente/pagos', async route => {
        if (route.request().method() !== 'POST') return route.continue()
        posts += 1
        keys.push(route.request().headers()['idempotency-key'] ?? '')
        if (posts === 1) {
            // La API confirma la declaración, pero el navegador pierde la respuesta.
            await route.fetch()
            return route.abort('failed')
        }
        return route.continue()
    })

    const declaration = page.getByRole('region', { name: 'Declarar un pago' })
    await expect(declaration).toBeVisible()
    const radio = declaration.locator(`input[name="payment-receipt"][value="${receiptId}"]`)
    await radio.check()
    await declaration.getByLabel('Importe declarado').fill('11.00')
    await declaration.getByLabel('Moneda').selectOption('USD')
    await declaration.getByRole('button', { name: 'Revisar declaración' }).click()

    const dialog = page.getByRole('dialog', { name: 'Revisar declaración de pago' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: 'Confirmar declaración' }).click()

    await expect(dialog.getByRole('status').filter({
        hasText: 'resultado de la declaración no está confirmado',
    })).toBeVisible()
    expect(posts).toBe(1)

    await dialog.getByRole('button', { name: 'Reintentar con la misma clave' }).click()
    await expect(page.getByRole('status').filter({
        hasText: 'La declaración ya estaba registrada. No se creó un pago duplicado.',
    })).toBeVisible()
    expect(posts).toBe(2)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])

    const after = (await (await page.request.get('/api/cuenta-corriente')).json()).data
    expect({ saldo: after.saldo, revision: after.revision })
        .toEqual({ saldo: before.saldo, revision: before.revision })

    await withDb(async connection => {
        const payments = await connection.query(
            'SELECT id_pago, estado, estado_documental FROM PAGO WHERE id_comprobante = ?',
            [receiptId],
        ) as Array<{ id_pago: number; estado: string; estado_documental: string }>
        expect(payments).toHaveLength(1)
        expect(payments[0]).toMatchObject({ estado: 'PENDIENTE', estado_documental: 'PENDIENTE' })
        const [movements] = await connection.query(
            'SELECT COUNT(*) AS total FROM MOVIMIENTO_CUENTA_CORRIENTE WHERE id_pago = ?',
            [payments[0]!.id_pago],
        ) as Array<{ total: number }>
        expect(Number(movements.total)).toBe(0)
    })
})
