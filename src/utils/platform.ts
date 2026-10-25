/** Isolated engine checks. Prefer these over scattered user-agent tests. */

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iP(hone|ad|od)/i.test(ua)) return true;
  // iPadOS reports as Mac, but still has a touch screen.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

/** Installed Android app only. Chrome on a phone is never this. */
export function isAndroidAPK(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as Window & {
    androidBridge?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  };
  if (!win.androidBridge) return false;
  const cap = win.Capacitor;
  return cap?.isNativePlatform?.() === true && cap.getPlatform?.() === "android";
}

/** The installed Android app, even if the bridge object is not on window yet. */
export function isInstalledAndroidApp(): boolean {
  if (isAndroidAPK()) return true;
  if (typeof window === "undefined" || !isAndroid()) return false;
  const cap = (
    window as Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }
  ).Capacitor;
  if (cap?.isNativePlatform?.() === true && cap.getPlatform?.() === "android") return true;
  const href = window.location?.href || "";
  if (href.startsWith("capacitor:") || href.startsWith("file:")) return true;
  const host = window.location?.hostname || "";
  return host === "localhost" && /; wv\)/i.test(navigator.userAgent || "");
}

/** Chrome on an Android phone. Not the installed app, not iPhone. */
export function isAndroidChrome(): boolean {
  return isAndroid() && !isAndroidAPK();
}

/** Chrome on an iPhone. Safari is not this. */
export function isIOSChrome(): boolean {
  if (!isIOS() || typeof navigator === "undefined") return false;
  return /CriOS/i.test(navigator.userAgent || "");
}
