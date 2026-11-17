import { handleApi } from './api.mjs';

// build.mjs injects the static asset map into the deployment entrypoint.
const ASSETS = globalThis.__CHATBLOOM_ASSETS__ ?? {};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
};

export default {
  async fetch(request, env = {}) {
    const api = await handleApi(request, env);
    if (api) return api;
    const path = new URL(request.url).pathname;
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const asset = ASSETS[path];
    if (!asset) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      headers: { ...SECURITY_HEADERS, 'Content-Type': asset.type, 'Cache-Control': 'no-cache' },
    });
  },
};
