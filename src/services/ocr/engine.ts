import { DEFAULT_SCAN_LANGS } from "@/services/ocr/langs";
import { blobToOcrCanvas, cleanOcrText } from "@/services/ocr/preprocess";

type ProgressFn = (message: string, pct: number) => void;

type TessWorker = {
  reinitialize: (langs?: string | string[]) => Promise<unknown>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (image: HTMLCanvasElement | Blob | File | string) => Promise<{ data: { text: string } }>;
};

let workerPromise: Promise<TessWorker> | null = null;
let activeLangs = "";

function statusLabel(status?: string): string {
  if (!status) return "Reading…";
  if (status.includes("loading language")) return "Saving language pack on this phone…";
  if (status.includes("initialized")) return "Ready…";
  if (status.includes("recognizing")) return "Reading the page…";
  return "Working…";
}

export async function warmupOcr(langs: string[], onProgress?: ProgressFn): Promise<void> {
  await getWorker(langs.length ? langs : DEFAULT_SCAN_LANGS, onProgress);
}

async function getWorker(langs: string[], onProgress?: ProgressFn): Promise<TessWorker> {
  const key = langs.slice().sort().join("+");
  const { createWorker } = await import("tesseract.js");
  if (!workerPromise) {
    onProgress?.("Installing the reader…", 5);
    workerPromise = createWorker(langs, 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (!onProgress) return;
        onProgress(statusLabel(m.status), Math.round((m.progress ?? 0) * 100));
      },
    }) as unknown as Promise<TessWorker>;
    const worker = await workerPromise;
    activeLangs = key;
    return worker;
  }
  const worker = await workerPromise;
  if (activeLangs !== key) {
    onProgress?.("Downloading language pack…", 12);
    await worker.reinitialize(langs);
    activeLangs = key;
  }
  return worker;
}

export async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  tessCodes: string[],
  onProgress?: ProgressFn,
  psm = "6",
): Promise<string> {
  const langs = tessCodes.length ? tessCodes : DEFAULT_SCAN_LANGS;
  const worker = await getWorker(langs, onProgress);
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  });
  onProgress?.("Reading the page…", 45);
  const result = await worker.recognize(canvas);
  return cleanOcrText(result.data.text || "");
}

export async function recognizeImage(
  image: Blob | HTMLCanvasElement,
  tessCodes: string[],
  onProgress?: ProgressFn,
): Promise<string> {
  const canvas = image instanceof HTMLCanvasElement ? image : await blobToOcrCanvas(image);
  const first = await recognizeCanvas(canvas, tessCodes, onProgress, image instanceof HTMLCanvasElement ? "7" : "6");
  if (ocrLooksWeak(first)) {
    const retry = await recognizeCanvas(canvas, tessCodes, undefined, "4");
    return retry.length > first.length ? retry : first;
  }
  return first;
}

function ocrLooksWeak(text: string): boolean {
  const letters = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return letters < 8;
}
