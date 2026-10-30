import { test, expect } from '@playwright/test';

test('API: rechaza al visitante con 401', async ({ page }) => {
  await page.goto('/catalogo');

  const response = await page.request.get('/api/admin/productos');

  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({
    message: 'No autenticado.',
  });
});

for (const account of [
  {
    role: 'cliente',
    email: 'cliente@e2e.test',
    destination: '/mi-cuenta/datos',
    expectedStatus: 403,
  },
  {
    role: 'administrador',
    email: 'admin@e2e.test',
    destination: '/admin/dashboard',
    expectedStatus: 200,
  },
]) {
  test(`API: responde ${account.expectedStatus} al ${account.role}`, async ({
    page,
  }) => {
    await page.goto('/login');

    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
    await page.getByRole('button', {
      name: 'Ingresar',
      exact: true,
    }).click();

    await expect(page).toHaveURL(
      new RegExp(`${account.destination}$`),
    );

    // Comparte las cookies de la sesión iniciada en el navegador.
    const response = await page.request.get('/api/admin/productos');

    expect(response.status()).toBe(account.expectedStatus);

    const body = await response.json();

    if (account.expectedStatus === 403) {
      expect(body).toEqual({
        message: 'El rol autenticado no tiene permiso.',
      });
    } else {
      expect(Array.isArray(body)).toBe(true);
      expect(body).toEqual(expect.arrayContaining([
        expect.objectContaining({
          codigo: 'E2E-01',
          nombre: 'Producto E2E 01',
        }),
      ]));
    }

    // La consulta no debe invalidar la sesión.
    const session = await page.request.get('/api/auth/me');
    expect(session.status()).toBe(200);
  });
}