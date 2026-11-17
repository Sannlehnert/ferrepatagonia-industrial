import { test, expect } from '@playwright/test';

test('una lectura anterior al 502 no reconcilia una desactivación persistida', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto('/admin/productos');

  const productEndpoint = '/api/admin/productos/25';
  const writeEndpoint = /\/api\/admin\/productos\/25\/desactivar$/;
  const filteredList = /\/api\/admin\/productos\?.*busqueda=E2E-25/;
  const runningWrite = Promise.withResolvers<void>();
  const staleReadCaptured = Promise.withResolvers<void>();
  const staleReadRelease = Promise.withResolvers<void>();
  const staleReadFinished = Promise.withResolvers<void>();
  let writes = 0;

  const deactivate = page.getByRole('button', { name: 'Desactivar Producto E2E 25', exact: true });
  const activate = page.getByRole('button', { name: 'Activar Producto E2E 25', exact: true });
  const create = page.getByRole('button', { name: '+ Nuevo Producto' });
  const warning = page.getByRole('alert').filter({ hasText: 'No se pudo confirmar el resultado' });
  const reload = warning.getByRole('button', { name: 'Recargar listado' });
  const search = page.getByRole('textbox', { name: 'Buscar productos por nombre o SKU' });

  const report: string[] = [];
  const checkPersistedState = async (active: number) => {
    const response = await page.request.get(productEndpoint);
    expect(response.status()).toBe(200);
    expect((await response.json()).activo).toBe(active);
  };

  await page.route(writeEndpoint, async route => {
    writes++;
    await runningWrite.promise;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({ status: 502, json: { message: 'Respuesta no confirmada' } });
  });
  await page.route(filteredList, async route => {
    const response = await route.fetch();
    const { data } = await response.json();
    expect(data.map((product: { id_producto: number; activo: number }) =>
      [product.id_producto, product.activo])).toEqual([[25, 1]]);
    report.push('Lectura anterior retenida con activo=1.');
    staleReadCaptured.resolve();
    await staleReadRelease.promise;
    await route.fulfill({ response });
    staleReadFinished.resolve();
  });

  try {
    page.once('dialog', dialog => dialog.accept());
    await deactivate.click();
    await expect(deactivate).toBeDisabled();
    await expect(deactivate).toHaveAccessibleDescription(/acciones están temporalmente deshabilitadas/);
    await search.fill('E2E-25');
    await staleReadCaptured.promise;
    runningWrite.resolve();
    await expect(warning).toBeVisible();
    await checkPersistedState(0);
    report.push('MariaDB confirmó activo=0 tras el 502 visible para la aplicación.');

    staleReadRelease.resolve();
    await staleReadFinished.promise;
    await page.unroute(filteredList);
    await expect(warning).toBeVisible();
    await expect(create).toBeDisabled();
    await expect(deactivate).toHaveCount(0);
    report.push('Liberar la lectura anterior mantuvo la advertencia y el bloqueo.');

    await page.route(filteredList, route => route.fulfill({
      status: 500, json: { message: 'No se pudo verificar el listado.' },
    }), { times: 1 });
    await reload.click();
    await expect(page.getByRole('alert')).toContainText(['No se pudo confirmar el resultado', 'No se pudo verificar el listado.']);
    await expect(create).toBeDisabled();
    report.push('Un 500 en la lectura de reconciliación mantuvo el bloqueo.');

    await reload.click();
    await expect(activate).toBeEnabled();
    await expect(warning).toHaveCount(0);
    await expect(create).toBeEnabled();
    expect(writes).toBe(1);
    report.push('La nueva lectura mostró activo=0, habilitó Activar y no repitió la escritura.');
    console.log(report.join('\n'));
    await test.info().attach('reconciliacion-502', {
      contentType: 'text/plain', body: report.join('\n'),
    });
  } finally {
    runningWrite.resolve();
    staleReadRelease.resolve();
    await page.unroute(writeEndpoint);
    await page.unroute(filteredList);
    const restored = await page.request.put(productEndpoint, {
      headers: { Origin: new URL(page.url()).origin }, data: { activo: true },
    });
    expect(restored.status()).toBe(200);
  }
});

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
    await page.goto('/admin/productos?busqueda=E2E-02');
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
