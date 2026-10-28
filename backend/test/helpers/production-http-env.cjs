// Synthetic local proxy/origin fixtures only. These are never deployment defaults.
exports.productionHttpEnv = () => ({
  NODE_ENV: 'production', APP_PUBLIC_ORIGIN: 'https://browser.test',
  TRUSTED_PROXY_CIDRS: '127.0.0.1/32', HTTPS_TERMINATION: 'trusted-proxy',
  AUTH_RATE_STORE: 'memory', API_PROCESS_COUNT: '1', AUTH_LOGIN_LIMIT: '100',
  AUTH_LOGIN_WINDOW_MS: '60000', AUTH_REGISTER_LIMIT: '100', AUTH_REGISTER_WINDOW_MS: '60000',
});
