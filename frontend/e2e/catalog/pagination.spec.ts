import { test, expect } from '@playwright/test';

test('pagina sin repetir productos y vuelve a la primera página al filtrar', async ({
  page,
}) => {
  await page.goto('/catalogo');

  const names = page.getByRole('heading', { level: 3 });
  const pagination = page.getByRole('navigation', {
    name: 'Paginación del catálogo',
  });

  await expect(pagination.getByText('Página 1 de 3', {
    exact: true,
  })).toBeVisible();
  await expect(names).toHaveCount(12);
  await expect(pagination.getByRole('button', {
    name: 'Anterior',
    exact: true,
  })).toBeDisabled();

  const firstPage = await names.allTextContents();

  await pagination.getByRole('button', {
    name: 'Siguiente',
    exact: true,
  }).click();

  await expect(pagination.getByText('Página 2 de 3', {
    exact: true,
  })).toBeVisible();
  await expect(names).toHaveCount(12);

  const secondPage = await names.allTextContents();

  expect(secondPage.filter(name => firstPage.includes(name))).toEqual([]);

  await pagination.getByRole('button', {
    name: 'Siguiente',
    exact: true,
  }).click();

  await expect(pagination.getByText('Página 3 de 3', {
    exact: true,
  })).toBeVisible();
  await expect(names).toHaveCount(1);
  await expect(pagination.getByRole('button', {
    name: 'Siguiente',
    exact: true,
  })).toBeDisabled();

  const allNames = [
    ...firstPage,
    ...secondPage,
    ...await names.allTextContents(),
  ];

  const expectedNames = Array.from(
    { length: 25 },
    (_, index) => `Producto E2E ${String(index + 1).padStart(2, '0')}`,
  );

  expect(allNames.sort()).toEqual(expectedNames.sort());

  const filters = page.getByRole('form', {
    name: 'Buscar y filtrar productos',
  });
  const category = filters.getByRole('combobox', {
    name: 'Categoría',
    exact: true,
  });

  await expect(category).toBeEnabled();
  await category.selectOption({ label: 'Herramientas E2E' });
  await filters.getByRole('button', {
    name: 'Buscar',
    exact: true,
  }).click();

  await expect(pagination.getByText('Página 1 de 2', {
    exact: true,
  })).toBeVisible();
  await expect(names).toHaveCount(12);
  await expect(page).toHaveURL(/[?&]categoria=1(?:&|$)/);
  await expect.poll(
    () => new URL(page.url()).searchParams.get('page'),
  ).toBeNull();
});