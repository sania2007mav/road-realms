import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, root));
    else out.push(relative(root, path).split('\\').join('/'));
  }
  return out;
}

function serviceWorker(): Plugin {
  let outDir = 'dist';
  let base = '/road-realms/';
  return {
    name: 'road-realms-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      base = config.base;
    },
    closeBundle() {
      if (base !== '/road-realms/') return;
      const files = walk(outDir).filter((file) => file !== 'sw.js');
      const version = `${pkg.version}-${gitHash()}`;
      const assets = files.map((file) => `${base}${file}`);
      const source = `const VERSION = ${JSON.stringify(version)};
const BASE = ${JSON.stringify(base)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (!url.pathname.startsWith(BASE)) return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(BASE + 'index.html'));
    }),
  );
});
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
`;
      writeFileSync(join(outDir, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  base: '/road-realms/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_HASH__: JSON.stringify(gitHash()),
  },
  plugins: [serviceWorker()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
