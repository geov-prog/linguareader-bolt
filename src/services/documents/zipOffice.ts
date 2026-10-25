import { cleanExtractedText, stripXmlTags } from "@/services/documents/clean";
import { htmlToText, xmlToText } from "@/services/documents/html";
import { pdfToText } from "@/services/documents/pdf";
import { TextNormalizationService } from "@/utils/textNormalization";

type JSZip = import("jszip");
type ZipObject = import("jszip").JSZipObject;

function normalizeZipPath(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function decodeHref(value: string): string {
  const trimmed = value.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed.replace(/%20/g, " ");
  }
}

function pathKey(name: string): string {
  return normalizeZipPath(decodeHref(name)).toLowerCase();
}

async function loadZip(buffer: ArrayBuffer): Promise<JSZip> {
  const JSZipMod = (await import("jszip")).default;
  const sliced = sliceToZip(buffer);
  try {
    return await JSZipMod.loadAsync(sliced);
  } catch {
    if (sliced !== buffer) return JSZipMod.loadAsync(buffer);
    throw new Error("That file looks damaged or is not a real Word/EPUB document.");
  }
}

function sliceToZip(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  const limit = Math.min(bytes.length - 4, 2048);
  for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && (bytes[i + 2] === 0x03 || bytes[i + 2] === 0x05 || bytes[i + 2] === 0x07)) {
      return i === 0 ? buffer : buffer.slice(i);
    }
  }
  return buffer;
}

function fileNames(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);
}

function findZipEntry(zip: JSZip, name: string): ZipObject | null {
  const wanted = [
    name,
    decodeHref(name),
    normalizeZipPath(name),
    normalizeZipPath(decodeHref(name)),
  ];
  for (const candidate of wanted) {
    const hit = zip.file(candidate);
    if (hit && !hit.dir) return hit;
  }
  const key = pathKey(name);
  const match = fileNames(zip).find((entry) => pathKey(entry) === key);
  return match ? zip.files[match] ?? null : null;
}

async function readDecoded(zip: JSZip, name: string): Promise<string | null> {
  const file = findZipEntry(zip, name);
  if (!file) return null;
  const buffer = await file.async("arraybuffer");
  return TextNormalizationService.decode(buffer).text;
}

async function readBuffer(zip: JSZip, name: string): Promise<ArrayBuffer | null> {
  const file = findZipEntry(zip, name);
  if (!file) return null;
  return file.async("arraybuffer");
}

