import { test, expect } from '@playwright/test';

for (const status of [400, 404, 409]) {
  test(`rechazo administrativo ${status}: conserva datos sin éxito falso`, async ({
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

    await page.goto('/admin/productos');
    await page.getByRole('button', {
      name: 'Editar Producto E2E 02',
      exact: true,
    }).click();

    const form = page.locator('form').filter({
      has: page.getByRole('button', {
        name: 'Guardar Cambios',
        exact: true,
      }),
    });
    const field = (label: string) =>
      form.locator('label').filter({ hasText: label })
        .locator('xpath=following-sibling::input[1]');

    const stock = field('Stock');
    const code = field('Código SKU');
    const save = form.getByRole('button', {
      name: 'Guardar Cambios',
      exact: true,
    });

    await expect(stock).toHaveValue('30');
    await stock.fill('31');

    if (status === 409) {
      // SKU existente: el backend real debe rechazar el duplicado.
      await code.fill('E2E-01');
    } else {
      const endpoint = /\/api\/admin\/productos\/2\/stock$/;

      await page.route(endpoint, async (route) => {
        if (route.request().method() !== 'PATCH') {
          await route.continue();
          return;
        }

        // Provocar el rechazo en la API real, sin fabricar la respuesta.
        const response = status === 400
          ? await route.fetch({
              postData: JSON.stringify({ stock: -1 }),
            })
          : await route.fetch({
              url: new URL(
                '/api/admin/productos/2147483647/stock',
                route.request().url(),
              ).href,
            });

        await route.fulfill({ response });
      });
    }

    const rejected = page.waitForResponse((response) =>
      new URL(response.url()).pathname.startsWith('/api/admin/productos/')
      && ['PATCH', 'PUT'].includes(response.request().method()),
    );

    await save.click();

    const response = await rejected;
    expect(response.status()).toBe(status);

    const body = await response.json();
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);

    await expect(form.getByRole('alert')).toContainText(body.message);
    await expect(page.getByRole('status')).toHaveCount(0);

    // El rechazo conocido conserva el borrador y permite corregirlo.
    await expect(stock).toHaveValue('31');
    await expect(code).toHaveValue(status === 409 ? 'E2E-01' : 'E2E-02');
    await expect(stock).toBeEnabled();
    await expect(save).toBeEnabled();
    await expect(form.getByRole('button', {
      name: 'Recargar listado',
      exact: true,
    })).toHaveCount(0);

    // Comprobar persistencia: el rechazo no debe alterar el producto.
    const persisted = await page.request.get('/api/admin/productos/2');
    expect(persisted.status()).toBe(200);

    const product = await persisted.json();
    expect(product.codigo).toBe('E2E-02');
    expect(product.nombre).toBe('Producto E2E 02');
    expect(Number(product.stock)).toBe(30);
  });
}