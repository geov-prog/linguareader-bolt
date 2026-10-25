import { cleanExtractedText, extname, looksLikeBinaryGarbage } from "@/services/documents/clean";
import { csvToText, fb2ToText, htmlToText, xmlToText } from "@/services/documents/html";
import { rtfToText } from "@/services/documents/rtf";
import { TextNormalizationService } from "@/utils/textNormalization";

export interface ConvertedDocument {
  text: string;
  encoding: string;
  formatLabel: string;
  titleHint?: string;
  chapters?: { title: string; charOffset: number }[];
  frontPages?: { title: string; html: string }[];
  warning?: string;
}

const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|heif|avif|mp3|wav|flac|aac|ogg|m4a|wma|mp4|mov|avi|mkv|webm|m4v|exe|dll|dmg|apk|ipa|iso)$/i;

const TEXT_EXT = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "log",
  "nfo",
  "csv",
  "tsv",
  "srt",
  "vtt",
  "lrc",
  "ass",
  "ssa",
  "tex",
  "rst",
  "org",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "json",
  "html",
  "htm",
  "xhtml",
  "xml",
  "fb2",
]);

const ZIP_EXT = new Set([
  "docx",
  "docm",
  "dotx",
  "dotm",
  "xlsx",
  "xlsm",
  "pptx",
  "pptm",
  "odt",
  "ott",
  "odp",
  "ods",
  "epub",
  "pages",
]);

