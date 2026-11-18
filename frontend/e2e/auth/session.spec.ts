import { test, expect } from '@playwright/test';

for (const account of [
  {
    role: 'administrador',
    email: 'admin@e2e.test',
    destination: '/admin/dashboard',
  },
  {
    role: 'cliente',
    email: 'cliente@e2e.test',
    destination: '/mi-cuenta/datos',
  },
]) {
  test(`${account.role}: inicia, restaura y cierra sesión`, async ({
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

    const logout = page.getByRole('button', {
      name: 'Cerrar sesión',
      exact: true,
    });
    await expect(logout).toBeVisible();

    // Recargar obliga a recuperar la sesión desde el backend.
    const restoredSession = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/me'
      && response.request().method() === 'GET'
      && response.status() === 200,
    );

    await page.reload();
    await restoredSession;

    await expect(page).toHaveURL(
      new RegExp(`${account.destination}$`),
    );
    await expect(logout).toBeVisible();

    const logoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/logout'
      && response.request().method() === 'POST'
      && response.ok(),
    );

    await logout.click();
    await logoutResponse;

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', {
      name: 'Iniciar sesión',
      exact: true,
    })).toBeVisible();

    // Una navegación completa comprueba que la sesión no se restaure.
    const rejectedSession = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/me'
      && response.status() === 401,
    );

    await page.goto(account.destination);
    await rejectedSession;

    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect.poll(
      () => new URL(page.url()).searchParams.get('redirect'),
    ).toBe(account.destination);

    await expect(page.getByRole('heading', {
      name: 'Iniciar sesión',
      exact: true,
    })).toBeVisible();
    await expect(logout).toHaveCount(0);
  });
}