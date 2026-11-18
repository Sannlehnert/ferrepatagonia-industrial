import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const { connectOwned } = require('../../../backend/test/helpers/cc260-disposable.cjs') as {
  connectOwned(profile: unknown, runner: 'E2E'): Promise<{
    connection: {
      query(sql: string, values: unknown[]): Promise<{ affectedRows: number }>;
      end(): Promise<void>;
    };
  }>;
};

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
  const adminNames = page.getByRole('heading', { level: 3 });
  const adminProductCard = (expectedName: string) =>
    page.locator('.admin-products .grid > div').filter({
      has: page.getByRole('heading', { name: expectedName, exact: true }),
    });
  const filterAdminByCode = async (expectedName: string) => {
    const searchInput = page.getByLabel('Buscar productos por nombre o SKU');
    if ((await searchInput.inputValue()) !== code) {
      const filtered = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/admin/productos'
          && response.request().method() === 'GET'
          && url.searchParams.get('busqueda') === code;
      });
      await searchInput.fill(code);
      expect((await filtered).status()).toBe(200);
    }
    await expect(adminNames).toHaveText([expectedName]);
  };

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
    await field('Importe base cargado').fill('150');
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

    await expect(page.getByRole('status').filter({ hasText: /se creó correctamente/ })).toHaveText(
      `"${initialName}" se creó correctamente.`,
    );
    await expect(form).toHaveCount(0);

    // Comprobar que el visitante ve el producto recién creado.
    await checkPublicProduct(initialName);
    await expect(visitor.getByText('Precio pendiente de verificación', { exact: true })).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'Agregar', exact: true })).toBeDisabled();
    await filterAdminByCode(initialName);
    await expect(
      adminProductCard(initialName).getByText('Precio pendiente de verificación', { exact: true }),
    ).toBeVisible();

    // Esta evidencia ficticia solo se inserta en la base descartable del runner.
    const profile = process.env.CCE2E_TEST_PROFILE;
    if (!profile) throw new Error('Ejecutá la prueba con backend/test/helpers/run-e2e.cjs');
    const { connection } = await connectOwned(JSON.parse(profile), 'E2E');
    try {
      const evidence = await connection.query(`INSERT INTO PRECIO_USD_EVIDENCIA
        (id_producto, precio_verificado, evidencia, id_admin, verificado_utc, valida, sintetica)
        SELECT ?, 150, 'Evidencia de prueba aislada', id_usuario, UTC_TIMESTAMP(), 1, 0
        FROM USUARIO WHERE email=? AND rol='ADMIN'`, [createdId, 'admin@e2e.test']);
      expect(evidence.affectedRows).toBe(1);
    } finally {
      await connection.end();
    }
    await page.reload();
    await filterAdminByCode(initialName);
    await expect(
      adminProductCard(initialName).getByText('Precio base verificado', { exact: true }),
    ).toBeVisible();
    await visitor.evaluate('window.dispatchEvent(new Event("focus"))');
    await expect(visitor.getByText('USD 150.00', { exact: true })).toBeVisible();
    await visitor.goto(`${origin}/producto/${createdId}`);
    await expect(visitor.getByText('USD 150.00', { exact: true })).toBeVisible();

    // Comprobar persistencia en administración.
    await page.reload();

    const edit = page.getByRole('button', { name: `Editar ${initialName}`, exact: true });
    await edit.focus();
    await page.keyboard.press('Enter');

    await expect(field('Nombre del Producto')).toHaveValue(initialName);
    await expect(field('Código SKU')).toHaveValue(code);
    await expect(field('Importe base cargado')).toHaveValue('150');
    await expect(field('Stock')).toHaveValue('8');
    await expect(form.getByRole('combobox')).toHaveValue('1');

    // Cambiar el importe invalida la evidencia vinculada al valor anterior.
    await field('Nombre del Producto').fill(editedName);
    await field('Importe base cargado').fill('170');

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
    await expect(page.getByRole('status').filter({ hasText: /se actualizó correctamente/ })).toHaveText(
      `"${editedName}" se actualizó correctamente.`,
    );
    await expect(form).toHaveCount(0);
    await filterAdminByCode(editedName);
    await expect(
      adminProductCard(editedName).getByText('Precio pendiente de verificación', { exact: true }),
    ).toBeVisible();

    await visitor.evaluate('window.dispatchEvent(new Event("focus"))');
    await expect(visitor.getByText('Precio pendiente de verificación', { exact: true })).toBeVisible();
    await expect(visitor.getByText('USD 150.00', { exact: true })).toHaveCount(0);
    await expect(visitor.getByRole('button', { name: 'Agregar', exact: true })).toBeDisabled();

    // Comprobar que el catálogo ve nombre y estado actualizados.
    await checkPublicProduct(editedName);
    await expect(visitor.getByText('Precio pendiente de verificación', { exact: true })).toBeVisible();

    // Comprobar persistencia de la edición en administración.
    await page.reload();

    await page.getByRole('button', {
      name: `Editar ${editedName}`,
      exact: true,
    }).click();

    await expect(field('Nombre del Producto')).toHaveValue(editedName);
    await expect(field('Código SKU')).toHaveValue(code);
    await expect(field('Importe base cargado')).toHaveValue('170');
    await expect(field('Stock')).toHaveValue('8');
    await expect(form.getByRole('combobox')).toHaveValue('1');
  } finally {
    try {
      // Evitar que el producto altere las otras pruebas del catálogo.
      if (createdId && Number.isInteger(createdId)) {
        const cleanup = await page.request.patch(
          `/api/admin/productos/${createdId}/desactivar`,
          { headers: { Origin: new URL(page.url()).origin } },
        );
        expect(cleanup.ok()).toBe(true);
      }
    } finally {
      await visitorContext.close();
    }
  }
});
