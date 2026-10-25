/// <reference types="vite-plugin-pwa/client" />

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}

interface LinguaDesktopApi {
  platform: string;
  version: string;
  speak: (opts: { text: string; voice: string; rate: number; pitch: string }) => Promise<{ mime: string; b64: string }>;
}

interface Window {
  linguaDesktop?: LinguaDesktopApi;
}
