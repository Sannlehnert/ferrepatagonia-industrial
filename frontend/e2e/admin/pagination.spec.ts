import { expect, test } from '@playwright/test';

test('pagina el listado ADMIN y conserva la búsqueda al recargar', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto('/admin/productos');

  const pagination = page.getByRole('navigation', { name: 'Paginación de productos' });
  const previous = pagination.getByRole('button', { name: 'Anterior' });
  const next = pagination.getByRole('button', { name: 'Siguiente' });
  const search = page.getByRole('textbox', { name: 'Buscar productos por nombre o SKU' });

  await expect(pagination).toContainText('Página 1 de 2');
  await expect(previous).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Producto inactivo E2E', exact: true })).toBeVisible();
  await next.click();
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(next).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Producto E2E 02', exact: true })).toBeVisible();
  await page.reload();
  await expect(pagination).toContainText('Página 2 de 2');

  await search.fill('E2E-25');
  await expect(pagination).toContainText('Página 1 de 1');
  await expect(page.getByRole('heading', { name: 'Producto E2E 25', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBeNull();
  await page.reload();
  await expect(search).toHaveValue('E2E-25');
  await expect(page.getByRole('heading', { name: 'Producto E2E 25', exact: true })).toBeVisible();

  await page.route(/\/api\/admin\/productos\?/, route =>
    route.fulfill({ status: 500, json: { message: 'Listado temporalmente inaccesible.' } }), { times: 1 });
  await search.fill('SKU-sin-coincidencias-340');
  await expect(page.getByRole('alert')).toContainText('Listado temporalmente inaccesible.');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('No se encontraron productos.')).toBeVisible();
  await expect(page.getByText('Mostrando 0 de 0 productos')).toBeVisible();
  await expect(pagination).toHaveCount(0);

  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await expect(search).toHaveValue('');
  await expect(pagination).toContainText('Página 1 de 2');
  await page.goto('/admin/productos?page=999');
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(next).toBeDisabled();
});
