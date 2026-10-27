import { test, expect } from '@playwright/test';

test('valida stock y refleja los cambios en el catálogo público', async ({
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

  // Otro contexto representa a un visitante sin sesión.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const origin = new URL(page.url()).origin;

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

  try {
    await page.goto('/admin/productos');
    await page.getByRole('button', {
      name: 'Editar Producto E2E 02',
      exact: true,
    }).click();

    await expect(stock).toHaveValue('30');

    // Los valores inválidos deben rechazarse antes de enviarlos.
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (
        new URL(request.url()).pathname.startsWith('/api/admin/productos')
        && ['POST', 'PUT', 'PATCH'].includes(request.method())
      ) {
        mutations.push(request.url());
      }
    });

    for (const invalid of ['-1', '1.5']) {
      await stock.fill(invalid);
      await save.click();

      await expect(form.getByText(
        'El stock debe ser un entero mayor o igual a 0.',
        { exact: true },
      )).toBeVisible();
      await expect(stock).toHaveValue(invalid);
      expect(mutations).toHaveLength(0);
    }

    // Confirmar también que el backend conserva el stock original.
    const unchanged = await page.request.get('/api/admin/productos/2');
    expect(unchanged.status()).toBe(200);
    expect(Number((await unchanged.json()).stock)).toBe(30);

    for (const quantity of [0, 7]) {
      await stock.fill(String(quantity));

      const saved = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/admin/productos/2/stock'
        && response.request().method() === 'PATCH',
      );

      await save.click();
      expect((await saved).status()).toBe(200);
      await expect(form).toHaveCount(0);

      // Reabrir después de recargar verifica la persistencia.
      await page.reload();
      await page.getByRole('button', {
        name: 'Editar Producto E2E 02',
        exact: true,
      }).click();
      await expect(stock).toHaveValue(String(quantity));

      // El visitante consulta el catálogo real con una sesión independiente.
      await visitor.goto(`${origin}/catalogo?busqueda=E2E-02`);

      const product = visitor.getByRole('listitem').filter({
        has: visitor.getByRole('heading', {
          name: 'Producto E2E 02',
          exact: true,
        }),
      });

      await expect(product).toBeVisible();
      await expect(product.getByText(
        quantity === 0 ? 'No disponible' : 'Disponible',
        { exact: true },
      )).toBeVisible();

      const add = product.getByRole('button', {
        name: 'Agregar',
        exact: true,
      });

      if (quantity === 0) {
        await expect(add).toBeDisabled();
      } else {
        await expect(add).toBeEnabled();
      }
    }
  } finally {
    try {
      const restored = await page.request.patch(
        '/api/admin/productos/2/stock',
        { data: { stock: 30 } },
      );
      expect(restored.ok()).toBe(true);

      const verification = await page.request.get('/api/admin/productos/2');
      expect(verification.status()).toBe(200);
      expect(Number((await verification.json()).stock)).toBe(30);
    } finally {
      await visitorContext.close();
    }
  }
});