export const DOCUMENT_ACCEPT = [
  ".txt",
  ".text",
  ".md",
  ".docx",
  ".doc",
  ".pdf",
  ".epub",
  ".html",
  ".htm",
  ".odt",
  ".rtf",
  ".json",
  ".fb2",
  ".xlsx",
  ".pptx",
  ".csv",
  ".xml",
  "text/plain",
  "text/*",
  "application/pdf",
  "application/epub+zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "*/*",
].join(",");

export function isRejectedMedia(file: File, bytes?: Uint8Array): boolean {
  if (MEDIA_EXT.test(file.name)) return true;
  if (file.type.startsWith("image/") || file.type.startsWith("audio/") || file.type.startsWith("video/")) {
    return true;
  }
  if (!bytes || bytes.length < 12) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    const tag = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (tag === "WEBP" || tag === "AVI " || tag === "WAVE") return true;
  }
  return false;
}

export function isSupportedFile(file: File): boolean {
  if (MEDIA_EXT.test(file.name)) return false;
  if (file.type.startsWith("image/") || file.type.startsWith("audio/") || file.type.startsWith("video/")) {
    return false;
  }
  return true;
}

function magicOf(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  if (bytes.length >= 5 && bytes[0] === 0x7b && bytes[1] === 0x5c && bytes[2] === 0x72 && bytes[3] === 0x74) {
    return "rtf";
  }
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return "ole";
  }
  for (let i = 0; i <= Math.min(bytes.length - 4, 512); i += 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && (bytes[i + 2] === 0x03 || bytes[i + 2] === 0x05 || bytes[i + 2] === 0x07)) {
      return "zip";
    }
  }
  return null;
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 512).trim().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || /<html[\s>]/.test(head);
}

function looksLikeXml(text: string): boolean {
  const head = text.slice(0, 256).trim();
  return head.startsWith("<?xml") || head.startsWith("<FictionBook") || /^<[a-zA-Z][\w:-]*[\s>]/.test(head);
}

export async function convertBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mime = "",
): Promise<ConvertedDocument> {
  const bytes = new Uint8Array(buffer);
  const ext = extname(fileName);
  const magic = magicOf(bytes);

  if (isRejectedMedia({ name: fileName, type: mime } as File, bytes)) {
    throw new Error("LinguaReader opens documents, not photos or media.");
  }

  if (!bytes.length) {
    throw new Error(
      `“${fileName || "That file"}” arrived empty. Pick it again from Files or Downloads, not a preview.`,
    );
  }

  if (magic === "pdf" || ext === "pdf" || mime === "application/pdf") {
    const { pdfToText } = await import("@/services/documents/pdf");
    const pdf = await pdfToText(buffer);
    if (!pdf.text) {
      throw new Error("This PDF looks like a scan. No selectable text was found to read aloud.");
    }
    return {
      text: pdf.text,
      encoding: "pdf",
      formatLabel: pdf.pages === 1 ? "PDF · 1 page" : `PDF · ${pdf.pages} pages`,
      titleHint: pdf.title,
    };
  }

  if (magic === "rtf" || ext === "rtf" || mime === "application/rtf" || mime === "text/rtf") {
    const decoded = TextNormalizationService.decode(buffer);
    return {
      text: rtfToText(decoded.text),
      encoding: "rtf",
      formatLabel: "Rich text",
    };
  }

  if (magic === "ole" || ext === "doc" || ext === "dot" || ext === "xls" || ext === "ppt" || ext === "wps") {
    const { oleToText } = await import("@/services/documents/oleOffice");
    const ole = await oleToText(buffer);
    return { text: ole.text, encoding: ole.encoding, formatLabel: ole.formatLabel };
  }

  const treatAsZip =
    magic === "zip" ||
    ZIP_EXT.has(ext) ||
    mime.includes("epub") ||
    mime.includes("officedocument") ||
    mime.includes("opendocument");

  if (treatAsZip) {
    try {
      const { zipContainerToText } = await import("@/services/documents/zipOffice");
      const zip = await zipContainerToText(buffer);
      return {
        text: zip.text,
        encoding: zip.encoding,
        formatLabel: zip.formatLabel,
        titleHint: zip.title,
        chapters: zip.chapters,
        frontPages: zip.frontPages,
      };
    } catch (err) {
      if (TEXT_EXT.has(ext)) {
        // fall through to text decode
      } else {
        try {
          const { oleToText } = await import("@/services/documents/oleOffice");
          const ole = await oleToText(buffer);
          if (ole.text) return { text: ole.text, encoding: ole.encoding, formatLabel: ole.formatLabel };
        } catch {
          // keep the zip error
        }
        throw err;
      }
    }
  }

  const decoded = TextNormalizationService.decode(buffer);
  const raw = decoded.text;

  if (ext === "fb2" || /<FictionBook\b/i.test(raw.slice(0, 800))) {
    return { text: fb2ToText(raw), encoding: decoded.encoding, formatLabel: "FictionBook" };
  }
  if (ext === "fodt" || ext === "fods" || ext === "fodp") {
    return { text: xmlToText(raw), encoding: decoded.encoding, formatLabel: "OpenDocument" };
  }
  if (ext === "html" || ext === "htm" || ext === "xhtml" || looksLikeHtml(raw)) {
    const hinted = TextNormalizationService.sniffHtmlCharset(buffer);
    const decodedHtml =
      hinted && hinted !== "auto" && hinted !== decoded.encoding
        ? TextNormalizationService.decodeAs(buffer, hinted)
        : decoded;
    return {
      text: htmlToText(decodedHtml.text),
      encoding: decodedHtml.encoding,
      formatLabel: "HTML",
    };
  }
  if (ext === "xml" || (looksLikeXml(raw) && ext !== "json")) {
    return { text: xmlToText(raw), encoding: decoded.encoding, formatLabel: "XML" };
  }
  if (ext === "csv") {
    return { text: csvToText(raw, ","), encoding: decoded.encoding, formatLabel: "CSV" };
  }
  if (ext === "tsv") {
    return { text: csvToText(raw, "\t"), encoding: decoded.encoding, formatLabel: "TSV" };
  }
  if (ext === "srt" || ext === "vtt" || ext === "lrc" || ext === "ass" || ext === "ssa") {
    const text = cleanExtractedText(
      raw
        .replace(/^\uFEFF/, "")
        .replace(/\d{2}:\d{2}:\d{2}[.,]\d{2,3}.*/g, "")
        .replace(/^WEBVTT.*$/gm, "")
        .replace(/<[^>]+>/g, ""),
    );
    return { text, encoding: decoded.encoding, formatLabel: "Subtitles" };
  }

  if (!TEXT_EXT.has(ext) && looksLikeBinaryGarbage(raw)) {
    throw new Error("That file is not a readable document. Try Word, PDF, EPUB, HTML, or text.");
  }

  const cleaned = cleanExtractedText(raw);
  if (!cleaned) {
    throw new Error("No readable text was found in that file.");
  }

  const label =
    ext === "md" || ext === "markdown"
      ? "Markdown"
      : ext === "json"
        ? "JSON"
        : ext
          ? ext.toUpperCase()
          : decoded.encoding.toUpperCase();

  return {
    text: cleaned,
    encoding: decoded.encoding,
    formatLabel: label,
  };
}

export async function convertFile(file: File): Promise<ConvertedDocument> {
  const buffer = await file.arrayBuffer();
  return convertBuffer(buffer, file.name, file.type);
}
