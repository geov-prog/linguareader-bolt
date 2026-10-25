import { imageFromBlob } from "@/lib/browser";

export function cleanOcrText(raw: string): string {
  const lines = raw
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/[|]+/g, "I").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const kept = lines.filter((line) => {
    const letters = (line.match(/[\p{L}\p{N}]/gu) ?? []).length;
    const junk = (line.match(/[=_+~`^|]/g) ?? []).length;
    if (letters < 2) return false;
    if (junk > letters) return false;
    return letters / Math.max(1, line.length) >= 0.28;
  });
  return kept.join("\n").trim();
}

export function ocrScore(text: string): number {
  if (!text) return 0;
  const letters = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return letters * 2 + text.length;
}

function grayscaleContrast(data: Uint8ClampedArray): void {
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
    data[i] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const range = Math.max(40, max - min);
  for (let i = 0; i < data.length; i += 4) {
    let y = ((data[i]! - min) / range) * 255;
    y = (y - 128) * 1.45 + 128;
    if (y < 0) y = 0;
    else if (y > 255) y = 255;
    const ink = y > 188 ? 255 : y < 96 ? 0 : y;
    data[i] = data[i + 1] = data[i + 2] = ink;
    data[i + 3] = 255;
  }
}

export function prepareCanvas(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  crop = true,
): HTMLCanvasElement {
  const mx = crop ? Math.floor(srcW * 0.06) : 0;
  const my = crop ? Math.floor(srcH * 0.1) : 0;
  const cw = Math.max(8, srcW - mx * 2);
  const ch = Math.max(8, srcH - my * 2);
  const target = 1400;
  const scale = cw > target ? target / cw : cw < 720 ? 720 / cw : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(cw * scale));
  canvas.height = Math.max(8, Math.round(ch * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, mx, my, cw, ch, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  grayscaleContrast(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function videoToOcrCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (video.readyState < 2 || video.videoWidth < 16) return null;
  return prepareCanvas(video, video.videoWidth, video.videoHeight, true);
}

export async function blobToOcrCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const image = await imageFromBlob(blob);
  const canvas = prepareCanvas(image.source, image.width, image.height, false);
  image.close?.();
  return canvas;
}
