import { test, expect } from '@playwright/test';

for (const status of [200, 401]) {
    test(`obsolete logout verification ${status} cannot overwrite newer state`, async ({ page, context }) => {
        await page.goto('/login');
        await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
        await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
        await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
        const logout = page.getByRole('button', { name: 'Cerrar sesión', exact: true });
        await expect(logout).toBeVisible();
        let release!: () => void;
        let notify!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { notify = resolve; });
        let reads = 0;
        await page.route('**/api/auth/logout', route => route.fulfill({ status: 401, json: {} }));
        await page.route('**/api/auth/me', async route => {
            if (++reads > 1) return route.continue();
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            notify();
            await held;
            if (status === 200) await route.fulfill({ response });
            else await route.fulfill({ status: 401, json: {} });
        });
        await logout.click();
        await started;
        if (status === 200) await context.clearCookies();
        await page.route('**/api/logout-race-protected', route => route.fulfill({ status: 401, json: {} }));
        await page.evaluate(async () => {
            const source = '/src/services/api.ts';
            const { default: api } = await import(source);
            await api.get('/logout-race-protected').catch(() => {});
        });
        await expect(page).toHaveURL(/\/login\?redirect=/);
        if (status === 401) await page.evaluate(async () => {
            const source = '/src/stores/auth.ts';
            const { useAuthStore } = await import(source);
            await useAuthStore().fetchSession();
        });
        release();
        await expect.poll(() => page.evaluate(async () => {
            const source = '/src/stores/auth.ts';
            return (await import(source)).useAuthStore().loggingOut;
        })).toBe(false);
        expect(await page.evaluate(async () => {
            const source = '/src/stores/auth.ts';
            return (await import(source)).useAuthStore().isAuthenticated;
        })).toBe(status === 401);
        expect((await page.request.get('/api/auth/me')).status()).toBe(status === 200 ? 401 : 200);
    });
}
test('unavailable me shows retry instead of assuming expiry', async ({ page }) => {
    await page.route('**/api/auth/me', r => r.fulfill({ status: 500, json: { message: 'Unavailable' } }));
    await page.goto('/login');
    await expect(page.getByRole('alert')).toContainText('No se pudo verificar la sesión');
    await page.unroute('**/api/auth/me');
    await page.getByRole('button', { name: 'Reintentar verificación de sesión' }).click();
    await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
});
for (const email of ['admin@e2e.test', 'cliente@e2e.test'])
    for (const failure of ['http500', 'http403', 'network']) {
        test(email + ': logout ' + failure + ' preserves session and permits retry', async ({ page }) => {
            await page.goto('/login');
            await page.getByLabel('Email', { exact: true }).fill(email);
            await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
            await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
            const logout = page.getByRole('button', { name: 'Cerrar sesión', exact: true });
            await expect(logout).toBeVisible();
            const destination = new URL(page.url()).pathname;
            await page.route('**/api/auth/logout', r => failure === 'network' ? r.abort() : r.fulfill({ status: failure === 'http403' ? 403 : 500, json: { message: 'Error' } }));
            await logout.click();
            await expect(page.getByRole('alert')).toContainText('No se pudo cerrar la sesión');
            expect(new URL(page.url()).pathname).toBe(destination);
            expect((await page.context().cookies()).some(c => c.name === 'jwt_token')).toBe(true);
            const me = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/me' && r.status() === 200);
            await page.reload();
            await me;
            await expect(logout).toBeVisible();
            expect(new URL(page.url()).pathname).toBe(destination);
            await page.unroute('**/api/auth/logout');
            await logout.click();
            await expect(page).toHaveURL(/\/login$/);
            await page.reload();
            await expect(page).toHaveURL(/\/login$/);
        });
    }
test('double click sends one request; expired me returns 401', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    const button = page.getByRole('button', { name: 'Cerrar sesión', exact: true });
    await expect(button).toBeVisible();
    let release!: () => void;
    const held = new Promise<void>(r => release = r);
    let calls = 0;
    await page.route('**/api/auth/logout', async (r) => { calls++; await held; await r.continue(); });
    await button.evaluate((el: {
        click(): void;
    }) => { el.click(); el.click(); });
    await expect(page.getByRole('button', { name: 'Saliendo...', exact: true })).toBeDisabled();
    await expect.poll(() => calls).toBe(1);
    release();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('admin@e2e.test');
    await page.getByLabel(/^Contraseña/).fill('E2eLocal-214!');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(button).toBeVisible();
    const cookie = (await page.context().cookies()).find(c => c.name === 'jwt_token')!;
    await page.context().addCookies([{ ...cookie, value: 'expired-session-fixture' }]);
    const me = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/me' && r.status() === 401);
    await page.reload();
    await me;
    await expect(page).toHaveURL(/\/login\?redirect=/);
});
