// Simulate the same-origin browser contract in existing Node HTTP tests. Do not
// patch global fetch: tests of missing/untrusted headers use native fetch.
exports.fetchFromBrowser = (url, init = {}) => {
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(init.method ?? 'GET') && !headers.has('Origin'))
    headers.set('Origin', process.env.APP_PUBLIC_ORIGIN);
  return fetch(url, { ...init, headers });
};
