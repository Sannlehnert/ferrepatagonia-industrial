import { test, expect } from '@playwright/test';

for (const failure of ['red', 'http500'] as const) {
  test(`recupera el catálogo después de un error de ${failure}`, async ({
    page,
  }) => {
    const catalogEndpoint = /\/api\/catalogo(?:\?.*)?$/;
    let interceptedRequests = 0;

    await page.route(catalogEndpoint, async (route) => {
      interceptedRequests++;

      if (failure === 'red') {
        await route.abort('failed');
      } else {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Error provocado por la prueba E2E',
          }),
        });
      }
    });

    await page.goto('/catalogo?busqueda=E2E-02');

    const error = page.getByRole('alert').filter({
      hasText: 'No se pudo cargar el catálogo.',
    });
    const names = page.getByRole('heading', { level: 3 });

    await expect(error).toBeVisible();
    expect(interceptedRequests).toBeGreaterThan(0);
    await expect(names).toHaveCount(0);

    // Un fallo no debe presentarse como una búsqueda sin resultados.
    await expect(page.getByText(
      'No encontramos productos con esos filtros.',
      { exact: true },
    )).toHaveCount(0);

    // Retirar el fallo: el reintento utiliza el backend real.
    await page.unroute(catalogEndpoint);

    const realResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());

      return url.pathname === '/api/catalogo'
        && url.searchParams.get('busqueda') === 'E2E-02'
        && response.request().method() === 'GET'
        && response.status() === 200;
    });

    await error.getByRole('button', {
      name: 'Reintentar',
      exact: true,
    }).click();

    await realResponse;

    await expect(error).toHaveCount(0);
    await expect(names).toHaveText(['Producto E2E 02']);
    await expect(page.getByRole('searchbox', {
      name: 'Nombre o código',
    })).toHaveValue('E2E-02');
    await expect.poll(
      () => new URL(page.url()).searchParams.get('busqueda'),
    ).toBe('E2E-02');
  });
}