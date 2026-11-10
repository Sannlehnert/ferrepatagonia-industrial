import { test, expect } from '@playwright/test';

test.describe('Task #277 — Admin Orders Modal: Prevención de carrera y desincronización (P0)', () => {
    test.beforeEach(async ({ page }) => {
        const adminUser = {
            id: 1,
            email: 'admin@ferrepatagonia.test',
            rol: 'ADMIN',
            tipoCliente: null,
        };

        // 1. Mock de sesión ADMIN para hidratar useAuthStore sin redirección a login
        await page.route(/\/api\/auth\/me(\?.*)?$/, async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    user: adminUser,
                    data: {
                        ...adminUser,
                        user: adminUser,
                    },
                }),
            });
        });

        // 2. Interceptar listado paginado (/api/admin/pedidos?page=1&limit=20)
        await page.route(/\/api\/admin\/pedidos(\?.*)?$/, async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        data: {
                            items: [
                                {
                                    idPedido: 10,
                                    fecha: '2026-11-01T10:00:00Z',
                                    estado: 'CONFIRMADO',
                                    estadosPermitidos: ['EN_PREPARACION'],
                                    modalidadPago: 'CUENTA_CORRIENTE',
                                    moneda: 'USD',
                                    subtotal: '150.00',
                                    descuento: '0.00',
                                    total: '150.00',
                                    evidenciaTotalUSD: 'FER17:10',
                                    observaciones: null,
                                    cantidadItems: 1,
                                    totalUnidades: 1,
                                    cargoCuentaCorrienteId: 101,
                                    origen: 'REAL',
                                    cliente: {
                                        idCliente: 1,
                                        nombreRazonSocial: 'Empresa A SRL',
                                        tipoCliente: 'EMPRESA',
                                        documento: null,
                                        cuit: '30-11111111-9',
                                        email: 'contacto@empresa-a.test',
                                        estadoAprobacionEmpresa: 'APROBADA',
                                        esFiel: false,
                                        activo: true,
                                    },
                                },
                                {
                                    idPedido: 11,
                                    fecha: '2026-11-02T11:00:00Z',
                                    estado: 'CONFIRMADO',
                                    estadosPermitidos: ['EN_PREPARACION'],
                                    modalidadPago: 'CUENTA_CORRIENTE',
                                    moneda: 'USD',
                                    subtotal: '280.00',
                                    descuento: '0.00',
                                    total: '280.00',
                                    evidenciaTotalUSD: 'FER17:11',
                                    observaciones: null,
                                    cantidadItems: 1,
                                    totalUnidades: 2,
                                    cargoCuentaCorrienteId: 102,
                                    origen: 'REAL',
                                    cliente: {
                                        idCliente: 2,
                                        nombreRazonSocial: 'Empresa B SA',
                                        tipoCliente: 'EMPRESA',
                                        documento: null,
                                        cuit: '30-22222222-9',
                                        email: 'compras@empresa-b.test',
                                        estadoAprobacionEmpresa: 'APROBADA',
                                        esFiel: false,
                                        activo: true,
                                    },
                                },
                            ],
                            pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
                        },
                    }),
                });
            } else {
                await route.continue();
            }
        });

        // 3. Interceptar detalle del pedido 10
        await page.route(/\/api\/admin\/pedidos\/10$/, async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        data: {
                            idPedido: 10,
                            fecha: '2026-11-01T10:00:00Z',
                            estado: 'CONFIRMADO',
                            estadosPermitidos: ['EN_PREPARACION'],
                            modalidadPago: 'CUENTA_CORRIENTE',
                            moneda: 'USD',
                            subtotal: '150.00',
                            descuento: '0.00',
                            total: '150.00',
                            observaciones: null,
                            cargoCuentaCorrienteId: 101,
                            cliente: {
                                idCliente: 1,
                                nombreRazonSocial: 'Empresa A SRL',
                                tipoCliente: 'EMPRESA',
                                cuit: '30-11111111-9',
                                documento: null,
                                email: 'contacto@empresa-a.test',
                                telefono: '2994000001',
                                direccion: 'Parque Industrial Lote 1',
                            },
                            items: [
                                {
                                    idDetallePedido: 1,
                                    idProducto: 501,
                                    codigoProducto: 'SKU-001',
                                    nombreProducto: 'Amoladora Angular',
                                    cantidad: 1,
                                    precioUnitario: '150.00',
                                    descuento: '0.00',
                                    subtotal: '150.00',
                                    reglaPrecio: null,
                                },
                            ],
                        },
                    }),
                });
            } else {
                await route.continue();
            }
        });

        // 4. Interceptar detalle del pedido 11
        await page.route(/\/api\/admin\/pedidos\/11$/, async route => {
            if (route.request().method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        data: {
                            idPedido: 11,
                            fecha: '2026-11-02T11:00:00Z',
                            estado: 'CONFIRMADO',
                            estadosPermitidos: ['EN_PREPARACION'],
                            modalidadPago: 'CUENTA_CORRIENTE',
                            moneda: 'USD',
                            subtotal: '280.00',
                            descuento: '0.00',
                            total: '280.00',
                            observaciones: null,
                            cargoCuentaCorrienteId: 102,
                            cliente: {
                                idCliente: 2,
                                nombreRazonSocial: 'Empresa B SA',
                                tipoCliente: 'EMPRESA',
                                cuit: '30-22222222-9',
                                documento: null,
                                email: 'compras@empresa-b.test',
                                telefono: '2994000002',
                                direccion: 'Parque Industrial Lote 2',
                            },
                            items: [
                                {
                                    idDetallePedido: 2,
                                    idProducto: 502,
                                    codigoProducto: 'SKU-002',
                                    nombreProducto: 'Taladro Percutor',
                                    cantidad: 2,
                                    precioUnitario: '140.00',
                                    descuento: '0.00',
                                    subtotal: '280.00',
                                    reglaPrecio: null,
                                },
                            ],
                        },
                    }),
                });
            } else {
                await route.continue();
            }
        });
    });

    test('La respuesta tardía de PATCH de pedido A no se aplica sobre el modal de pedido B', async ({ page }) => {
        await page.route(/\/api\/admin\/pedidos\/10\/estado$/, async route => {
            if (route.request().method() === 'PATCH') {
                await new Promise(resolve => setTimeout(resolve, 1200));
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        message: 'Estado del pedido actualizado correctamente.',
                        data: {
                            idPedido: 10,
                            fecha: '2026-11-01T10:00:00Z',
                            estado: 'EN_PREPARACION',
                            estadosPermitidos: ['ENVIADO', 'ENTREGADO'],
                            modalidadPago: 'CUENTA_CORRIENTE',
                            moneda: 'USD',
                            subtotal: '150.00',
                            descuento: '0.00',
                            total: '150.00',
                            observaciones: null,
                            cargoCuentaCorrienteId: 101,
                            cliente: {
                                idCliente: 1,
                                nombreRazonSocial: 'Empresa A SRL',
                                tipoCliente: 'EMPRESA',
                            },
                            items: [],
                        },
                    }),
                });
            } else {
                await route.continue();
            }
        });

        await page.goto('/admin/pedidos');

        // 1. Abrir detalle del pedido 10
        await page.getByRole('button', { name: 'Ver detalle del pedido 10' }).click();
        await expect(page.getByRole('heading', { name: 'Pedido #10' })).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText('Empresa A SRL');

        // 2. Disparar cambio de estado (inicia PATCH demorado)
        await page.getByRole('button', { name: 'Guardar Estado' }).click();

        // 3. Cerrar modal antes de que responda el PATCH de A
        await page.getByRole('button', { name: 'Cerrar modal' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // 4. Abrir inmediatamente el pedido 11
        await page.getByRole('button', { name: 'Ver detalle del pedido 11' }).click();
        await expect(page.getByRole('heading', { name: 'Pedido #11' })).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText('Empresa B SA');

        // 5. Esperar a que resuelva el PATCH demorado de A
        await page.waitForTimeout(1500);

        // 6. Comprobar que el modal de B no fue sobreescrito por la respuesta tardía de A
        await expect(page.getByRole('heading', { name: 'Pedido #11' })).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText('Empresa B SA');
        await expect(page.getByRole('dialog')).not.toContainText('Empresa A SRL');
        await expect(page.getByRole('dialog')).toContainText('Taladro Percutor');
        await expect(page.getByRole('dialog')).not.toContainText('Amoladora Angular');
    });
});