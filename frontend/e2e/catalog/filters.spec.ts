import { test, expect } from '@playwright/test';

test('visitante busca por SKU y conserva el resultado al recargar', async ({
  page,
}) => {
  await page.goto('/catalogo');

  await expect(
    page.getByRole('heading', { name: 'Catálogo', exact: true }),
  ).toBeVisible();

  // Esperar la carga inicial antes de aplicar el filtro.
  await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();

  const filters = page.getByRole('form', {
    name: 'Buscar y filtrar productos',
  });

  await filters.getByRole('searchbox', {
    name: 'Nombre o código',
  }).fill('E2E-02');

  await filters.getByRole('button', {
    name: 'Buscar',
    exact: true,
  }).click();

  await expect(page).toHaveURL(
    /[?&]busqueda=E2E-02(?:&|$)/,
  );

  const productNames = page.getByRole('heading', { level: 3 });

  await expect(productNames).toHaveCount(1);
  await expect(productNames).toHaveText(['Producto E2E 02']);
  await expect(page.getByText('COD. E2E-02', {
    exact: true,
  })).toBeVisible();

  await page.reload();

  await expect(filters.getByRole('searchbox', {
    name: 'Nombre o código',
  })).toHaveValue('E2E-02');

  await expect(productNames).toHaveCount(1);
  await expect(productNames).toHaveText(['Producto E2E 02']);
});

test('combina búsqueda por nombre y categoría, y permite limpiar filtros', async ({
  page,
}) => {
  await page.goto('/catalogo');

  const filters = page.getByRole('form', {
    name: 'Buscar y filtrar productos',
  });
  const search = filters.getByRole('searchbox', {
    name: 'Nombre o código',
  });
  const category = filters.getByRole('combobox', {
    name: 'Categoría',
    exact: true,
  });
  const names = page.getByRole('heading', { level: 3 });

  await expect(category).toBeEnabled();
  await category.selectOption({ label: 'Fijaciones E2E' });
  await search.fill('Producto E2E 24');
  await filters.getByRole('button', {
    name: 'Buscar',
    exact: true,
  }).click();

  await expect(names).toHaveText(['Producto E2E 24']);

  // El mismo nombre no pertenece a Herramientas.
  await category.selectOption({ label: 'Herramientas E2E' });
  await filters.getByRole('button', {
    name: 'Buscar',
    exact: true,
  }).click();

  await expect(page.getByText(
    'No encontramos productos con esos filtros.',
    { exact: true },
  )).toBeVisible();
  await expect(names).toHaveCount(0);

  await filters.getByRole('button', {
    name: 'Limpiar filtros',
    exact: true,
  }).click();

  await expect(search).toHaveValue('');
  await expect(category.locator('option:checked')).toHaveText(
  'Todas las categorías',
);
  await expect(names).toHaveCount(12);
  await expect(page.getByText('Página 1 de 3', {
    exact: true,
  })).toBeVisible();
});

test('muestra una categoría vacía y permite volver al catálogo', async ({
  page,
}) => {
  await page.goto('/catalogo');

  const filters = page.getByRole('form', {
    name: 'Buscar y filtrar productos',
  });
  const category = filters.getByRole('combobox', {
    name: 'Categoría',
    exact: true,
  });
  const names = page.getByRole('heading', { level: 3 });

  await expect(category).toBeEnabled();
  await category.selectOption({ label: 'Vacía E2E' });
  await filters.getByRole('button', {
    name: 'Buscar',
    exact: true,
  }).click();

  await expect(page).toHaveURL(/[?&]categoria=3(?:&|$)/);

  const emptyState = page.getByRole('status').filter({
    hasText: 'No encontramos productos con esos filtros.',
  });

  await expect(emptyState).toBeVisible();
  await expect(names).toHaveCount(0);
  await expect(page.getByRole('navigation', {
    name: 'Paginación del catálogo',
  })).toHaveCount(0);

  // Recuperar el catálogo desde el propio mensaje de estado vacío.
  await emptyState.getByRole('button', {
    name: 'Limpiar filtros',
    exact: true,
  }).click();

  await expect(names).toHaveCount(12);
  await expect(category.locator('option:checked')).toHaveText(
    'Todas las categorías',
  );
  await expect.poll(
    () => new URL(page.url()).searchParams.get('categoria'),
  ).toBeNull();
});