function sortNumeric(a: string, b: string): number {
  const na = Number.parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10);
  const nb = Number.parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10);
  if (na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function looksLikeEpub(names: string[], mime: string): boolean {
  if (mime.toLowerCase().includes("epub")) return true;
  return names.some((n) => {
    const key = pathKey(n);
    return key === "meta-inf/container.xml" || key.endsWith(".opf");
  });
}

export async function zipContainerToText(
  buffer: ArrayBuffer,
): Promise<{ text: string; formatLabel: string; encoding: string; title?: string; chapters?: { title: string; charOffset: number }[]; frontPages?: { title: string; html: string }[] }> {
  const zip = await loadZip(buffer);
  const names = fileNames(zip);

  if (names.some((n) => pathKey(n) === "word/document.xml" || pathKey(n).startsWith("word/"))) {
    const word = await docxToText(buffer, zip);
    if (!word.text) {
      throw new Error("That Word file has no readable text. Try exporting it as .docx or PDF.");
    }
    return { ...word, formatLabel: "Word", encoding: "docx" };
  }
  if (names.some((n) => pathKey(n).startsWith("xl/"))) {
    return { text: await spreadsheetToText(buffer), formatLabel: "Excel", encoding: "xlsx" };
  }
  if (names.some((n) => pathKey(n).startsWith("ppt/"))) {
    return { text: await pptxToText(zip, names), formatLabel: "PowerPoint", encoding: "pptx" };
  }

  const mime = ((await readDecoded(zip, "mimetype")) ?? "").trim();
  if (names.some((n) => pathKey(n) === "content.xml") || mime.includes("opendocument")) {
    if (mime.includes("spreadsheet") || names.some((n) => pathKey(n).includes("xl/"))) {
      return { text: await odfToText(zip), formatLabel: "OpenDocument spreadsheet", encoding: "ods" };
    }
    if (mime.includes("presentation")) {
      return { text: await odfToText(zip), formatLabel: "OpenDocument slides", encoding: "odp" };
    }
    return { text: await odfToText(zip), formatLabel: "OpenDocument text", encoding: "odt" };
  }

  if (looksLikeEpub(names, mime)) {
    if (names.some((n) => pathKey(n) === "meta-inf/encryption.xml")) {
      throw new Error("This EPUB is locked (DRM). Export a copy without protection, or paste the text.");
    }
    const epub = await epubToText(zip);
    if (!epub.text) {
      throw new Error("That EPUB has no readable chapters. Try another export, or a PDF/Word copy.");
    }
    return { ...epub, formatLabel: "EPUB", encoding: "epub" };
  }

  const previewName =
    names.find((n) => /quicklook\/preview\.pdf$/i.test(n)) ?? names.find((n) => /preview\.pdf$/i.test(n));
  if (previewName || names.some((n) => n.endsWith(".iwa"))) {
    if (previewName) {
      const preview = await readBuffer(zip, previewName);
      if (preview) {
        const pdf = await pdfToText(preview);
        if (pdf.text) return { text: pdf.text, formatLabel: "Pages", encoding: "pages", title: pdf.title };
      }
    }
    throw new Error("That Pages file has no readable preview. Export it as PDF or Word and drop it again.");
  }

  const textFiles = names.filter((n) => /\.(txt|md|html?|xhtml|xml|csv|rtf|json)$/i.test(n));
  if (textFiles.length) {
    const parts: string[] = [];
    for (const name of textFiles.sort(sortNumeric)) {
      const raw = await readDecoded(zip, name);
      if (!raw) continue;
      const body = /\.x?html?/i.test(name) ? htmlToText(raw) : cleanExtractedText(raw);
      if (body) parts.push(textFiles.length > 1 ? `${name}\n${body}` : body);
    }
    const text = cleanExtractedText(parts.join("\n\n"));
    if (text) return { text, formatLabel: "Archive", encoding: "zip" };
  }

  throw new Error("That archive is not a readable document. Try Word, PDF, EPUB, or a text file.");
}

function mammothApi(mod: Record<string, unknown>): { extractRawText?: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value?: string }> } {
  const nested = mod.default as Record<string, unknown> | undefined;
  if (typeof mod.extractRawText === "function") return mod as never;
  if (nested && typeof nested.extractRawText === "function") return nested as never;
  return {};
}

async function docxToText(buffer: ArrayBuffer, zip: JSZip): Promise<{ text: string; title?: string }> {
  try {
    const mammothMod = (await import("mammoth")) as Record<string, unknown>;
    const mammoth = mammothApi(mammothMod);
    if (mammoth.extractRawText) {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      const text = cleanExtractedText(result.value ?? "");
      if (text) return { text };
    }
  } catch {
    // fall through to XML
  }
  const xml =
    (await readDecoded(zip, "word/document.xml")) ?? (await readDecoded(zip, "word/document2.xml"));
  if (!xml) throw new Error("That Word file is missing its document part.");
  const extras: string[] = [];
  for (const name of fileNames(zip)) {
    if (/word\/(header|footer|footnotes|endnotes|comments)[^/]*\.xml$/i.test(normalizeZipPath(name))) {
      const raw = await readDecoded(zip, name);
      if (raw) extras.push(stripXmlTags(raw));
    }
  }
  return { text: cleanExtractedText([stripXmlTags(xml), ...extras].join("\n\n")) };
}

async function spreadsheetToText(buffer: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const parts: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(workbook.SheetNames.length > 1 ? `${name}\n${csv}` : csv);
  }
  return cleanExtractedText(parts.join("\n\n"));
}

