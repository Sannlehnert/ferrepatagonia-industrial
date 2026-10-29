import { test, expect } from '@playwright/test';

for (const mode of ['old', 'current']) {
    test(`${mode} protected 401 respects the current session generation`, async ({ page, context }) => {
        const login = async () => {
            if (!page.url().endsWith('/login')) await page.goto('/login');
            await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
            await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
            await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
            await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
        };
        await login();
        const destination = new URL(page.url()).pathname;
        const releases: Array<() => void> = [];
        await page.route('**/api/audit-protected/*', async route => {
            expect(route.request().headers()['sessiongeneration']).toBeUndefined();
            await new Promise<void>(resolve => { releases.push(resolve); });
            await route.fulfill({ status: 401, json: { message: 'Rejected request' } });
        });
        // Keep the real Axios interceptor and Pinia; control only delivery order.
        const responses = page.evaluate(async () => {
            const source = '/src/services/api.ts';
            const { default: api } = await import(source);
            await Promise.all([0, 1, 2].map(id => api.get(`/audit-protected/${id}`).catch(() => {})));
        });
        await expect.poll(() => releases.length).toBe(3);
        if (mode === 'old') {
            await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
            await expect(page).toHaveURL(/\/login$/);
            await login();
        } else {
            await context.clearCookies();
        }
        for (const index of [2, 0, 1]) releases[index]!();
        await responses;
        if (mode === 'old') {
            expect(new URL(page.url()).pathname).toBe(destination);
            expect((await page.request.get('/api/auth/me')).status()).toBe(200);
            await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
            await page.reload();
            await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
        } else {
            await expect(page).toHaveURL(/\/login\?redirect=/);
            expect((await page.request.get('/api/auth/me')).status()).toBe(401);
        }
        expect(await page.evaluate(async () => {
            const source = '/src/stores/auth.ts';
            return (await import(source)).useAuthStore().isAuthenticated;
        })).toBe(mode === 'old');
    });
}
