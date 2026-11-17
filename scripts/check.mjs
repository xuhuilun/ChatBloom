import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'scripts', 'test', 'public']) {
  for (const entry of await readdir(dir)) {
    if (!/\.(mjs|js)$/.test(entry)) continue;
    const check = spawnSync(process.execPath, ['--check', `${dir}/${entry}`], { stdio: 'inherit' });
    if (check.status !== 0) process.exit(check.status || 1);
  }
}
console.log('JavaScript syntax checks passed.');
