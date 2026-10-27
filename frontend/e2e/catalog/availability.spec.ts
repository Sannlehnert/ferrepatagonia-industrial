import { test, expect } from '@playwright/test';

test('mantiene visible el producto sin stock y deshabilita Agregar', async ({
  page,
}) => {
  await page.goto('/catalogo');

  const withoutStock = page.getByRole('listitem').filter({
    has: page.getByRole('heading', {
      name: 'Producto E2E 01',
      exact: true,
    }),
  });
  const withStock = page.getByRole('listitem').filter({
    has: page.getByRole('heading', {
      name: 'Producto E2E 02',
      exact: true,
    }),
  });

  await expect(withoutStock).toBeVisible();
  await expect(withoutStock.getByText('No disponible', {
    exact: true,
  })).toBeVisible();
  await expect(withoutStock.getByRole('button', {
    name: 'Agregar',
    exact: true,
  })).toBeDisabled();

  await expect(withStock).toBeVisible();
  await expect(withStock.getByText('Disponible', {
    exact: true,
  })).toBeVisible();
  await expect(withStock.getByRole('button', {
    name: 'Agregar',
    exact: true,
  })).toBeEnabled();

  await page.reload();

  await expect(withoutStock.getByRole('button', {
    name: 'Agregar',
    exact: true,
  })).toBeDisabled();
  await expect(withStock.getByRole('button', {
    name: 'Agregar',
    exact: true,
  })).toBeEnabled();
});

for (const scenario of [
  {
    title: 'oculta los productos inactivos al buscarlos por código',
    code: 'E2E-INACTIVO',
  },
  {
    title: 'oculta los productos de una categoría inactiva',
    code: 'E2E-OCULTO',
  },
]) {
  test(scenario.title, async ({ page }) => {
    await page.goto('/catalogo');

    const filters = page.getByRole('form', {
      name: 'Buscar y filtrar productos',
    });
    const category = filters.getByRole('combobox', {
      name: 'Categoría',
      exact: true,
    });
    const names = page.getByRole('heading', { level: 3 });

    // Confirmar que terminó la carga antes de verificar ausencias.
    await expect(names).toHaveCount(12);
    await expect(category).toBeEnabled();

    await expect(category.locator('option')).toHaveText([
      'Todas las categorías',
      'Fijaciones E2E',
      'Herramientas E2E',
      'Vacía E2E',
    ]);

    await filters.getByRole('searchbox', {
      name: 'Nombre o código',
    }).fill(scenario.code);

    await filters.getByRole('button', {
      name: 'Buscar',
      exact: true,
    }).click();

    await expect.poll(
      () => new URL(page.url()).searchParams.get('busqueda'),
    ).toBe(scenario.code);

    await expect(page.getByText(
      'No encontramos productos con esos filtros.',
      { exact: true },
    )).toBeVisible();
    await expect(names).toHaveCount(0);

    // El resultado también debe mantenerse al entrar por la URL guardada.
    await page.reload();

    await expect(page.getByText(
      'No encontramos productos con esos filtros.',
      { exact: true },
    )).toBeVisible();
    await expect(names).toHaveCount(0);
    await expect(filters.getByRole('searchbox', {
      name: 'Nombre o código',
    })).toHaveValue(scenario.code);
  });
}