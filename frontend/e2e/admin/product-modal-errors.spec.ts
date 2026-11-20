import { test, expect, type Locator, type Page } from '@playwright/test';

const widths = [320, 360, 390, 768, 1024, 1280];
const longName = 'Producto ' + 'N'.repeat(190);
const longSku = 'S'.repeat(100);
const list = /\/api\/admin\/productos\?/;

async function login(page: Page) {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

async function mockLongProduct(page: Page) {
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
}

async function openEdit(page: Page) {
    await page.goto('/admin/productos?busqueda=E2E-02');
    await page.getByRole('button', { name: `Editar ${longName}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
}

const field = (dialog: Locator, label: string) => dialog
    .locator('form').locator('label').filter({ hasText: label })
    .locator('xpath=following-sibling::input[1]');

async function expectAlertFits(alert: Locator, width: number, textSelector: 'span' | 'p') {
    await alert.scrollIntoViewIfNeeded();
    const metrics = await alert.evaluate((el, selector) => {
        const text = el.querySelector(selector) as typeof el;
        const button = el.querySelector('button') as typeof el;
        const dialog = el.closest('dialog')!;
        const panel = dialog.querySelector(':scope > div')!;
        const alertRect = el.getBoundingClientRect();
        const textRect = text.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const view = el.ownerDocument.defaultView!;
        const hit = el.ownerDocument.elementFromPoint(
            buttonRect.left + buttonRect.width / 2,
            buttonRect.top + buttonRect.height / 2,
        );
        return {
            docScroll: el.ownerDocument.documentElement.scrollWidth,
            alertClient: el.clientWidth,
            alertScroll: el.scrollWidth,
            textClient: text.clientWidth,
            textScroll: text.scrollWidth,
            alertLeft: alertRect.left,
            alertRight: alertRect.right,
            alertTop: alertRect.top,
            alertBottom: alertRect.bottom,
            textLeft: textRect.left,
            textRight: textRect.right,
            buttonLeft: buttonRect.left,
            buttonRight: buttonRect.right,
            buttonTop: buttonRect.top,
            buttonBottom: buttonRect.bottom,
            panelClient: panel.clientWidth,
            panelScroll: panel.scrollWidth,
            panelLeft: panelRect.left,
            panelRight: panelRect.right,
            panelTop: panelRect.top,
            panelBottom: panelRect.bottom,
            viewportWidth: view.innerWidth,
            viewportHeight: view.innerHeight,
            hit: hit === button || button.contains(hit),
        };
    }, textSelector);

    expect(metrics.docScroll, `documento a ${width}`).toBeLessThanOrEqual(width);
    expect(metrics.panelScroll, `panel a ${width}`).toBeLessThanOrEqual(metrics.panelClient + 1);
    expect(metrics.alertScroll, `alerta a ${width}`).toBeLessThanOrEqual(metrics.alertClient + 1);
    expect(metrics.textScroll, `texto a ${width}`).toBeLessThanOrEqual(metrics.textClient + 1);
    expect(metrics.panelLeft, `panel izquierdo a ${width}`).toBeGreaterThanOrEqual(0);
    expect(metrics.panelRight, `panel derecho a ${width}`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.panelTop, `panel superior a ${width}`).toBeGreaterThanOrEqual(0);
    expect(metrics.panelBottom, `panel inferior a ${width}`).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.alertLeft, `alerta izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.panelLeft - 1);
    expect(metrics.alertRight, `alerta derecha a ${width}`).toBeLessThanOrEqual(metrics.panelRight + 1);
    expect(metrics.textLeft, `texto izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.alertLeft - 1);
    expect(metrics.textRight, `texto derecha a ${width}`).toBeLessThanOrEqual(metrics.alertRight + 1);
    expect(metrics.buttonLeft, `botón izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.alertLeft - 1);
    expect(metrics.buttonRight, `botón derecha a ${width}`).toBeLessThanOrEqual(metrics.alertRight + 1);
    expect(metrics.buttonLeft, `botón en viewport a ${width}`).toBeGreaterThanOrEqual(0);
    expect(metrics.buttonRight, `botón en viewport a ${width}`).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.buttonTop, `botón arriba a ${width}`).toBeGreaterThanOrEqual(0);
    expect(metrics.buttonBottom, `botón abajo a ${width}`).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.hit, `botón clickeable a ${width}`).toBe(true);
}

