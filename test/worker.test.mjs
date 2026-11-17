import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
let worker;
before(async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'pipe' });
  worker = (await import('../dist/server/index.js')).default;
});

test('deployment includes each required static asset with browser security headers', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css'], ['/favicon.svg', 'image/svg+xml']]) {
    const response = await worker.fetch(new Request(`https://chatbloom.example${path}`));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('Content-Type').startsWith(type));
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.ok(response.headers.get('Content-Security-Policy').includes("script-src 'self'"));
    assert.ok((await response.text()).length > 50);
  }
});
test('deployment keeps secrets in runtime bindings, not in static assets', async () => {
  const env = { DEEPSEEK_API_KEY: 'runtime-only-secret-value' };
  const status = await worker.fetch(new Request('https://chatbloom.example/api/status'), env);
  assert.deepEqual(await status.json(), { configured: true, model: 'deepseek-flash' });
  for (const path of ['/', '/app.js']) {
    const response = await worker.fetch(new Request(`https://chatbloom.example${path}`), env);
    assert.ok(!(await response.text()).includes(env.DEEPSEEK_API_KEY));
  }
});
test('HEAD returns headers without body, and source files are not served', async () => {
  const response = await worker.fetch(new Request('https://chatbloom.example/', { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  for (const path of ['/README.md', '/.env.local', '/src/api.mjs', '/unknown']) {
    assert.equal((await worker.fetch(new Request(`https://chatbloom.example${path}`))).status, 404);
  }
});
test('the production artifact does not pretend to provide real chat without a key', async () => {
  const response = await worker.fetch(new Request('https://chatbloom.example/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello!' }] }) }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'NOT_CONFIGURED');
});
