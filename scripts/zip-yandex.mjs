import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const stage = join(root, 'dist-yandex');
const zipPath = join(root, 'road-realms-yandex.zip');
const index = readFileSync(join(stage, 'index.html'), 'utf8');
if (index.includes('/road-realms/assets/')) {
  throw new Error('сборка Яндекса всё ещё ссылается на /road-realms/assets/');
}
rmSync(zipPath, { force: true });
execFileSync(
  'python3',
  [
    '-c',
    `
import os, zipfile
root = ${JSON.stringify(stage)}
out = ${JSON.stringify(zipPath)}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for dirpath, _, names in os.walk(root):
        for name in names:
            full = os.path.join(dirpath, name)
            z.write(full, os.path.relpath(full, root).replace('\\\\', '/'))
print(out)
`,
  ],
  { stdio: 'inherit' },
);