async function expectInlineFits(error: Locator, width: number) {
    await error.scrollIntoViewIfNeeded();
    const metrics = await error.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const dialog = el.closest('dialog')!;
        const panel = dialog.querySelector(':scope > div')!;
        const panelRect = panel.getBoundingClientRect();
        return {
            docScroll: el.ownerDocument.documentElement.scrollWidth,
            client: el.clientWidth,
            scroll: el.scrollWidth,
            left: rect.left,
            right: rect.right,
            panelClient: panel.clientWidth,
            panelScroll: panel.scrollWidth,
            panelLeft: panelRect.left,
            panelRight: panelRect.right,
        };
    });

    expect(metrics.docScroll, `documento a ${width}`).toBeLessThanOrEqual(width);
    expect(metrics.panelScroll, `panel a ${width}`).toBeLessThanOrEqual(metrics.panelClient + 1);
    expect(metrics.scroll, `error inline a ${width}`).toBeLessThanOrEqual(metrics.client + 1);
    expect(metrics.left, `error inline izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.panelLeft - 1);
    expect(metrics.right, `error inline derecha a ${width}`).toBeLessThanOrEqual(metrics.panelRight + 1);
}

async function expectControlReachable(control: Locator, width: number) {
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    await expect(control).toBeFocused();
    const metrics = await control.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const dialog = el.closest('dialog')!;
        const panel = dialog.querySelector(':scope > div')!;
        const panelRect = panel.getBoundingClientRect();
        const view = el.ownerDocument.defaultView!;
        return {
            docScroll: el.ownerDocument.documentElement.scrollWidth,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            panelLeft: panelRect.left,
            panelRight: panelRect.right,
            panelTop: panelRect.top,
            panelBottom: panelRect.bottom,
            viewportWidth: view.innerWidth,
            viewportHeight: view.innerHeight,
        };
    });

    expect(metrics.docScroll, `documento a ${width}`).toBeLessThanOrEqual(width);
    expect(metrics.left, `control izquierda a ${width}`).toBeGreaterThanOrEqual(metrics.panelLeft - 1);
    expect(metrics.right, `control derecha a ${width}`).toBeLessThanOrEqual(metrics.panelRight + 1);
    expect(metrics.top, `control arriba a ${width}`).toBeGreaterThanOrEqual(metrics.panelTop - 1);
    expect(metrics.bottom, `control abajo a ${width}`).toBeLessThanOrEqual(metrics.panelBottom + 1);
    expect(metrics.left, `control en viewport a ${width}`).toBeGreaterThanOrEqual(0);
    expect(metrics.right, `control en viewport a ${width}`).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.top, `control en viewport a ${width}`).toBeGreaterThanOrEqual(0);
    expect(metrics.bottom, `control en viewport a ${width}`).toBeLessThanOrEqual(metrics.viewportHeight);
}

test('N-01 A: error backend de 160 caracteres se ajusta y se descarta con teclado', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    await page.setViewportSize({ width: 320, height: 800 });
    const dialog = await openEdit(page);
    const message = 'E'.repeat(160);
    await page.route('**/api/admin/productos/2', async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await route.fulfill({ status: 400, json: { message } });
    });

    const save = dialog.getByRole('button', { name: 'Guardar Cambios', exact: true });
    await save.click();
    const alert = dialog.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    await expect(alert.locator('span')).toHaveText(message);

    for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await expectAlertFits(alert, width, 'span');
    }

    await page.setViewportSize({ width: 320, height: 800 });
    const dismiss = alert.getByRole('button');
    await dismiss.scrollIntoViewIfNeeded();
    await dismiss.focus();
    await expect(dismiss).toBeFocused();
    await expectAlertFits(alert, 320, 'span');
    await page.keyboard.press('Enter');
    await expect(alert).toHaveCount(0);
    await expect(dialog).toBeVisible();
});

test('N-01 B: error 409 de SKU se ajusta y conserva el borrador y Guardar', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    await page.setViewportSize({ width: 320, height: 800 });
    const dialog = await openEdit(page);
    const message = 'K'.repeat(160);
    await page.route('**/api/admin/productos/2', async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await route.fulfill({ status: 409, json: { message } });
    });

    const name = field(dialog, 'Nombre del Producto');
    const code = field(dialog, 'Código SKU');
    const stock = field(dialog, 'Stock');
    const save = dialog.getByRole('button', { name: 'Guardar Cambios', exact: true });
    await name.fill('Producto editado E2E');
    await stock.fill('7');
    await save.click();

    const alert = dialog.getByRole('alert').filter({ hasText: message });
    const codeError = code.locator('xpath=following-sibling::p[1]');
    await expect(alert).toBeVisible();
    await expect(alert.locator('span')).toHaveText(message);
    await expect(codeError).toHaveText(message);
    await expect(name).toHaveValue('Producto editado E2E');
    await expect(stock).toHaveValue('7');
    await expect(save).toBeEnabled();

    for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await expectAlertFits(alert, width, 'span');
        await expectInlineFits(codeError, width);
        await expectControlReachable(save, width);
    }
});

test('N-01 C: error de categorías de 160 caracteres se ajusta y el reintento es alcanzable', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    const message = 'C'.repeat(160);
    await page.route('**/api/categorias', route => route.fulfill({
        status: 500,
        json: { message },
    }));
    await page.setViewportSize({ width: 320, height: 800 });
    const dialog = await openEdit(page);

    const alert = dialog.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    await expect(alert.locator('p')).toHaveText(message);
    const retry = alert.getByRole('button', { name: 'Reintentar', exact: true });
    await expect(retry).toBeVisible();

    for (const width of widths) {
        await page.setViewportSize({ width, height: 800 });
        await expectAlertFits(alert, width, 'p');
        await expectControlReachable(retry, width);
    }
});

test('N-02: el clic exterior y Escape no descartan cambios sin guardar', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = await openEdit(page);
    const name = field(dialog, 'Nombre del Producto');
    await name.fill('Borrador E2E sin guardar');

    // El clic sobre el fondo no cierra ni borra el borrador.
    await dialog.click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Borrador E2E sin guardar');
    const notice = dialog.getByRole('alert').filter({ hasText: 'no se pierden los datos' });
    await expect(notice).toBeVisible();

    // El aviso se mantiene legible y dentro del panel en móvil y escritorio.
    for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const metrics = await notice.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return {
                docScroll: el.ownerDocument.documentElement.scrollWidth,
                client: el.clientWidth,
                scroll: el.scrollWidth,
                left: rect.left,
                right: rect.right,
            };
        });
        expect(metrics.docScroll, `documento a ${width}`).toBeLessThanOrEqual(width);
        expect(metrics.scroll, `aviso a ${width}`).toBeLessThanOrEqual(metrics.client + 1);
        expect(metrics.left, `aviso izquierda a ${width}`).toBeGreaterThanOrEqual(0);
        expect(metrics.right, `aviso derecha a ${width}`).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // Escape tampoco descarta el borrador de forma inadvertida.
    await name.focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Borrador E2E sin guardar');
    await expect(notice).toBeVisible();

    // Cerrar es explícito: primero se cancela el descarte y luego se confirma.
    page.once('dialog', confirm => confirm.dismiss());
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Borrador E2E sin guardar');

    page.once('dialog', confirm => confirm.accept());
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
});

test('N-03: un error de guardado sigue visible tras un clic exterior y se descarta con teclado', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    await page.setViewportSize({ width: 360, height: 800 });
    const dialog = await openEdit(page);
    const message = 'No se pudo guardar el borrador del producto.';
    await page.route('**/api/admin/productos/2', async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await route.fulfill({ status: 400, json: { message } });
    });

    const name = field(dialog, 'Nombre del Producto');
    await name.fill('Borrador E2E con error');
    await dialog.getByRole('button', { name: 'Guardar Cambios', exact: true }).click();
    const alert = dialog.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();

    await dialog.click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeVisible();
    await expect(alert).toBeVisible();
    await expect(name).toHaveValue('Borrador E2E con error');
    await expect(dialog.getByRole('alert').filter({ hasText: 'no se pierden los datos' })).toBeVisible();

    const dismiss = alert.getByRole('button', { name: 'Descartar error', exact: true });
    await dismiss.focus();
    await expect(dismiss).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(alert).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Borrador E2E con error');
});

async function pressEscapeThrice(page: Page) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
}

test('N-04: Escape repetido no cierra un borrador sin autorización y el listado recupera sus acciones', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    await page.setViewportSize({ width: 360, height: 740 });
    const dialog = await openEdit(page);
    const name = field(dialog, 'Nombre del Producto');
    await name.fill('Borrador conservado tras Escape ×3');
    await name.focus();

    const scrollBefore = await page.evaluate('window.scrollY') as number;
    await pressEscapeThrice(page);

    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Borrador conservado tras Escape ×3');
    await expect(dialog.getByRole('alert').filter({ hasText: 'no se pierden los datos' })).toBeVisible();

    // El cierre explícito sigue disponible y respeta la confirmación.
    page.once('dialog', confirm => confirm.dismiss());
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Borrador conservado tras Escape ×3');

    page.once('dialog', confirm => confirm.accept());
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const edit = page.getByRole('button', { name: `Editar ${longName}`, exact: true });
    await expect(edit).toBeFocused();
    expect(await page.evaluate('window.scrollY') as number).toBe(scrollBefore);

    // Editar vuelve a abrir el modal con los datos del servidor.
    await edit.click();
    const reopened = page.getByRole('dialog');
    await expect(reopened).toBeVisible();
    await expect(field(reopened, 'Nombre del Producto')).toHaveValue(longName);
    await reopened.getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
    await expect(reopened).toHaveCount(0);

    // Nuevo Producto vuelve a abrir el alta.
    await page.getByRole('button', { name: '+ Nuevo Producto', exact: true }).click();
    const create = page.getByRole('dialog');
    await expect(create.getByRole('heading', { name: 'Crear Nuevo Producto', exact: true })).toBeVisible();
    await create.getByRole('button', { name: 'Cerrar formulario', exact: true }).click();
    await expect(create).toHaveCount(0);

    // Desactivar sigue disponible: la confirmación se abre y se puede cancelar.
    const deactivate = page.getByRole('button', { name: `Desactivar ${longName}`, exact: true });
    await expect(deactivate).toBeEnabled();
    page.once('dialog', confirm => confirm.dismiss());
    await deactivate.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(deactivate).toBeEnabled();
});

test('N-05: Escape repetido conserva un error pendiente y el aviso se limpia al revertir', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    await page.setViewportSize({ width: 360, height: 740 });
    const dialog = await openEdit(page);
    const name = field(dialog, 'Nombre del Producto');
    const originalName = await name.inputValue();
    const message = 'No se pudo guardar el producto por un conflicto de catálogo.';
    await page.route('**/api/admin/productos/2', async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await route.fulfill({ status: 400, json: { message } });
    });

    await name.fill('Borrador con error pendiente');
    await dialog.getByRole('button', { name: 'Guardar Cambios', exact: true }).click();
    const alert = dialog.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    await name.focus();

    await pressEscapeThrice(page);

    await expect(dialog).toBeVisible();
    await expect(alert).toBeVisible();
    await expect(name).toHaveValue('Borrador con error pendiente');

    // Descartar el error y revertir el cambio limpia el aviso de cierre.
    await alert.getByRole('button', { name: 'Descartar error', exact: true }).click();
    await expect(alert).toHaveCount(0);
    await name.fill(originalName);
    await expect(dialog.getByRole('alert').filter({ hasText: 'no se pierden los datos' })).toHaveCount(0);
    await expect(dialog).toBeVisible();

    // Sin cambios ni errores, Escape vuelve a cerrar de forma autorizada.
    await name.focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Editar ${longName}`, exact: true })).toBeFocused();
});

