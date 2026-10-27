import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;

if (!baseURL || process.env.E2E_ISOLATED !== '1') {
    throw new Error(
        'Las E2E deben iniciarse mediante el ejecutor del entorno aislado.',
    );
}

const target = new URL(baseURL);

if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') {
    throw new Error('Las E2E solo pueden ejecutarse contra el servidor local aislado.');
}

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: Boolean(process.env.CI),
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    reporter: [
        ['list'],
        ['html', { open: 'never' }],
    ],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});