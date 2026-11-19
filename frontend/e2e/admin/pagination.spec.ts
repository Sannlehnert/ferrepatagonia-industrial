import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

test('pagina el listado ADMIN y conserva búsqueda, historial y foco', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/productos');

  const pagination = page.getByRole('navigation', { name: 'Paginación de productos' });
  const previous = pagination.getByRole('button', { name: 'Anterior' });
  const next = pagination.getByRole('button', { name: 'Siguiente' });
  const table = page.getByRole('table', { name: 'Productos del catálogo' });
  const search = page.getByRole('textbox', { name: 'Buscar productos por nombre o SKU' });

  await expect(pagination).toContainText('Página 1 de 2');
  await expect(previous).toBeDisabled();
  await expect(table.getByRole('rowheader', { name: 'Producto inactivo E2E', exact: true })).toBeVisible();
  const inactive = table.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Producto inactivo E2E', exact: true }),
  });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Producto', 'SKU', 'Categoría', 'Stock', 'Precio base (USD)', 'Estado', 'Acciones',
  ]);
  await expect(table).toHaveAccessibleDescription(/no informa su verificación comercial/);
  await expect(inactive.getByRole('cell', { name: 'Herramientas E2E' })).toBeVisible();
  await expect(inactive.getByRole('cell', { name: '100.00', exact: true })).toBeVisible();
  await expect(inactive.getByRole('cell', { name: 'Inactivo', exact: true })).toBeVisible();
  await expect(inactive.getByRole('button', { name: 'Activar Producto inactivo E2E' })).toBeEnabled();
  await expect(inactive.getByRole('button', { name: /^Desactivar/ })).toHaveCount(0);
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(next).toBeDisabled();
  await expect(previous).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pagination).toContainText('Página 1 de 2');
  await expect(next).toBeFocused();
  await page.goBack();
  await expect(pagination).toContainText('Página 2 de 2');
  await page.goForward();
  await expect(pagination).toContainText('Página 1 de 2');
  await next.click();
  await expect(pagination).toContainText('Página 2 de 2');
  await expect(table.getByRole('rowheader', { name: 'Producto E2E 02', exact: true })).toBeVisible();
  await page.reload();
  await expect(pagination).toContainText('Página 2 de 2');

  await search.fill('E2E-25');
  await expect(pagination).toContainText('Página 1 de 1');
  await expect(table.getByRole('rowheader', { name: 'Producto E2E 25', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBeNull();
  await page.reload();
  await expect(search).toHaveValue('E2E-25');
  await expect(table.getByRole('rowheader', { name: 'Producto E2E 25', exact: true })).toBeVisible();
  for (const width of [320, 360, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(search).toBeVisible();
    await expect(pagination).toBeVisible();
    await expect(table).toBeVisible();
    await expect(table.getByRole('button', { name: 'Desactivar Producto E2E 25' })).toBeEnabled();
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  }

  await page.setViewportSize({ width: 320, height: 800 });
  const region = page.getByRole('region', { name: 'Tabla desplazable de productos' });
  await expect(region).toHaveAccessibleDescription(/usá las flechas/);
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  const edit = table.getByRole('button', { name: 'Editar Producto E2E 25', exact: true });
  await expect(edit).toBeFocused();
  await expect(edit).toBeInViewport();
  await expect(edit).toHaveAccessibleDescription('SKU: E2E-25');
  await page.keyboard.press('Tab');
  const deactivate = table.getByRole('button', { name: 'Desactivar Producto E2E 25', exact: true });
  await expect(deactivate).toBeFocused();
  await expect(deactivate).toBeInViewport();
  await expect(table.getByRole('cell', { name: 'Activo', exact: true })).toBeVisible();

  await page.route(/\/api\/admin\/productos\?/, route =>
    route.fulfill({ status: 500, json: { message: 'Listado temporalmente inaccesible.' } }), { times: 1 });
  await search.fill('SKU-sin-coincidencias-340');
  await expect(page.getByRole('alert')).toContainText('Listado temporalmente inaccesible.');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No se encontraron productos.' })).toBeVisible();
  await expect(table).toHaveCount(0);
  await expect(page.getByText('Mostrando 0 de 0 productos')).toBeVisible();
  await expect(pagination).toHaveCount(0);

  await page.getByRole('button', { name: 'Limpiar búsqueda' }).click();
  await expect(search).toHaveValue('');
  await expect(pagination).toContainText('Página 1 de 2');
});

test('anuncia la carga y no presenta un importe ausente como precio', async ({ page }) => {
  await signIn(page);
  const releaseList = Promise.withResolvers<void>();
  await page.route(/\/api\/admin\/productos\?/, async route => {
    await releaseList.promise;
    const response = await route.fetch();
    const result = await response.json();
    result.data[0].precio = null;
    await route.fulfill({ response, json: result });
  });
  try {
    await page.goto('/admin/productos?busqueda=E2E-INACTIVO');
    await expect(page.getByRole('status').filter({ hasText: 'Cargando catálogo' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Nuevo Producto' })).toBeDisabled();
  } finally {
    releaseList.resolve();
  }
  const table = page.getByRole('table', { name: 'Productos del catálogo' });
  await expect(table.getByRole('cell', { name: 'Sin importe', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '0.00', exact: true })).toHaveCount(0);
});

test('canoniza la URL ADMIN sin repetir la consulta efectiva', async ({ page }) => {
  await signIn(page);
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/admin/productos') requests.push(url.search);
  });
  const path = '/admin/productos';
  const pagination = page.getByRole('navigation', { name: 'Paginación de productos' });
  const cases = [
    { query: '?page=0002&busqueda=%20', canonical: '', api: '?page=1', label: 'Página 1 de 2' },
    { query: '?page=2&page=3&busqueda=x&busqueda=y', canonical: '', api: '?page=1', label: 'Página 1 de 2' },
    { query: '?page=1000001&busqueda=', canonical: '', api: '?page=1', label: 'Página 1 de 2' },
    { query: '?page=999', canonical: '?page=2', api: '?page=999', label: 'Página 2 de 2' },
  ];
  for (const { query, canonical, api, label } of cases) {
    const firstRequest = requests.length;
    await page.goto(path + query);
    await expect(page).toHaveURL(url => url.pathname === path && url.search === canonical);
    await expect(pagination).toContainText(label);
    await expect(pagination).toHaveAttribute('aria-busy', 'false');
    expect(requests.slice(firstRequest)).toEqual([api]);
  }

  const firstRequest = requests.length;
  await page.reload();
  await expect(pagination).toContainText('Página 2 de 2');
  expect(requests.slice(firstRequest)).toEqual(['?page=2']);
  await pagination.getByRole('button', { name: 'Anterior' }).click();
  await expect(pagination).toContainText('Página 1 de 2');
  await expect(pagination).toHaveAttribute('aria-busy', 'false');

  const requestCount = requests.length;
  const historyLength = await page.evaluate<number>('history.length');
  await page.locator('#app').evaluate(async (element, url) => {
    type AppRoot = { __vue_app__: { config: { globalProperties: {
      $router: { push: (location: string) => Promise<unknown> };
    } } } };
    const app = element as unknown as AppRoot;
    await app.__vue_app__.config.globalProperties.$router.push(url);
  }, path + '?page=-1&busqueda=%20');
  await expect(page).toHaveURL(url => url.pathname === path && url.search === '');
  await expect(pagination).toContainText('Página 1 de 2');
  expect(requests.length).toBe(requestCount);
  expect(await page.evaluate<number>('history.length')).toBe(historyLength + 1);
});

for (const { status, destination } of [
  { status: 401, destination: /\/login\?redirect=/ },
  { status: 403, destination: /\/acceso-denegado$/ },
]) {
  test(`redirige correctamente si el listado ADMIN devuelve ${status}`, async ({ page }) => {
    await signIn(page);
    await page.route(/\/api\/admin\/productos\?/, route =>
      route.fulfill({ status, json: { message: 'Acceso rechazado.' } }));
    await page.goto('/admin/productos');
    await expect(page).toHaveURL(destination);
  });
}
