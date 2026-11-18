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
