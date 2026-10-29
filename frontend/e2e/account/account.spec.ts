import { test, expect } from '@playwright/test';
for (const role of ['cliente', 'admin', 'visitor']) {
    test(`account routes and real identity: ${role}`, async ({ page }) => {
        const missing: string[] = [];
        page.on('request', request => {
            if (/\/api\/(cliente\/me|pedidos)(?:\?|$)/.test(request.url())) missing.push(request.url());
        });
        let session: { nombre: string; email: string } | undefined;
        if (role !== 'visitor') {
            await page.goto('/login');
            await page.getByLabel('Email', { exact: true }).fill(`${role}@e2e.test`);
            await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
            await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
            await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
            session = (await (await page.request.get('/api/auth/me')).json()).user;
        }
        await page.goto('/mi-cuenta');
        if (role === 'cliente') {
            await expect(page.getByRole('heading', { name: 'Mis datos', exact: true })).toBeVisible();
            await expect(page.locator('dd')).toHaveText([session!.nombre, session!.email]);
            await expect(page.getByText('Teléfono', { exact: true })).toHaveCount(0);
            await page.getByRole('link', { name: 'Historial de pedidos', exact: true }).click();
            await expect(page.getByRole('status')).toContainText('no está disponible');
            await expect(page.getByText('Todavía no hiciste ningún pedido.')).toHaveCount(0);
            await page.reload();
            await expect(page.getByRole('status')).toContainText('no está disponible');
        } else {
            await expect(page).toHaveURL(role === 'admin' ? /\/acceso-denegado$/ : /\/login\?redirect=/);
            await expect(page.locator('dd')).toHaveCount(0);
        }
        await page.goto('/mi-cuenta/pedidos');
        if (role === 'cliente') await expect(page.getByRole('status')).toContainText('no está disponible');
        else await expect(page).toHaveURL(role === 'admin' ? /\/acceso-denegado$/ : /\/login\?redirect=/);
        expect(missing).toEqual([]);
    });
}
