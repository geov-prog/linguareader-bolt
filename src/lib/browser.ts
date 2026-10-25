import { isAndroid, isIOS } from "@/utils/platform";

export type VisualSurface = "desktop" | "mobile";

export function currentVisualSurface(): VisualSurface {
  if (typeof window === "undefined") return "desktop";
  if (isIOS() || isAndroid()) return "mobile";
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
  if (coarse && window.innerWidth < 900) return "mobile";
  return "desktop";
}

export function isIOSDevice(): boolean {
  return isIOS();
}

export function isAndroidDevice(): boolean {
  return isAndroid();
}

export type BrowserKind = "chrome" | "safari" | "firefox" | "edge" | "samsung" | "opera" | "other";

export function detectBrowser(): BrowserKind {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Edg\//i.test(ua)) return "edge";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/OPR\/|Opera/i.test(ua)) return "opera";
  if (/Firefox|FxiOS/i.test(ua)) return "firefox";
  if (/CriOS/i.test(ua)) return "chrome";
  if (isIOSDevice() || /Safari/i.test(ua) && !/Chrome|Chromium|Android/i.test(ua)) return "safari";
  if (/Chrome|Chromium|CriOS/i.test(ua)) return "chrome";
  return "other";
}

export function browserLabel(kind = detectBrowser()): string {
  switch (kind) {
    case "chrome":
      return "Chrome";
    case "safari":
      return "Safari";
    case "firefox":
      return "Firefox";
    case "edge":
      return "Edge";
    case "samsung":
      return "Samsung Internet";
    case "opera":
      return "Opera";
    default:
      return "this browser";
  }
}

export function isDesktopShell(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Electron/i.test(navigator.userAgent) || Boolean((window as Window & { linguaDesktop?: boolean }).linguaDesktop);
}

export type VideoCamera = { id: string; label: string };

export async function listVideoCameras(): Promise<VideoCamera[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput" && device.deviceId)
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label.trim() || `Camera ${index + 1}`,
      }));
  } catch {
    return [];
  }
}

export function watchVideoCameras(onChange: (cameras: VideoCamera[]) => void): () => void {
  let cancelled = false;
  const emit = async () => {
    if (cancelled) return;
    onChange(await listVideoCameras());
  };
  void emit();
  const media = navigator.mediaDevices;
  media?.addEventListener?.("devicechange", emit);
  return () => {
    cancelled = true;
    media?.removeEventListener?.("devicechange", emit);
  };
}

export function installHint(): string {
  if (isDesktopShell()) {
    return "You are in the Windows app.";
  }
  if (isIOSDevice()) {
    return "Safari or Chrome: tap Share, then Add to Home Screen.";
  }
  if (detectBrowser() === "firefox") {
    return "Firefox: tap the menu, then Install or Add to Home screen.";
  }
  if (detectBrowser() === "safari") {
    return "Safari: File → Add to Dock, or Share → Add to Home Screen.";
  }
  return "Use Install, or your browser menu → Install app / Add to Home screen.";
}

export async function openRearCamera(): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) {
    throw new Error("This browser cannot open the camera. Try Chrome, Safari, Firefox, or Edge.");
  }
  const cameras = await listVideoCameras();
  if (!cameras.length) {
    throw new Error("No camera found. Plug in a USB webcam, then try Scan again.");
  }
  const preferred = cameras[0]!.id;
  const tries: MediaStreamConstraints[] = [
    { audio: false, video: { deviceId: { exact: preferred }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ];
  let last: unknown;
  for (const constraints of tries) {
    try {
      return await media.getUserMedia(constraints);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Camera permission is needed.");
}

export async function imageFromBlob(blob: Blob): Promise<{
  width: number;
  height: number;
  source: CanvasImageSource;
  close?: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
    } catch {
      /* older Safari / Firefox */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not read that photo in this browser."));
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, source: img };
  } finally {
    URL.revokeObjectURL(url);
  }
}
