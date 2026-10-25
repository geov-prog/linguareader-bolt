import { isAndroid, isInstalledAndroidApp, isIOS } from "@/utils/platform";
import { backupFileName, type BackupEnv, type BackupKind } from "@/lib/backupName";

const INSTANCE_KEY = "lr-instance-id";

function nativePlatform(): "android" | "ios" | "" {
  if (typeof window === "undefined") return "";
  const cap = (
    window as Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }
  ).Capacitor;
  if (cap?.isNativePlatform?.() !== true) return "";
  const name = cap.getPlatform?.();
  return name === "android" || name === "ios" ? name : "";
}

/** Where this copy is running. Windows Chrome is `win`. A phone browser is `web`. */
export function backupEnv(): BackupEnv {
  if (isInstalledAndroidApp() || nativePlatform() === "android") return "apk";
  if (nativePlatform() === "ios") return "ios";
  if (typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent || "") && !isAndroid() && !isIOS()) {
    return "win";
  }
  return "web";
}

function newInstanceId(env: BackupEnv): string {
  const n = String(Math.floor(Math.random() * 90) + 10);
  if (env === "win") return `win-${n}`;
  const shortSide = typeof screen !== "undefined" ? Math.min(screen.width, screen.height) : 0;
  const tablet = shortSide >= 768 && !isInstalledAndroidApp();
  if (tablet && env === "web") return `tab${n}`;
  return `mob${n}`;
}

/** Stable tag for this browser or app, so two phones do not share one name. */
export function backupInstanceId(env = backupEnv()): string {
  try {
    const saved = localStorage.getItem(INSTANCE_KEY);
    if (saved && /^[a-z][a-z0-9-]{1,11}$/i.test(saved)) return saved;
    const id = newInstanceId(env);
    localStorage.setItem(INSTANCE_KEY, id);
    return id;
  } catch {
    return env === "win" ? "win-10" : "mob10";
  }
}

export function nextBackupFileName(type: BackupKind, date = new Date()): string {
  const env = backupEnv();
  return backupFileName(type, env, backupInstanceId(env), date, "json");
}
