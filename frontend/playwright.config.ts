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

const profile = process.env.E2E_RECEIPTS ? 'receipts'
    : process.env.E2E_FER19 ? 'fer19-' + process.env.E2E_FER19
    : process.env.E2E_PRODUCTION_BUILD === '1' ? 'production' : '';

export default defineConfig({
    testDir: './e2e',
    ...(process.env.E2E_RECEIPTS
        ? { testMatch: '**/payment-receipts.real.spec.ts' }
        : process.env.E2E_FER19
        ? { testMatch: process.env.E2E_FER19 === 'production' ? '**/fer19/provenance.spec.ts' : '**/fer19/*.real.spec.ts' }
        : { testIgnore: ['**/fer19/**', '**/payment-receipts.real.spec.ts'] }),
    outputDir: profile ? 'test-results/' + profile : 'test-results',
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
        ['html', { open: 'never', ...(profile ? { outputFolder: 'playwright-report/' + profile } : {}) }],
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
