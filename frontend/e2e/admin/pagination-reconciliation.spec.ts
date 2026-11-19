import { expect, test, type Page } from '@playwright/test';

const view = '/admin/productos';
const list = /\/api\/admin\/productos\?/;
const nav = (page: Page) => page.getByRole('navigation', { name: 'Paginación de productos' });
const search = (page: Page) => page.getByRole('textbox', { name: 'Buscar productos por nombre o SKU' });
const create = (page: Page) => page.getByRole('button', { name: '+ Nuevo Producto' });
const warning = (page: Page) => page.getByRole('alert').filter({ hasText: 'No se pudo confirmar el resultado' });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

function held<T>() {
  return { arrived: Promise.withResolvers<T>(), release: Promise.withResolvers<void>(), done: Promise.withResolvers<void>() };
}

test('reauditoría: Back durante escritura y dos generaciones de reconciliación', async ({ page }) => {
  await signIn(page);
  await page.goto(view);
  await nav(page).getByRole('button', { name: 'Siguiente' }).click();
  const deactivate = page.getByRole('button', { name: 'Desactivar Producto E2E 02', exact: true });
  const reload = warning(page).getByRole('button', { name: 'Recargar listado' });
  await expect(deactivate).toBeEnabled();

  const endpoint = '/api/admin/productos/2';
  const mutation = new RegExp(endpoint + '/desactivar$');
  const write = held<void>();
  const backRead = held<number>();
  const searchRead = held<number>();
  const firstRecovery = held<number>();
  const latestRecovery = held<number>();
  let writes = 0;
  let filteredReads = 0;
  await page.route(mutation, async route => {
    writes++;
    write.arrived.resolve();
    await write.release.promise;
    expect((await route.fetch()).status()).toBe(200);
    await route.fulfill({ status: 502, json: { message: 'Resultado incierto para la prueba' } });
  });
  await page.route(list, async route => {
    const params = new URL(route.request().url()).searchParams;
    const filter = params.get('busqueda');
    if (filter === 'E2E-02' && [2, 3].includes(++filteredReads)) {
      await route.fulfill({ status: 500, json: { message: 'Lectura fallida ' + filteredReads } });
      return;
    }
    const gate = filter === 'E2E-02' ? (filteredReads === 1 ? searchRead : firstRecovery)
      : filter === 'E2E-03' ? latestRecovery : backRead;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const { data } = await response.json();
    gate.arrived.resolve(data[0].activo);
    await gate.release.promise;
    await route.fulfill({ response });
    gate.done.resolve();
  });
  try {
    page.once('dialog', dialog => dialog.accept());
    await deactivate.click();
    await write.arrived.promise;
    await page.goBack();
    await backRead.arrived.promise;
    await search(page).fill('E2E-02');
    expect(await searchRead.arrived.promise).toBe(1);
    await expect(create(page)).toBeDisabled();
    write.release.resolve();
    await expect(warning(page)).toBeVisible();
    const persisted = await page.request.get(endpoint);
    expect((await persisted.json()).activo).toBe(0);
    for (const gate of [searchRead, backRead]) {
      gate.release.resolve();
      await gate.done.promise;
      await expect(warning(page)).toBeVisible();
      await expect(create(page)).toBeDisabled();
    }
    for (const number of [2, 3]) {
      await reload.click();
      await expect(page.getByText('Lectura fallida ' + number)).toBeVisible();
      await expect(warning(page)).toBeVisible();
      await expect(create(page)).toBeDisabled();
    }
    await reload.click();
    expect(await firstRecovery.arrived.promise).toBe(0);
    await search(page).fill('E2E-03');
    expect(await latestRecovery.arrived.promise).toBe(1);
    firstRecovery.release.resolve();
    await firstRecovery.done.promise;
    await expect(warning(page)).toBeVisible();
    await expect(create(page)).toBeDisabled();
    latestRecovery.release.resolve();
    await expect(page.getByRole('rowheader', { name: 'Producto E2E 03', exact: true })).toBeVisible();
    await expect(warning(page)).toHaveCount(0);
    await expect(create(page)).toBeEnabled();
    await page.unroute(list);
    await search(page).fill('E2E-02');
    await expect(page.getByRole('button', { name: 'Activar Producto E2E 02', exact: true })).toBeEnabled();
    expect(writes).toBe(1);
    console.log('Reauditoría H-01: Back durante PATCH, dos lecturas previas liberadas en orden inverso, dos 500 y reconciliación superada por nueva búsqueda; una sola escritura.');
  } finally {
    for (const gate of [write, backRead, searchRead, firstRecovery, latestRecovery]) gate.release.resolve();
    await page.unroute(list);
    await page.unroute(mutation);
    const restored = await page.request.put(endpoint, {
      headers: { Origin: new URL(page.url()).origin }, data: { activo: true },
    });
    expect(restored.status()).toBe(200);
  }
});

