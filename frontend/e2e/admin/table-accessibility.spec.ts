import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
}
const list = /\/api\/admin\/productos\?/;
const search = (page: Page) => page.getByRole('textbox', { name: 'Buscar productos por nombre o SKU' });
const field = (page: Page, label: string) => page.getByRole('dialog').locator('label').filter({ hasText: label }).locator('xpath=following-sibling::input[1]');
test('P1: teclado contiene la edición y URL y payload pertenecen al borrador', async ({ page }) => {
    await login(page);
    await page.goto('/admin/productos?busqueda=Producto%20E2E%200');
    const edit3 = page.getByRole('button', { name: 'Editar Producto E2E 03', exact: true });
    let writes = 0;
    page.on('request', r => { if (r.method() === 'PUT' && r.url().includes('/admin/productos/'))
        writes++; });
    await edit3.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(field(page, 'Nombre del Producto')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveAccessibleName('Editar Producto #3');
    await expect(field(page, 'Nombre del Producto')).toHaveValue('Producto E2E 03');
    expect(await page.evaluate<boolean>("document.activeElement?.closest('dialog') !== null")).toBe(true);
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press(i < 10 ? 'Tab' : 'Shift+Tab');
        expect(await page.evaluate<boolean>("document.activeElement?.closest('dialog') !== null")).toBe(true);
    }
    await dialog.getByRole('button', { name: 'Cancelar' }).focus();
    await page.keyboard.press('Space');
    await expect(edit3).toBeFocused();
    expect(writes).toBe(0);
    const edit2 = page.getByRole('button', { name: 'Editar Producto E2E 02', exact: true });
    await edit2.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveAccessibleName('Editar Producto #2');
    await expect(field(page, 'Nombre del Producto')).toHaveValue('Producto E2E 02');
    await field(page, 'Nombre del Producto').fill('Auditoría producto 2');
    const captured = page.waitForRequest(r => r.method() === 'PUT' && r.url().endsWith('/api/admin/productos/2'));
    await page.route('**/api/admin/productos/2', r => r.fulfill({ status: 200, json: {} }), { times: 1 });
    await dialog.getByRole('button', { name: 'Guardar Cambios' }).focus();
    await page.keyboard.press('Enter');
    const request = await captured;
    expect(new URL(request.url()).pathname).toBe('/api/admin/productos/2');
    expect(request.postDataJSON()).toMatchObject({ nombre: 'Auditoría producto 2', codigo: 'E2E-02', stock: 30 });
    await expect(dialog).toHaveCount(0);
    await expect(edit2).toBeFocused();
    expect(writes).toBe(1);
});
test('P2: guardar fuera del filtro y reconciliar devuelven foco estable', async ({ page }) => {
    await login(page);
    await page.goto('/admin/productos?busqueda=Producto%20E2E%2002');
    const endpoint = '/api/admin/productos/2';
    try {
        const edit = page.getByRole('button', { name: 'Editar Producto E2E 02', exact: true });
        await edit.focus();
        await page.keyboard.press('Enter');
        await field(page, 'Nombre del Producto').fill('Auditoría temporal');
        await page.getByRole('button', { name: 'Guardar Cambios' }).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByText('No se encontraron productos.')).toBeVisible();
        await expect(search(page)).toBeFocused();
    }
    finally {
        expect((await page.request.put(endpoint, { headers: { Origin: new URL(page.url()).origin }, data: { nombre: 'Producto E2E 02' } })).status()).toBe(200);
    }
    await search(page).fill('E2E-02');
    const action = page.getByRole('button', { name: 'Desactivar Producto E2E 02' });
    await expect(action).toBeEnabled();
    await page.route('**' + endpoint + '/desactivar', r => r.fulfill({ status: 502, json: { message: 'Incierto' } }), { times: 1 });
    await action.focus();
    page.once('dialog', d => d.accept());
    await page.keyboard.press('Enter');
    const reload = page.getByRole('button', { name: 'Recargar listado' });
    await expect(reload).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(action).toBeEnabled();
    await expect(search(page)).toBeFocused();
});
test('P2/P3: acciones completas con Tab y Shift+Tab y errores sin overflow', async ({ page }) => {
    await login(page);
    await page.route(list, async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.data[0] = { ...data.data[0], nombre: 'Producto ' + 'N'.repeat(190), codigo: 'S'.repeat(100), categoria_nombre: null, imagen: null, precio: null };
        await route.fulfill({ response, json: data });
    });
    await page.goto('/admin/productos?busqueda=E2E-02');
    const region = page.getByRole('region', { name: 'Tabla desplazable de productos' });
    const controls = region.getByRole('button');
    for (const width of [320, 360, 390, 768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await region.evaluate(el => { el.scrollLeft = 0; });
        await region.focus();
        for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Tab']) {
            await page.keyboard.press(key);
            const metrics = await region.evaluate(el => {
                const button = el.ownerDocument.activeElement!.getBoundingClientRect();
                const bounds = el.getBoundingClientRect();
                return { left: button.left - bounds.left, right: bounds.right - button.right, page: el.ownerDocument.documentElement.scrollWidth };
            });
            expect(metrics.left).toBeGreaterThanOrEqual(4);
            expect(metrics.right).toBeGreaterThanOrEqual(4);
            expect(metrics.page).toBeLessThanOrEqual(width);
        }
        await expect(controls.last()).toBeFocused();
    }
    await page.unroute(list);
    await page.route(list, r => r.fulfill({ status: 500, json: { message: 'X'.repeat(160) } }), { times: 1 });
    await search(page).fill('E2E-03');
    await expect(page.getByRole('alert')).toContainText('X'.repeat(160));
    for (const width of [320, 360, 390, 768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        expect(await page.evaluate<number>('document.documentElement.scrollWidth')).toBeLessThanOrEqual(width);
    }
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(region).toBeVisible();
    await search(page).fill('SKU-SIN-RESULTADO-341');
    await expect(page.getByText('No se encontraron productos.')).toBeVisible();
});
