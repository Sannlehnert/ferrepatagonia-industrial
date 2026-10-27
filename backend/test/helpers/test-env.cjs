// Explicit test profile for regression volume. Limiters remain enabled; dedicated
// HTTP security tests use small quotas and raw fetch, including absent headers.
Object.assign(process.env, {
  NODE_ENV: 'test', APP_PUBLIC_ORIGIN: 'http://browser.test',
  TRUSTED_PROXY_CIDRS: 'none', AUTH_RATE_STORE: 'memory', API_PROCESS_COUNT: '1',
  AUTH_LOGIN_LIMIT: '100000', AUTH_REGISTER_LIMIT: '100000',
  AUTH_LOGIN_WINDOW_MS: '60000', AUTH_REGISTER_WINDOW_MS: '60000',
});
