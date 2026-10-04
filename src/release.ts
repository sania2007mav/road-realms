export const APP_VERSION = __APP_VERSION__;
export const BUILD_HASH = __BUILD_HASH__;

export function versionLabel(): string {
  return `v${APP_VERSION} · ${BUILD_HASH}`;
}

let deferredInstall: BeforeInstallPromptEvent | null = null;

export function bootRelease(hooks: { onUpdate: () => void; onInstall: () => void }): void {
  const boot = document.querySelector<HTMLElement>('#boot');
  const bar = document.querySelector<HTMLElement>('#boot-bar > i');
  if (bar) bar.style.width = '100%';
  window.setTimeout(() => {
    if (boot) boot.hidden = true;
  }, 220);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    hooks.onInstall();
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  const base = import.meta.env.BASE_URL;
  void navigator.serviceWorker
    .register(`${base}sw.js`, { updateViaCache: 'none' })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) hooks.onUpdate();
        });
      });
      void reg.update();
    })
    .catch(() => {});
}

export async function acceptInstall(): Promise<void> {
  if (!deferredInstall) return;
  await deferredInstall.prompt();
  deferredInstall = null;
}

export function acceptUpdate(): void {
  const worker = navigator.serviceWorker?.controller;
  navigator.serviceWorker?.getRegistration().then((reg) => {
    reg?.waiting?.postMessage('skip-waiting');
  });
  if (worker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  } else {
    window.location.reload();
  }
}