test('reauditoría: foco y bloqueo de navegación durante una lectura lenta', async ({ page }) => {
  await signIn(page);
  await page.goto(view + '?origen=auditoria#admin-content');
  const previous = nav(page).getByRole('button', { name: 'Anterior' });
  const next = nav(page).getByRole('button', { name: 'Siguiente' });
  await expect(previous).toBeDisabled();
  let requests = 0;
  const advancing = held<void>();
  await page.route(list, async route => {
    requests++;
    advancing.arrived.resolve();
    await advancing.release.promise;
    await route.continue();
  });
  try {
    await next.focus();
    await page.keyboard.press('Enter');
    await advancing.arrived.promise;
    await expect(nav(page)).toHaveAttribute('aria-busy', 'true');
    await expect(next).toBeFocused();
    await expect(next).toBeDisabled();
    await page.keyboard.press('Enter');
    expect(requests).toBe(1);
    expect(new URL(page.url()).searchParams.get('origen')).toBe('auditoria');
    expect(new URL(page.url()).hash).toBe('#admin-content');
  } finally { advancing.release.resolve(); }
  await expect(nav(page)).toContainText('Página 2 de 2');
  await expect(previous).toBeFocused();
  await expect(next).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(nav(page)).toContainText('Página 1 de 2');
  await expect(next).toBeFocused();
  await expect(previous).toBeDisabled();

  const rejected = await page.request.get('/api/admin/productos?origen=auditoria');
  expect(rejected.status()).toBe(400);
  await page.goto(view + '?page=999&origen=auditoria&busqueda=%20#admin-content');
  await expect(nav(page)).toContainText('Página 2 de 2');
  await expect(page).toHaveURL(url => url.searchParams.get('page') === '2'
    && url.searchParams.get('origen') === 'auditoria' && !url.searchParams.has('busqueda'));
  console.log('Reauditoría H-02/H-03: parámetro ajeno conservado solo en URL; foco en botón durante carga real, sin GET duplicado por segundo Intro.');
});

test('reauditoría: el contrato histórico y la búsqueda parcial paginada coexisten', async ({ page }) => {
  await signIn(page);
  const endpoint = '/api/admin/productos';
  const historical = await page.request.get(endpoint);
  expect(historical.status()).toBe(200);
  const full = await historical.json();
  expect(Array.isArray(full)).toBe(true);
  const expected = full.filter((row: { nombre: string }) => row.nombre.includes('Producto E2E '));
  for (const [pageNumber, offset] of [[1, 0], [2, 7], [4, 21]]) {
    const response = await page.request.get(endpoint + '?busqueda=Producto%20E2E%20&page=' + pageNumber + '&limit=7');
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      data: expected.slice(offset, offset + 7), page: pageNumber, limit: 7, total: expected.length, totalPages: 4,
    });
  }
  const sku = await page.request.get(endpoint + '?busqueda=E2E-INACTIVO');
  expect((await sku.json()).data).toMatchObject([{ codigo: 'E2E-INACTIVO', activo: 0 }]);
});