test('N-06: Escape repetido durante un guardado bloqueante no desincroniza el modal', async ({ page }) => {
    await login(page);
    await mockLongProduct(page);
    await page.setViewportSize({ width: 390, height: 800 });
    const dialog = await openEdit(page);
    const name = field(dialog, 'Nombre del Producto');

    let releaseRequest: (() => void) | undefined;
    let putRequests = 0;
    await page.route('**/api/admin/productos/2', async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        putRequests++;
        await new Promise<void>(resolve => { releaseRequest = resolve });
        await route.fulfill({
            status: 200,
            json: { id_producto: 2, nombre: 'Producto guardado durante Escape' },
        });
    });

    await name.fill('Producto guardado durante Escape');
    await dialog.getByRole('button', { name: 'Guardar Cambios', exact: true }).click();
    const saving = dialog.getByRole('button', { name: 'Guardando...', exact: true });
    await expect(saving).toBeDisabled();

    // «Guardando...» se pinta antes de que el PUT llegue a page.route: sin esta
    // sincronización, Escape puede ejecutarse antes de que exista la solicitud.
    await expect.poll(
        () => putRequests,
        { message: 'PUT del producto interceptado' },
    ).toBe(1);

    try {
        await pressEscapeThrice(page);

        await expect(dialog).toBeVisible();
        await expect(name).toHaveValue('Producto guardado durante Escape');
        expect(putRequests).toBe(1);
    } finally {
        // Librar la solicitud retenida aunque falle una aserción.
        releaseRequest!();
    }

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Producto guardado durante Escape', { exact: false })).toBeVisible();
    expect(putRequests).toBe(1);
});
