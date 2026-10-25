import { cleanExtractedText } from "@/services/documents/clean";

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

function textItemsToString(items: Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>): string {
  let out = "";
  let lastY: number | null = null;
  for (const item of items) {
    const str = item.str ?? "";
    const y = item.transform?.[5];
    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2.2) {
      if (!out.endsWith("\n")) out += "\n";
    } else if (out && !out.endsWith("\n") && !out.endsWith(" ") && str && !str.startsWith(" ")) {
      const prev = out[out.length - 1];
      const next = str[0];
      const cjk = (ch?: string) => !!ch && /[\u3400-\u9fff]/.test(ch);
      if (!(cjk(prev) && cjk(next))) out += " ";
    }
    out += str;
    if (item.hasEOL && !out.endsWith("\n")) out += "\n";
    if (y !== undefined) lastY = y;
  }
  return out;
}

export async function pdfToText(buffer: ArrayBuffer): Promise<{ text: string; pages: number; title?: string }> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(buffer.slice(0));
  const loading = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    useWasm: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });
  const doc = await loading.promise;
  const parts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = textItemsToString(content.items as Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>);
    if (pageText.trim()) parts.push(pageText);
  }
  let title: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: string } | undefined;
    const rawTitle = info?.Title?.trim();
    if (rawTitle && !/^untitled$/i.test(rawTitle)) title = rawTitle;
  } catch {
    // metadata is optional
  }
  const text = cleanExtractedText(parts.join("\n\n"));
  return { text, pages: doc.numPages, title };
}
