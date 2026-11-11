import { test, expect } from '@playwright/test';

test.describe('Task #277 — Admin Orders Modal: Prevención de carrera y foco accesible', () => {
  test.beforeEach(async ({ page }) => {
    const adminUser = {
      id: 1,
      email: 'admin@ferrepatagonia.test',
      rol: 'ADMIN',
      tipoCliente: null,
    };

    // Hidratar sesión de ADMIN para useAuthStore sin redirección a login
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

    // Mock del listado administrativo
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

    // Detalle del pedido 10
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

    // Detalle del pedido 11
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

  test('La respuesta tardía de PATCH de pedido A no bloquea el guardado de B ni pisa sus datos', async ({ page }) => {
    let unblockPatchA: () => void = () => {};
    const patchAPromise = new Promise<void>(res => { unblockPatchA = res; });

    await page.route(/\/api\/admin\/pedidos\/10\/estado$/, async route => {
      if (route.request().method() === 'PATCH') {
        await patchAPromise;
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

    await page.route(/\/api\/admin\/pedidos\/11\/estado$/, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Estado del pedido actualizado correctamente.',
            data: {
              idPedido: 11,
              fecha: '2026-11-02T11:00:00Z',
              estado: 'EN_PREPARACION',
              estadosPermitidos: ['ENVIADO', 'ENTREGADO'],
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

    // 2. Disparar PATCH demorado en pedido 10
    await page.getByRole('button', { name: 'Guardar Estado' }).click();

    // 3. Cerrar modal de A mientras el PATCH sigue en vuelo
    await page.getByRole('button', { name: 'Cerrar modal' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 4. Abrir modal del pedido 11 MIENTRAS EL PATCH DE A SIGUE EN VUELO
    await page.getByRole('button', { name: 'Ver detalle del pedido 11' }).click();
    await expect(page.getByRole('heading', { name: 'Pedido #11' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Empresa B SA');

    // 5. H-01 COMPROBACIÓN EN TIEMPO DE VUELO: el botón de B DEBE estar habilitado y decir "Guardar Estado"
    // (sin esperar a que unblockPatchA resuelva)
    const saveButtonB = page.getByRole('button', { name: 'Guardar Estado' });
    await expect(saveButtonB).toBeEnabled();
    await expect(saveButtonB).toHaveText('Guardar Estado');

    // 6. El usuario puede mutar B normalmente mientras A sigue pendiente
    await saveButtonB.click();
    await expect(page.getByText('Estado actualizado a En preparación.')).toBeVisible();

    // 7. Destrabar el PATCH de 10 después de haber comprobado y operado sobre B
    unblockPatchA();
    await page.waitForTimeout(300);

    // 8. Verificar que el modal de B sigue conservando su propia identidad
    await expect(page.getByRole('heading', { name: 'Pedido #11' })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Empresa B SA');
    await expect(page.getByRole('dialog')).not.toContainText('Empresa A SRL');

    // 9. H-02: Contención de foco por teclado
    const closeBtn = page.getByRole('button', { name: 'Cerrar', exact: true });
    await closeBtn.focus();
    await page.keyboard.press('Tab');

    const dialog = page.getByRole('dialog');
    const isFocusInside = await dialog.evaluate((node: any) => {
      const active = node.ownerDocument?.activeElement;
      return Boolean(active && node.contains(active));
    });
    expect(isFocusInside).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});