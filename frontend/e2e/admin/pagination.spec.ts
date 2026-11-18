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
  const search = page.getByRole('textbox', { name: 'Buscar productos por nombre o SKU' });

  await expect(pagination).toContainText('Página 1 de 2');
  await expect(previous).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Producto inactivo E2E', exact: true })).toBeVisible();
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
  for (const width of [320, 360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(search).toBeVisible();
    await expect(pagination).toBeVisible();
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  }

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
