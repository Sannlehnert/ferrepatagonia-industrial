import { test, expect } from '@playwright/test';

test('sesión cliente conserva su carrito y la API rechaza totales calculados por el navegador', async ({
  page,
}) => {
  await page.goto('/catalogo');

  const anonymous = await page.request.get('/api/carrito');
  expect(anonymous.status()).toBe(401);

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('cliente@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/mi-cuenta\/datos$/);

  const firstResponse = await page.request.get('/api/carrito');
  expect(firstResponse.status()).toBe(200);
  expect(firstResponse.headers()['cache-control']).toBe('private, no-store');
  const first = await firstResponse.json();
  expect(first.items).toEqual([]);
  expect(first.totalUSD).toBe('0.00');

  const tampered = await page.request.post('/api/carrito/items', {
    headers: { Origin: new URL(page.url()).origin },
    data: { productoId: 2, cantidad: 1, totalUSD: '0.01' },
  });
  expect(tampered.status()).toBe(400);
  expect(await tampered.json()).toMatchObject({ code: 'SOLICITUD_INVALIDA' });

  await page.reload();
  const restored = await page.request.get('/api/carrito');
  expect(restored.status()).toBe(200);
  const afterReload = await restored.json();
  expect(afterReload.id_carrito).toBe(first.id_carrito);
  expect(afterReload.items).toEqual([]);
  expect(afterReload.totalUSD).toBe('0.00');
});
