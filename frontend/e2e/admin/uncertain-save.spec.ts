import { test, expect } from '@playwright/test';

test('bloquea cambios tras una respuesta perdida hasta recargar correctamente', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', {
    name: 'Ingresar',
    exact: true,
  }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  const stockEndpoint = /\/api\/admin\/productos\/2\/stock$/;
  const listEndpoint = /\/api\/admin\/productos(?:\?.*)?$/;

  const form = page.locator('form').filter({
    has: page.getByRole('button', {
      name: 'Guardar Cambios',
      exact: true,
    }),
  });
  const stock = form.locator('label').filter({
    hasText: /^Stock \*/,
  }).locator('xpath=following-sibling::input[1]');
  const save = form.getByRole('button', {
    name: 'Guardar Cambios',
    exact: true,
  });
  const create = page.getByRole('button', {
    name: '+ Nuevo Producto',
    exact: true,
  });

  let backendStatus: number | undefined;
  let saveRequests = 0;

  try {
    await page.goto('/admin/productos');
    await page.getByRole('button', {
      name: 'Editar Producto E2E 02',
      exact: true,
    }).click();
    await expect(stock).toHaveValue('30');

    await page.route(stockEndpoint, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }

      saveRequests++;

      // Ejecutar el guardado real, pero perder su respuesta al navegador.
      const response = await route.fetch();
      backendStatus = response.status();
      await route.abort('failed');
    });

    await stock.fill('11');
    await save.click();

    await expect(form.getByRole('alert')).toContainText(
      'No se pudo confirmar el resultado.',
    );

    expect(backendStatus).toBe(200);
    expect(saveRequests).toBe(1);

    await expect(stock).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(create).toBeDisabled();
    await expect(page.getByRole('status')).toHaveCount(0);

    // Comprobar que el cambio realmente quedó guardado.
    const persisted = await page.request.get('/api/admin/productos/2');
    expect(persisted.status()).toBe(200);
    expect(Number((await persisted.json()).stock)).toBe(11);

    // Una recarga fallida no debe desbloquear las modificaciones.
    await page.route(listEndpoint, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Recarga fallida provocada por E2E',
        }),
      });
    });

    const failedReload = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/admin/productos'
      && response.status() === 503,
    );

    await form.getByRole('button', {
      name: 'Recargar listado',
      exact: true,
    }).click();
    await failedReload;

    await expect(page.getByText(
      'Recarga fallida provocada por E2E',
      { exact: true },
    )).toBeVisible();
    await expect(stock).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(create).toBeDisabled();
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(saveRequests).toBe(1);

    // Recuperar la conexión y consultar nuevamente el backend real.
    await page.unroute(listEndpoint);
    await page.unroute(stockEndpoint);

    const successfulReload = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/admin/productos'
      && response.request().method() === 'GET'
      && response.status() === 200,
    );

    await form.getByRole('button', {
      name: 'Recargar listado',
      exact: true,
    }).click();
    await successfulReload;

    await expect(form).toHaveCount(0);
    await expect(create).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', {
      name: 'Editar Producto E2E 02',
      exact: true,
    }).click();

    await expect(stock).toHaveValue('11');
    await expect(stock).toBeEnabled();
    await expect(save).toBeEnabled();
  } finally {
    await page.unroute(stockEndpoint);
    await page.unroute(listEndpoint);

    const restored = await page.request.patch(
      '/api/admin/productos/2/stock',
      { data: { stock: 30 }, headers: { Origin: new URL(page.url()).origin } },
    );
    expect(restored.ok()).toBe(true);

    const verification = await page.request.get('/api/admin/productos/2');
    expect(verification.status()).toBe(200);
    expect(Number((await verification.json()).stock)).toBe(30);
  }
});