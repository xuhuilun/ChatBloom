import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const server = createServer(async (incoming, outgoing) => {
  try {
    const abort = new AbortController();
    incoming.on('aborted', () => abort.abort());
    outgoing.on('close', () => { if (!outgoing.writableFinished) abort.abort(); });
    const requestUrl = new URL(incoming.url, `http://${incoming.headers.host || 'localhost'}`);
    const request = new Request(requestUrl, {
      method: incoming.method,
      signal: abort.signal,
      headers: incoming.headers,
      ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: incoming, duplex: 'half' } : {}),
    });
    let response = await handleApi(request, process.env);
    if (!response) {
      const file = files[requestUrl.pathname];
      if (!['GET', 'HEAD'].includes(incoming.method)) response = new Response('Method not allowed', { status: 405 });
      else if (!file) response = new Response('Not found', { status: 404 });
      else response = new Response(incoming.method === 'HEAD' ? null : await readFile(path.join(root, 'public', file[0])), { headers: { 'Content-Type': file[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    outgoing.end('服务暂时不可用，请稍后再试。');
  }
});
function option(name, fallback) {
  const position = process.argv.indexOf(name);
  return position >= 0 && process.argv[position + 1] ? process.argv[position + 1] : fallback;
}
const port = Number(option('--port', process.env.PORT || '3000'));
const host = option('--host', '0.0.0.0');
server.listen(port, host, () => console.log(`ChatBloom ready on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
