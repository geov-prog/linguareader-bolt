import { stemname } from "@/services/documents/clean";
import type { DocumentRecord } from "@/services/StorageService";

export type ExportFormat = "txt" | "md" | "html" | "rtf" | "docx" | "pdf" | "epub";

export const EXPORT_OPTIONS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "txt", label: "Plain text", hint: ".txt" },
  { id: "md", label: "Markdown", hint: ".md" },
  { id: "html", label: "Web page", hint: ".html" },
  { id: "rtf", label: "Rich text", hint: ".rtf" },
  { id: "docx", label: "Word", hint: ".docx" },
  { id: "pdf", label: "PDF", hint: ".pdf" },
  { id: "epub", label: "EPUB", hint: ".epub" },
];

function safeFileName(title: string, ext: string): string {
  const stem = stemname(title)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${stem || "linguareader"}.${ext}`;
}

function escapeHtml(text: string): string {
  const amp = "\u0026";
  return text
    .replaceAll(amp, `${amp}amp;`)
    .replaceAll("<", `${amp}lt;`)
    .replaceAll(">", `${amp}gt;`)
    .replaceAll('"', `${amp}quot;`);
}

function escapeRtf(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\\") out += "\\\\";
    else if (ch === "{") out += "\\{";
    else if (ch === "}") out += "\\}";
    else if (ch === "\n") out += "\\par\n";
    else {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 128) out += ch;
      else if (code < 65536) out += `\\u${code > 32767 ? code - 65536 : code}?`;
      else out += "?";
    }
  }
  return out;
}

function toHtmlDocument(doc: DocumentRecord): string {
  const body = escapeHtml(doc.rawText).replace(/\n/g, "<br>\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(doc.title)}</title>
  <style>
    body { margin: 0; background: #f2ece2; color: #1c1915; font: 20px/1.7 Georgia, "Iowan Old Style", "Songti SC", serif; }
    main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    h1 { font-weight: 500; letter-spacing: -0.03em; line-height: 1.2; }
    p.meta { font: 12px/1.4 system-ui, sans-serif; color: #6b6458; letter-spacing: 0.12em; text-transform: uppercase; }
  </style>
</head>
<body>
  <main>
    <p class="meta">LinguaReader</p>
    <h1>${escapeHtml(doc.title)}</h1>
    <article>${body}</article>
  </main>
</body>
</html>
`;
}

function isWinAnsi(text: string): boolean {
  return !/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/.test(text);
}

async function exportDocx(doc: DocumentRecord): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const lines = doc.rawText.split("\n");
  const children = [
    new Paragraph({
      children: [new TextRun({ text: doc.title, bold: true, size: 36, font: "Times New Roman" })],
      spacing: { after: 360 },
    }),
    ...lines.map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line.length ? line : " ", size: 24, font: "Times New Roman" })],
          spacing: { after: 120 },
        }),
    ),
  ];
  const file = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBlob(file);
}

