import type { FirebaseApp } from 'firebase/app';

/** Пустая строка — App Check не подключается. Ключ reCAPTCHA v3 включает его. */
export const appCheckSiteKey = '';

export const OFFLINE_NOTE =
  'Сеть сейчас недоступна. Одиночная игра и кампания работают без подключения.';

export function friendlyNetError(err: unknown, fallback: string): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE_NOTE;
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/auth\/network-request-failed|unavailable|deadline-exceeded|failed to fetch|networkerror|offline|etimedout/i.test(`${code} ${message}`)) {
    return OFFLINE_NOTE;
  }
  return message || fallback;
}

export async function enableAppCheck(app: FirebaseApp): Promise<void> {
  if (!appCheckSiteKey) return;
  const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const firebaseConfig = {
  apiKey: 'AIzaSyBsQFRMhv9O6pKeUvbGl7PzvTYuZ4ohvuo',
  authDomain: 'road-realms-eu7k2.firebaseapp.com',
  databaseURL: 'https://road-realms-eu7k2-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'road-realms-eu7k2',
  storageBucket: 'road-realms-eu7k2.firebasestorage.app',
  messagingSenderId: '448095042622',
  appId: '1:448095042622:web:9220582e795e317cf4a56f',
};