async function pptxToText(zip: JSZip, names: string[]): Promise<string> {
  const slides = names.filter((n) => /ppt\/slides\/slide\d+\.xml$/i.test(n)).sort(sortNumeric);
  const notes = names.filter((n) => /ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(n)).sort(sortNumeric);
  const parts: string[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const xml = await readDecoded(zip, slides[i]!);
    const body = xml ? xmlToText(xml) : "";
    const noteXml = notes[i] ? await readDecoded(zip, notes[i]!) : null;
    const note = noteXml ? xmlToText(noteXml) : "";
    const chunk = [body, note].filter(Boolean).join("\n");
    if (chunk) parts.push(chunk);
  }
  return cleanExtractedText(parts.join("\n\n"));
}

async function odfToText(zip: JSZip): Promise<string> {
  const xml = (await readDecoded(zip, "content.xml")) ?? "";
  return cleanExtractedText(stripXmlTags(xml));
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

async function htmlFilesToText(zip: JSZip, names: string[]): Promise<string> {
  const files = names
    .filter((n) => /\.(x?html?)$/i.test(n))
    .filter((n) => !/meta-inf\//i.test(n))
    .sort(sortNumeric);
  const preferred = files.filter((n) => !/(nav|toc|ncx|cover|title.?page)/i.test(n));
  const ordered = preferred.length ? preferred : files;
  const parts: string[] = [];
  for (const name of ordered) {
    const raw = await readDecoded(zip, name);
    if (!raw) continue;
    const body = htmlToText(raw);
    if (body) parts.push(body);
  }
  return cleanExtractedText(parts.join("\n\n"));
}

function isFrontMatterTitle(title: string): boolean {
  const text = title.toLowerCase().replace(/[.…:]+$/g, "").trim();
  return /^(cover|cover page|title page|copyright|copyright page|copyrights|table of contents|contents|toc|license|the license|colophon|imprint)$/.test(text);
}

function isFrontMatterPath(path: string): boolean {
  const file = (path.split("/").pop() ?? path).toLowerCase().replace(/\.[^.]+$/, "");
  return /(?:^|[-_.])(?:cover|titlepage|title-page|copyright|nav|navigation|toc|colophon|license)(?:[-_.]|$)/.test(file);
}

function navBlocks(xml: string): string[] {
  return [...xml.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)].map((match) => match[0]);
}

function navKind(block: string): string {
  const open = block.match(/^<nav\b[^>]*>/i)?.[0] ?? "";
  return `${attr(open, "epub:type") ?? ""} ${attr(open, "role") ?? ""} ${attr(open, "id") ?? ""}`.toLowerCase();
}

type TocItem = { href: string; title: string };

function anchorsIn(block: string): TocItem[] {
  const found: TocItem[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    const href = attr(match[1] ?? "", "href");
    const title = cleanExtractedText(stripXmlTags(match[2] ?? "")).replace(/\s+/g, " ").trim();
    if (href && title) found.push({ href, title: title.slice(0, 72) });
  }
  return found;
}

function parseNcx(xml: string): TocItem[] {
  const labels = [...xml.matchAll(/<navLabel\b[^>]*>\s*<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map((match) =>
    cleanExtractedText(stripXmlTags(match[1] ?? "")).replace(/\s+/g, " ").trim(),
  );
  const hrefs = [...xml.matchAll(/<content\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1] ?? "");
  const count = Math.min(labels.length, hrefs.length);
  const found: TocItem[] = [];
  for (let i = 0; i < count; i += 1) {
    if (hrefs[i] && labels[i]) found.push({ href: hrefs[i]!, title: labels[i]!.slice(0, 72) });
  }
  return found;
}

function keepChapters(entries: TocItem[], landmarkHref: string): TocItem[] {
  try {
    const cleaned = entries.filter((entry) => {
      const title = entry.title.trim();
      if (/heading to/i.test(title)) return false;
      if (/^["“”'‘]/.test(title)) return false;
      return true;
    });
    const standard = cleaned.filter(
      (entry) => /chapter\s+[0-9ivxlcdm]+/i.test(entry.title) || /^\d+$/.test(entry.title.trim()),
    );
    let list = standard.length > 0 && standard.length < cleaned.length ? standard : cleaned;
    const mark = decodeHref(landmarkHref).split("#")[0]?.split("?")[0]?.split("/").pop()?.toLowerCase() ?? "";
    if (mark) {
      const index = list.findIndex((entry) => {
        const file = entry.href.toLowerCase().split("#")[0]?.split("?")[0]?.split("/").pop() ?? "";
        return file === mark;
      });
      if (index > 0) list = list.slice(index);
    }
    return list.length ? list : entries;
  } catch {
    return entries;
  }
}

function isNoiseChapter(title: string): boolean {
  const text = title.toLowerCase().replace(/[.…:]+$/g, "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (isFrontMatterTitle(text) || isGalleryPage(text)) return true;
  if (text.includes("gutenberg")) return true;
  if (text.includes("heading to preface")) return true;
  if (text === "preface" || text.startsWith("preface ")) return true;
  if (text.includes("project gutenberg license")) return true;
  return false;
}

function htmlWithAnchors(raw: string): { text: string; anchors: Map<string, number> } {
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  parsed.querySelectorAll("script, style, noscript, svg, title").forEach((el) => el.remove());
  parsed.querySelectorAll("[id]").forEach((el) => {
    const id = el.getAttribute("id");
    if (id) el.prepend(`\n@@${id}@@\n`);
  });
  const cleaned = cleanExtractedText(parsed.body?.innerText ?? "");
  const rawAnchors = new Map<string, number>();
  let text = "";
  let last = 0;
  const marks = /@@([^@\n]+)@@/g;
  let match: RegExpExecArray | null;
  while ((match = marks.exec(cleaned))) {
    text += cleaned.slice(last, match.index);
    if (match[1] && !rawAnchors.has(match[1])) rawAnchors.set(match[1], text.length);
    last = match.index + match[0].length;
  }
  text += cleaned.slice(last);
  const lead = text.length - text.trimStart().length;
  const anchors = new Map<string, number>();
  for (const [id, at] of rawAnchors) anchors.set(id, Math.max(0, at - lead));
  return { text: text.trim(), anchors };
}

function isGalleryPage(title: string): boolean {
  const text = title.toLowerCase().replace(/\s+/g, " ").trim();
  return text === "preface" || text.startsWith("preface:") || text.startsWith("preface ") || text.includes("list of illustrations");
}

function imageMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "image/jpeg";
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function galleryHtml(zip: JSZip, filePath: string, raw: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(raw, "text/html");
  const root = parsed.body;
  root.querySelectorAll("script, style, iframe, object, embed, link").forEach((el) => el.remove());
  const dir = filePath.includes("/") ? filePath.replace(/[^/]+$/, "") : "";
  for (const img of [...root.querySelectorAll("img")]) {
    const src = img.getAttribute("src") ?? "";
    if (!src || src.startsWith("data:")) continue;
    const resolved = resolveZipPath(dir, decodeHref(src));
    const file = findZipEntry(zip, resolved);
    if (!file) {
      img.remove();
      continue;
    }
    const buf = await file.async("arraybuffer");
    if (buf.byteLength > 1_500_000) {
      img.remove();
      continue;
    }
    img.setAttribute("src", `data:${imageMime(resolved)};base64,${bytesToBase64(buf)}`);
    img.removeAttribute("srcset");
  }
  for (const el of [...root.querySelectorAll("*")]) {
    for (const attribute of [...el.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) el.removeAttribute(attribute.name);
    }
  }
  return root.innerHTML;
}

function stripGutenberg(text: string): string {
  const startMark = /\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG EBOOK[^\n]*/i;
  const endMark = /\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG EBOOK[^\n]*/i;
  let next = text;
  const start = next.search(startMark);
  if (start >= 0) {
    const lineEnd = next.indexOf("\n", start);
    next = next.slice(lineEnd >= 0 ? lineEnd + 1 : start);
  }
  const end = next.search(endMark);
  if (end >= 0) next = next.slice(0, end);
  return cleanExtractedText(next);
}

function locateChapterTitles(text: string, titles: string[]): { title: string; charOffset: number }[] {
  const marks: { title: string; charOffset: number }[] = [];
  let from = 0;
  for (const title of titles) {
    const needle = title.trim();
    if (!needle) continue;
    const at = text.indexOf(needle, from);
    if (at < 0) continue;
    marks.push({ title: needle.slice(0, 72), charOffset: at });
    from = at + needle.length;
  }
  return marks;
}

async function epubToText(zip: JSZip): Promise<{ text: string; title?: string; chapters?: { title: string; charOffset: number }[]; frontPages?: { title: string; html: string }[] }> {
  const names = fileNames(zip);
  const container = await readDecoded(zip, "META-INF/container.xml");
  const rootHref =
    container?.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1] ??
    names.find((n) => pathKey(n).endsWith(".opf"));
  if (!rootHref) {
    return { text: stripGutenberg(await htmlFilesToText(zip, names)) };
  }
  const opf = await readDecoded(zip, rootHref);
  if (!opf) {
    return { text: stripGutenberg(await htmlFilesToText(zip, names)) };
  }
  const base = normalizeZipPath(rootHref).replace(/[^/]+$/, "");
  const title = xmlToText(opf.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? "");
  const manifest = new Map<string, { href: string; media: string; properties: string }>();
  const itemRe = /<item\b[^>]*>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRe.exec(opf))) {
    const tag = itemMatch[0];
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) {
      manifest.set(id, {
        href,
        media: (attr(tag, "media-type") ?? "").toLowerCase(),
        properties: (attr(tag, "properties") ?? "").toLowerCase(),
      });
    }
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)].map((match) => ({
    id: attr(match[0], "idref") ?? "",
    linear: (attr(match[0], "linear") ?? "yes").toLowerCase() !== "no",
  }));
  const guide = [...opf.matchAll(/<reference\b[^>]*>/gi)].map((match) => ({
    type: (attr(match[0], "type") ?? "").toLowerCase(),
    href: attr(match[0], "href") ?? "",
  }));

  let toc: TocItem[] = [];
  let landmarkHref = "";
  const navItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  if (navItem) {
    const navXml = await readDecoded(zip, resolveZipPath(base, decodeHref(navItem.href)));
    if (navXml) {
      for (const block of navBlocks(navXml)) {
        const kind = navKind(block);
        if (!landmarkHref && kind.includes("landmarks")) {
          const links = [...block.matchAll(/<a\b([^>]*)>/gi)];
          const hit = links.find((link) => /bodymatter/i.test(attr(link[1] ?? "", "epub:type") ?? ""));
          const href = hit ? attr(hit[1] ?? "", "href") : "";
          if (href) landmarkHref = href;
        }
        if (!toc.length && (kind.includes("toc") || kind.includes("doc-toc")) && !kind.includes("landmarks")) {
          toc = anchorsIn(block);
        }
      }
    }
  }
  if (!toc.length) {
    const ncxItem =
      [...manifest.entries()].find(([, item]) => item.media.includes("dtbncx")) ??
      [...manifest.entries()].find(([, item]) => item.href.toLowerCase().endsWith(".ncx"));
    if (ncxItem) {
      const ncx = await readDecoded(zip, resolveZipPath(base, decodeHref(ncxItem[1].href)));
      if (ncx) toc = parseNcx(ncx);
    }
  }
  if (!landmarkHref) {
    landmarkHref = guide.find((ref) => ref.type === "bodymatter")?.href ?? "";
  }
  toc = keepChapters(toc, landmarkHref);

  const navPath = navItem ? pathKey(resolveZipPath(base, decodeHref(navItem.href))) : "";
  const spineHrefs = (spine.length ? spine : [...manifest.keys()].map((id) => ({ id, linear: true })))
    .map((entry) => {
      const item = manifest.get(entry.id);
      if (!item?.href) return null;
      return { ...entry, href: item.href, path: resolveZipPath(base, decodeHref(item.href)) };
    })
    .filter((entry): entry is { id: string; linear: boolean; href: string; path: string } => !!entry);

  const chapterEntries = toc
    .map((entry) => ({
      title: entry.title.replace(/\s+/g, " ").trim().slice(0, 72),
      path: resolveZipPath(base, entry.href),
      fragment: decodeHref(entry.href.split("#")[1] ?? ""),
    }))
    .filter((entry) => entry.title && entry.path && !isNoiseChapter(entry.title));
  const chapterPaths = new Set(chapterEntries.map((entry) => pathKey(entry.path)));
  const chapterNames = new Set(chapterEntries.map((entry) => pathKey(entry.path).split("/").pop() ?? ""));
  const files = chapterEntries.length
    ? spineHrefs.filter((entry) => {
        const key = pathKey(entry.path);
        return key !== navPath && (chapterPaths.has(key) || chapterNames.has(key.split("/").pop() ?? ""));
      })
    : spineHrefs.filter((entry) => pathKey(entry.path) !== navPath && !isFrontMatterPath(entry.path) && entry.linear);

  const frontPages: { title: string; html: string }[] = [];
  for (const entry of toc) {
    if (!isGalleryPage(entry.title) && !/preface/i.test(entry.title)) continue;
    const path = resolveZipPath(base, entry.href);
    const raw = await readDecoded(zip, path);
    if (!raw) continue;
    const html = await galleryHtml(zip, path, raw);
    if (html.trim()) frontPages.push({ title: entry.title, html });
  }

  const parts: string[] = [];
  const fileAt = new Map<string, { start: number; anchors: Map<string, number> }>();
  const seen = new Set<string>();
  let cursor = 0;
  for (const file of files) {
    const key = pathKey(file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = await readDecoded(zip, file.path);
    if (!raw) continue;
    if (!/\.(x?html?|xml|htm)$/i.test(file.path) && !/<html\b/i.test(raw.slice(0, 800))) continue;
    const extracted = htmlWithAnchors(raw);
    const body = /\*{3}\s*(?:START|END) OF (?:THE |THIS )?PROJECT GUTENBERG EBOOK/i.test(extracted.text)
      ? stripGutenberg(extracted.text)
      : extracted.text;
    if (!body) continue;
    if (parts.length) cursor += 2;
    fileAt.set(key, { start: cursor, anchors: extracted.anchors });
    parts.push(body);
    cursor += body.length;
  }
  let text = parts.join("\n\n");
  if (!text) text = stripGutenberg(await htmlFilesToText(zip, names));
  const chapters = chapterEntries.length
    ? chapterEntries.map((entry) => {
        const place =
          fileAt.get(pathKey(entry.path)) ??
          [...fileAt.entries()].find(([key]) => key.endsWith(`/${pathKey(entry.path).split("/").pop()}`))?.[1];
        const anchorAt = entry.fragment ? place?.anchors.get(entry.fragment) : undefined;
        const local = anchorAt ?? (place ? place.start : 0);
        const charOffset = anchorAt != null && place ? place.start + anchorAt : local;
        return { title: entry.title, charOffset };
      })
    : undefined;
  return {
    text,
    title: title || undefined,
    chapters,
    frontPages: frontPages.length ? frontPages : undefined,
  };
}

function resolveZipPath(base: string, href: string): string {
  const cleaned = decodeHref(href.split("?")[0]?.split("#")[0] ?? href);
  if (/^https?:/i.test(cleaned)) return cleaned;
  const prefix = normalizeZipPath(base);
  const joined = cleaned.startsWith("/") ? cleaned : `${prefix}${cleaned}`;
  const stack = joined.split("/");
  const out: string[] = [];
  for (const part of stack) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
