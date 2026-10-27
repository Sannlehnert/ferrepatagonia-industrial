import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('crea y edita un producto con persistencia y reflejo público', async ({
  page,
  browser,
}) => {
  const code = `E2E-ALTA-${randomUUID().slice(0, 8)}`;
  const initialName = `Producto de alta ${code}`;
  const editedName = `Producto editado ${code}`;
  let createdId: number | undefined;

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
  await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
  await page.getByRole('button', {
    name: 'Ingresar',
    exact: true,
  }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);

  await page.goto('/admin/productos');

  const form = page.locator('form').filter({
    has: page.getByRole('button', {
      name: /^(Crear Producto|Guardar Cambios)$/,
    }),
  });

  const field = (label: string) =>
    form.locator('label').filter({ hasText: label })
      .locator('xpath=following-sibling::input[1]');

  // Visitante independiente, sin la sesión del administrador.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const origin = new URL(page.url()).origin;
  const publicNames = visitor.getByRole('heading', { level: 3 });

  const checkPublicProduct = async (expectedName: string) => {
    await visitor.goto(
      `${origin}/catalogo?busqueda=${encodeURIComponent(code)}`,
    );

    await expect(publicNames).toHaveText([expectedName]);
    await expect(visitor.getByText(`COD. ${code}`, {
      exact: true,
    })).toBeVisible();

    await visitor.reload();
    await expect(publicNames).toHaveText([expectedName]);
  };

  try {
    // Crear el producto desde administración.
    await page.getByRole('button', {
      name: '+ Nuevo Producto',
      exact: true,
    }).click();

    await expect(page.getByRole('heading', {
      name: 'Crear Nuevo Producto',
      exact: true,
    })).toBeVisible();

    await field('Nombre del Producto').fill(initialName);
    await field('Código SKU').fill(code);
    await form.getByRole('combobox').selectOption({
      label: 'Herramientas E2E',
    });
    await field('Precio Base').fill('150');
    await field('Stock').fill('8');

    const creation = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/admin/productos'
      && response.request().method() === 'POST',
    );

    await form.getByRole('button', {
      name: 'Crear Producto',
      exact: true,
    }).click();

    const response = await creation;
    expect(response.status()).toBe(201);

    const created = await response.json();
    createdId = Number(created.id_producto);
    expect(Number.isInteger(createdId) && createdId > 0).toBe(true);

    await expect(page.getByRole('status')).toHaveText(
      `"${initialName}" se creó correctamente.`,
    );
    await expect(form).toHaveCount(0);

    // Comprobar que el visitante ve el producto recién creado.
    await checkPublicProduct(initialName);

    // Comprobar persistencia en administración.
    await page.reload();

    await page.getByRole('button', {
      name: `Editar ${initialName}`,
      exact: true,
    }).click();

    await expect(field('Nombre del Producto')).toHaveValue(initialName);
    await expect(field('Código SKU')).toHaveValue(code);
    await expect(field('Precio Base')).toHaveValue('150');
    await expect(field('Stock')).toHaveValue('8');
    await expect(form.getByRole('combobox')).toHaveValue('1');

    // Editar el nombre desde administración.
    await field('Nombre del Producto').fill(editedName);

    const update = page.waitForResponse((response) =>
      new URL(response.url()).pathname
        === `/api/admin/productos/${createdId}`
      && response.request().method() === 'PUT',
    );

    await form.getByRole('button', {
      name: 'Guardar Cambios',
      exact: true,
    }).click();

    expect((await update).status()).toBe(200);
    await expect(page.getByRole('status')).toHaveText(
      `"${editedName}" se actualizó correctamente.`,
    );
    await expect(form).toHaveCount(0);

    // Comprobar que el visitante ve el nombre actualizado.
    await checkPublicProduct(editedName);

    // Comprobar persistencia de la edición en administración.
    await page.reload();

    await page.getByRole('button', {
      name: `Editar ${editedName}`,
      exact: true,
    }).click();

    await expect(field('Nombre del Producto')).toHaveValue(editedName);
    await expect(field('Código SKU')).toHaveValue(code);
    await expect(field('Precio Base')).toHaveValue('150');
    await expect(field('Stock')).toHaveValue('8');
    await expect(form.getByRole('combobox')).toHaveValue('1');
  } finally {
    try {
      // Evitar que el producto altere las otras pruebas del catálogo.
      if (createdId && Number.isInteger(createdId)) {
        const cleanup = await page.request.patch(
          `/api/admin/productos/${createdId}/desactivar`,
        );
        expect(cleanup.ok()).toBe(true);
      }
    } finally {
      await visitorContext.close();
    }
  }
});