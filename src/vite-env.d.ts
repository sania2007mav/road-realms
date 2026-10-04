/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_HASH__: string;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
