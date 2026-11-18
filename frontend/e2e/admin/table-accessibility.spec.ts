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
test('P2-01/P2-02: datos extremos sin overflow global ni etiquetas fragmentadas', async ({ page }) => {
    await login(page);
    const longName = 'Producto ' + 'N'.repeat(190);
    const longSku = 'S'.repeat(100);
    await page.route(list, async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        data.data[0] = {
            ...data.data[0],
            nombre: longName,
            codigo: longSku,
            categoria_nombre: 'Categoría E2E de prueba',
            precio: 12345.67,
            activo: true,
            imagen: null,
        };
        await route.fulfill({ response, json: data });
    });
    await page.goto('/admin/productos?busqueda=E2E-02');
    const region = page.getByRole('region', { name: 'Tabla desplazable de productos' });
    const edit = region.getByRole('button', { name: `Editar ${longName}`, exact: true });
    const status = region.getByRole('button', { name: `Desactivar ${longName}`, exact: true });
    await expect(edit).toBeEnabled();
    await expect(status).toBeEnabled();
    await expect(region.getByText('Activo', { exact: true })).toBeVisible();
    await expect(region.getByText('Categoría E2E de prueba', { exact: true })).toBeVisible();
    await expect(region.getByText('12,345.67', { exact: true })).toBeVisible();

    // Semántica de tabla y etiqueta accesible del SKU preservadas.
    await expect(page.getByRole('table')).toHaveCount(1);
    await expect(page.locator('table caption')).toHaveText('Productos del catálogo');
    await expect(page.getByRole('columnheader')).toHaveCount(7);
    await expect(page.getByRole('rowheader', { name: longName })).toHaveCount(1);
    await expect(page.locator('tbody .sr-only').first()).toHaveText('SKU: ');
    await expect(region).toHaveAttribute('aria-describedby', 'admin-products-scroll');

    for (const width of [320, 360, 390, 768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await region.evaluate(el => { el.scrollLeft = 0; });

        // 1. La página no desarrolla overflow horizontal global.
        expect(await page.evaluate<number>('document.documentElement.scrollWidth')).toBeLessThanOrEqual(width);
        expect(await page.evaluate<number>('document.body.scrollWidth')).toBeLessThanOrEqual(width);

        // El texto oculto del SKU queda contenido por la región posicionada.
        const skuLabel = await region.evaluate(el => {
            const hidden = el.querySelector('tbody .sr-only') as typeof el;
            const parent = hidden.offsetParent;
            return {
                offsetParentInsideRegion: parent === el || (parent !== null && el.contains(parent)),
            };
        });
        expect(skuLabel.offsetParentInsideRegion).toBe(true);

        // 2. El desplazamiento horizontal es interno y llega a todas las columnas.
        const overflow = await region.evaluate(el => ({
            overflowX: el.ownerDocument.defaultView!.getComputedStyle(el).overflowX,
            client: el.clientWidth,
            scroll: el.scrollWidth,
            page: el.ownerDocument.documentElement.scrollWidth,
        }));
        expect(overflow.overflowX).toBe('auto');
        expect(overflow.page).toBeLessThanOrEqual(width);
        if (width < 1280) expect(overflow.scroll).toBeGreaterThan(overflow.client);
        const reached = await region.evaluate(el => {
            el.scrollLeft = el.scrollWidth;
            const bounds = el.getBoundingClientRect();
            const last = el.querySelector('tbody tr:last-child td:last-child button:last-child')!.getBoundingClientRect();
            return {
                scrollLeft: el.scrollLeft,
                max: el.scrollWidth - el.clientWidth,
                lastRight: last.right,
                regionRight: bounds.right,
                page: el.ownerDocument.documentElement.scrollWidth,
            };
        });
        expect(reached.scrollLeft).toBeGreaterThanOrEqual(reached.max - 1);
        expect(reached.lastRight).toBeLessThanOrEqual(reached.regionRight + 1);
        expect(reached.page).toBeLessThanOrEqual(width);

        // 3, 4 y 5. Tab y Shift+Tab dejan cada control visible, enfocado, con foco completo y sin fragmentar.
        const geometry = () => region.evaluate(el => {
            const button = el.ownerDocument.activeElement as typeof el;
            const box = button.getBoundingClientRect();
            const bounds = el.getBoundingClientRect();
            const style = el.ownerDocument.defaultView!.getComputedStyle(button);
            const range = el.ownerDocument.createRange();
            range.selectNodeContents(button);
            const outlineWidth = parseFloat(style.outlineWidth);
            const outlineOffset = parseFloat(style.outlineOffset);
            return {
                text: button.textContent?.trim(),
                lines: range.getClientRects().length,
                width: box.width,
                height: box.height,
                leftGap: box.left - bounds.left,
                rightGap: bounds.right - box.right,
                outlineStyle: style.outlineStyle,
                outlineWidth,
                outlineOffset,
                outlineFits: box.left - outlineWidth - outlineOffset >= bounds.left
                    && box.right + outlineWidth + outlineOffset <= bounds.right,
                page: el.ownerDocument.documentElement.scrollWidth,
            };
        });
        const check = async (expected: string) => {
            const metrics = await geometry();
            expect(metrics.text).toBe(expected);
            expect(metrics.lines).toBe(1);
            expect(metrics.width).toBeGreaterThanOrEqual(56);
            expect(metrics.height).toBeLessThanOrEqual(48);
            expect(metrics.leftGap).toBeGreaterThanOrEqual(4);
            expect(metrics.rightGap).toBeGreaterThanOrEqual(4);
            expect(metrics.outlineStyle).not.toBe('none');
            expect(metrics.outlineWidth).toBeGreaterThanOrEqual(2);
            expect(metrics.outlineFits).toBe(true);
            expect(metrics.page).toBeLessThanOrEqual(width);
        };
        await region.evaluate(el => { el.scrollLeft = 0; });
        await region.focus();
        await page.keyboard.press('Tab');
        await expect(edit).toBeFocused();
        await check('Editar');
        await page.keyboard.press('Tab');
        await expect(status).toBeFocused();
        await check('Desactivar');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(status).toBeFocused();
        await check('Desactivar');
        await page.keyboard.press('Shift+Tab');
        await expect(edit).toBeFocused();
        await check('Editar');

        // 6. Los textos largos se ajustan dentro de su celda.
        const wrapping = await region.evaluate((el, name) => {
            const header = el.querySelector('tbody th') as typeof el;
            const skuCell = header.nextElementSibling as typeof el;
            const nameRange = el.ownerDocument.createRange();
            nameRange.selectNodeContents(header.querySelector('span')!);
            const skuRange = el.ownerDocument.createRange();
            skuRange.selectNodeContents(skuCell);
            return {
                nameFits: header.scrollWidth <= header.clientWidth + 1,
                skuFits: skuCell.scrollWidth <= skuCell.clientWidth + 1,
                nameLines: nameRange.getClientRects().length,
                skuLines: skuRange.getClientRects().length,
                name: header.textContent?.trim(),
            };
        }, longName);
        expect(wrapping.name).toBe(longName);
        expect(wrapping.nameFits).toBe(true);
        expect(wrapping.skuFits).toBe(true);
        expect(wrapping.nameLines).toBeGreaterThan(1);
        expect(wrapping.skuLines).toBeGreaterThan(1);
    }

    await page.unroute(list);
    await page.route(list, r => r.fulfill({ status: 500, json: { message: 'X'.repeat(160) } }), { times: 1 });
    await search(page).fill('E2E-03');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('X'.repeat(160));
    for (const width of [320, 360, 390, 768, 1024, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        // 7. El mensaje de 160 caracteres consecutivos se ajusta sin desbordar.
        expect(await page.evaluate<number>('document.documentElement.scrollWidth')).toBeLessThanOrEqual(width);
        const message = await alert.locator('p').evaluate(el => ({
            fits: el.scrollWidth <= el.clientWidth + 1,
        }));
        expect(message.fits).toBe(true);
    }
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(region).toBeVisible();
    await search(page).fill('SKU-SIN-RESULTADO-341');
    await expect(page.getByText('No se encontraron productos.')).toBeVisible();
});
