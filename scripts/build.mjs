import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const assets = {};
for (const [url, [file, type]] of Object.entries(files)) {
  assets[url] = { body: await readFile(path.join(root, 'public', file), 'utf8'), type };
}
const api = await readFile(path.join(root, 'src/api.mjs'), 'utf8');
const worker = await readFile(path.join(root, 'src/worker.mjs'), 'utf8');
const output = worker.replace("import { handleApi } from './api.mjs';", api).replace('globalThis.__CHATBLOOM_ASSETS__ ?? {}', JSON.stringify(assets));
const directory = path.join(root, 'dist/server');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'index.js'), output);
console.log(`Built dist/server/index.js (${Buffer.byteLength(output)} bytes, no external runtime dependencies)`);
