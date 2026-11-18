import { test, expect } from '@playwright/test';

for (const destination of ['/admin/productos', '/mi-cuenta/datos']) {
  test(`visitante: exige iniciar sesión para acceder a ${destination}`, async ({
    page,
  }) => {
    await page.goto(destination);

    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect.poll(
      () => new URL(page.url()).searchParams.get('redirect'),
    ).toBe(destination);

    await expect(page.getByRole('heading', {
      name: 'Iniciar sesión',
      exact: true,
    })).toBeVisible();

    await expect(page.getByRole('button', {
      name: 'Cerrar sesión',
      exact: true,
    })).toHaveCount(0);
  });
}

for (const account of [
  {
    role: 'cliente',
    email: 'cliente@e2e.test',
    allowed: '/mi-cuenta/datos',
    forbidden: '/admin/productos',
  },
  {
    role: 'administrador',
    email: 'admin@e2e.test',
    allowed: '/admin/dashboard',
    forbidden: '/mi-cuenta/datos',
  },
]) {
  test(`${account.role}: rechaza otra área y conserva la sesión`, async ({
    page,
  }) => {
    await page.goto('/login');

    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
    await page.getByRole('button', {
      name: 'Ingresar',
      exact: true,
    }).click();

    await expect(page).toHaveURL(new RegExp(`${account.allowed}$`));

    // Entrar escribiendo la URL también debe respetar el rol.
    await page.goto(account.forbidden);

    await expect(page).toHaveURL(/\/acceso-denegado$/);
    await expect(page.getByRole('heading', {
      name: 'No tenés permiso para acceder',
      exact: true,
    })).toBeVisible();

    // El rechazo no debe cerrar una sesión válida.
    await page.goto(account.allowed);

    await expect(page).toHaveURL(new RegExp(`${account.allowed}$`));
    await expect(page.getByRole('button', {
      name: 'Cerrar sesión',
      exact: true,
    })).toBeVisible();
  });
}