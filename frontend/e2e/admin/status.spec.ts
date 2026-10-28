import { test, expect } from '@playwright/test';

test('cancela, desactiva y reactiva un producto con reflejo público', async ({
  page,
  browser,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', {
    name: 'Ingresar',
    exact: true,
  }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  const origin = new URL(page.url()).origin;
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();

  const deactivate = page.getByRole('button', {
    name: 'Desactivar Producto E2E 02',
    exact: true,
  });
  const activate = page.getByRole('button', {
    name: 'Activar Producto E2E 02',
    exact: true,
  });

  const publicProduct = visitor.getByRole('heading', {
    name: 'Producto E2E 02',
    exact: true,
  });

  try {
    await page.goto('/admin/productos');
    await expect(deactivate).toBeEnabled();

    await visitor.goto(`${origin}/catalogo?busqueda=E2E-02`);
    await expect(publicProduct).toBeVisible();

    // Cancelar la confirmación debe conservar el estado original.
    const cancelled = page.waitForEvent('dialog');
    const cancelClick = deactivate.click();
    const cancelDialog = await cancelled;
    const cancelMessage = cancelDialog.message();
    await cancelDialog.dismiss();
    await cancelClick;

    expect(cancelMessage).toContain('Producto E2E 02');
    expect(cancelMessage).toContain('E2E-02');

    await page.reload();
    await expect(deactivate).toBeEnabled();

    await visitor.reload();
    await expect(publicProduct).toBeVisible();

    // Confirmar la desactivación y comprobar la respuesta real.
    const deactivation = page.waitForResponse((response) =>
      new URL(response.url()).pathname
        === '/api/admin/productos/2/desactivar'
      && response.request().method() === 'PATCH',
    );

    const confirmation = page.waitForEvent('dialog');
    const confirmClick = deactivate.click();
    const confirmDialog = await confirmation;
    await confirmDialog.accept();
    await confirmClick;

    expect((await deactivation).status()).toBe(200);
    await expect(activate).toBeEnabled();

    await page.reload();
    await expect(activate).toBeEnabled();
    await expect(deactivate).toHaveCount(0);

    await visitor.reload();
    await expect(visitor.getByText(
      'No encontramos productos con esos filtros.',
      { exact: true },
    )).toBeVisible();
    await expect(publicProduct).toHaveCount(0);

    // Reactivar desde la interfaz.
    const reactivation = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/admin/productos/2'
      && response.request().method() === 'PUT',
    );

    await activate.click();
    expect((await reactivation).status()).toBe(200);
    await expect(deactivate).toBeEnabled();

    await page.reload();
    await expect(deactivate).toBeEnabled();
    await expect(activate).toHaveCount(0);

    await visitor.reload();
    await expect(publicProduct).toBeVisible();
  } finally {
    try {
      // Restaurar el estado incluso si falla una comprobación.
      const restored = await page.request.put('/api/admin/productos/2', {
        data: { activo: true },
        headers: { Origin: new URL(page.url()).origin },
      });
      expect(restored.ok()).toBe(true);

      const verification = await page.request.get('/api/admin/productos/2');
      expect(verification.status()).toBe(200);
      expect(Number((await verification.json()).activo)).toBe(1);
    } finally {
      await visitorContext.close();
    }
  }
});