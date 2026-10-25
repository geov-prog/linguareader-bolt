export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const ios = "standalone" in window.navigator && Boolean((window.navigator as { standalone?: boolean }).standalone);
  return Boolean(media || ios);
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  const { registerSW } = await import("virtual:pwa-register");
  registerSW({
    immediate: true,
    onRegisteredSW(swUrl) {
      if (import.meta.env.DEV) {
        console.info("[LinguaReader] Service worker ready", swUrl);
      }
    },
  });
}
