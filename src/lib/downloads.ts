import { APP_VERSION } from "@/lib/app-info";

export const ANDROID_APK_HREF = "/downloads/LinguaReader.apk";
export const GET_APP_HREF = "/get";
export const ANDROID_APK_NAME = `LinguaReader-${APP_VERSION}.apk`;

export function isNativeAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export async function openInstallFile(href: string, filename?: string): Promise<void> {
  try {
    const res = await fetch(href, { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error("missing");
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!isZip || type.includes("text/html")) {
      throw new Error("not-apk");
    }
    const blob = new Blob([buf], { type: "application/vnd.android.package-archive" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || href.split("/").pop() || "LinguaReader.apk";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    window.alert("The Android file is not ready on this page. Use this Grok preview, or wait for the next publish.");
  }
}