async function exportPdf(doc: DocumentRecord): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 54;
  const width = pageWidth - margin * 2;

  if (isWinAnsi(doc.title + doc.rawText)) {
    pdf.setFont("times", "bold");
    pdf.setFontSize(18);
    const titleLines = pdf.splitTextToSize(doc.title, width) as string[];
    let y = margin;
    for (const line of titleLines) {
      pdf.text(line, margin, y);
      y += 24;
    }
    y += 12;
    pdf.setFont("times", "normal");
    pdf.setFontSize(12);
    const body = pdf.splitTextToSize(doc.rawText, width) as string[];
    for (const line of body) {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += 16;
    }
    return pdf.output("blob");
  }

  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = Math.round(pageWidth * scale);
  canvas.height = Math.round(pageHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw a PDF page.");
  ctx.scale(scale, scale);
  const fontBody = '18px "Newsreader Variable", Newsreader, "Iowan Old Style", Palatino, "Songti SC", "Noto Serif CJK SC", serif';
  const fontTitle = '22px "Newsreader Variable", Newsreader, "Iowan Old Style", Palatino, serif';

  const wrap = (text: string, font: string): string[] => {
    ctx.font = font;
    const lines: string[] = [];
    for (const para of text.split("\n")) {
      if (!para) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const ch of para) {
        const trial = current + ch;
        if (ctx.measureText(trial).width > width && current) {
          lines.push(current);
          current = ch;
        } else {
          current = trial;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  };

  const titleLines = wrap(doc.title, fontTitle);
  const bodyLines = wrap(doc.rawText, fontBody);
  const lineHeight = 26;
  const usable = pageHeight - margin * 2;
  const linesPerPage = Math.max(8, Math.floor(usable / lineHeight));
  const pages: string[][] = [];
  const firstRoom = Math.max(4, linesPerPage - titleLines.length - 1);
  pages.push(bodyLines.slice(0, firstRoom));
  for (let i = firstRoom; i < bodyLines.length; i += linesPerPage) {
    pages.push(bodyLines.slice(i, i + linesPerPage));
  }

  const paint = (index: number) => {
    ctx.fillStyle = "#f2ece2";
    ctx.fillRect(0, 0, pageWidth, pageHeight);
    ctx.fillStyle = "#1c1915";
    let y = margin + 18;
    if (index === 0) {
      ctx.font = fontTitle;
      for (const line of titleLines) {
        ctx.fillText(line, margin, y);
        y += 28;
      }
      y += 10;
    }
    ctx.font = fontBody;
    for (const line of pages[index] ?? []) {
      ctx.fillText(line, margin, y);
      y += lineHeight;
    }
  };

  for (let i = 0; i < pages.length; i += 1) {
    if (i > 0) pdf.addPage();
    paint(i);
    const data = canvas.toDataURL("image/jpeg", 0.84);
    pdf.addImage(data, "JPEG", 0, 0, pageWidth, pageHeight);
  }
  return pdf.output("blob");
}

async function exportEpub(doc: DocumentRecord): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><meta charset="utf-8"/><title>${escapeHtml(doc.title)}</title></head>
<body>
<h1>${escapeHtml(doc.title)}</h1>
${doc.rawText
  .split(/\n{2,}/)
  .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
  .join("\n")}
</body>
</html>`;
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${escapeHtml(doc.title)}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chap" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="chap"/>
  </spine>
</package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
<nav epub:type="toc"><ol><li><a href="chapter.xhtml">${escapeHtml(doc.title)}</a></li></ol></nav>
</body></html>`,
  );
  zip.file("OEBPS/chapter.xhtml", html);
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
}

export async function exportDocument(
  doc: DocumentRecord,
  format: ExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  switch (format) {
    case "txt":
      return {
        blob: new Blob([doc.rawText], { type: "text/plain;charset=utf-8" }),
        filename: safeFileName(doc.title, "txt"),
      };
    case "md":
      return {
        blob: new Blob([`# ${doc.title}\n\n${doc.rawText}\n`], { type: "text/markdown;charset=utf-8" }),
        filename: safeFileName(doc.title, "md"),
      };
    case "html":
      return {
        blob: new Blob([toHtmlDocument(doc)], { type: "text/html;charset=utf-8" }),
        filename: safeFileName(doc.title, "html"),
      };
    case "rtf":
      return {
        blob: new Blob(
          [`{\\rtf1\\ansi\\ansicpg65001\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\f0\\fs24 ${escapeRtf(doc.title)}\\par\\par ${escapeRtf(doc.rawText)}}`],
          { type: "application/rtf" },
        ),
        filename: safeFileName(doc.title, "rtf"),
      };
    case "docx":
      return { blob: await exportDocx(doc), filename: safeFileName(doc.title, "docx") };
    case "pdf":
      return { blob: await exportPdf(doc), filename: safeFileName(doc.title, "pdf") };
    case "epub":
      return { blob: await exportEpub(doc), filename: safeFileName(doc.title, "epub") };
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 2000);
}

export async function shareOrDownload(
  blob: Blob,
  filename: string,
  title = filename,
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text: title });
        return "shared";
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "shared";
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

export async function shareDocument(doc: DocumentRecord): Promise<"shared" | "copied" | "downloaded"> {
  const filename = safeFileName(doc.title, "txt");
  const file = new File([doc.rawText], filename, { type: "text/plain;charset=utf-8" });
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: doc.title, text: doc.title });
        return "shared";
      }
      await navigator.share({ title: doc.title, text: doc.rawText.slice(0, 4000) });
      return "shared";
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "shared";
  }
  try {
    await navigator.clipboard.writeText(doc.rawText);
    return "copied";
  } catch {
    downloadBlob(file, filename);
    return "downloaded";
  }
}
